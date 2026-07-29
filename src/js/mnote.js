"use strict";

/* ===== .mnote 블록 문서 (표·이미지·글 혼합 편집) =====
   - 저장 포맷: UTF-8 JSON 한 개(format:"manneung-note"). 이미지는 base64 data URI 로 파일 안에 담는다.
   - 저장 경로는 기존 saveTextDoc(원본 파일/서버/다운로드)을 그대로 재사용한다.
   - 텍스트 편집기는 scratchpad 와 공유하지 않고 여기서 독립 구현한다(회귀 위험 차단, 나중 공용화 여지).
   설계: docs/mnote-design.md */

const MNOTE_FORMAT = "manneung-note";
const MNOTE_VERSION = 1;
const MNOTE_MAX_TABLE_ROWS = 50;
const MNOTE_MAX_TABLE_COLS = 20;
const MNOTE_IMAGE_SIZES = new Set(["small", "medium", "large", "full"]);
const MNOTE_RECOVERY_DELAY = 1500;   // 편집이 멈춘 뒤 복구본을 남기기까지(이미지가 커서 매 입력마다는 무겁다)
const MNOTE_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
let _mnoteScratchCount = 0;

function mnoteBlockId(prefix = "block"){
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function mnoteTextBlock(text = ""){
  return { id:mnoteBlockId("text"), type:"text", text:String(text || "") };
}

function mnoteTableBlock(rows = 2, cols = 2){
  const r = Math.max(1, Math.min(MNOTE_MAX_TABLE_ROWS, rows | 0));
  const c = Math.max(1, Math.min(MNOTE_MAX_TABLE_COLS, cols | 0));
  const grid = Array.from({ length:r }, () => Array.from({ length:c }, () => ""));
  return { id:mnoteBlockId("table"), type:"table", rows:grid, header:true };
}

function mnoteImageBlock(src, meta = {}){
  return {
    id:mnoteBlockId("image"),
    type:"image",
    src:String(src || ""),
    name:String(meta.name || "그림").slice(0, 180),
    mime:String(meta.mime || "image/png").slice(0, 100),
    width:MNOTE_IMAGE_SIZES.has(meta.width) ? meta.width : "medium",
    caption:String(meta.caption || "")
  };
}

function mnoteEmpty(title){
  const now = Date.now();
  return { format:MNOTE_FORMAT, version:MNOTE_VERSION, title:String(title || "블록 문서"),
    createdAt:now, updatedAt:now, blocks:[mnoteTextBlock("")] };
}

// 신뢰할 수 없는 입력(JSON)을 안전한 모델로 정규화한다.
function mnoteNormalizeBlock(raw){
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "table"){
    const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
    let cols = 0;
    for (const row of rawRows) if (Array.isArray(row)) cols = Math.max(cols, row.length);
    cols = Math.max(1, Math.min(MNOTE_MAX_TABLE_COLS, cols || 1));
    let rows = rawRows.filter(Array.isArray).slice(0, MNOTE_MAX_TABLE_ROWS).map(row => {
      const cells = row.slice(0, cols).map(cell => String(cell == null ? "" : cell).slice(0, 5000));
      while (cells.length < cols) cells.push("");
      return cells;
    });
    if (!rows.length) rows = [Array.from({ length:cols }, () => "")];
    return { id:mnoteBlockId("table"), type:"table", rows, header:raw.header !== false };
  }
  if (raw.type === "image"){
    const src = String(raw.src || "").trim();
    if (!/^data:image\//i.test(src)) return null;   // 파일에 담긴 base64 만 허용(외부 URL·스크립트 차단)
    return mnoteImageBlock(src, { name:raw.name, mime:raw.mime, width:raw.width, caption:raw.caption });
  }
  if (raw.type === "text") return mnoteTextBlock(raw.text);
  throw new Error("mnote-block-type");
}

function mnoteParse(text){
  const data = JSON.parse(String(text || ""));
  if (!data || typeof data !== "object" || data.format !== MNOTE_FORMAT
    || Number(data.version) !== MNOTE_VERSION){
    throw new Error("mnote-format");
  }
  const blocks = (Array.isArray(data.blocks) ? data.blocks : []).map(mnoteNormalizeBlock).filter(Boolean);
  if (!blocks.length) blocks.push(mnoteTextBlock(""));
  return {
    format:MNOTE_FORMAT,
    version:MNOTE_VERSION,
    title:String(data.title || "블록 문서").slice(0, 200),
    createdAt:Number(data.createdAt) || Date.now(),
    updatedAt:Number(data.updatedAt) || Date.now(),
    blocks
  };
}

function mnoteSerialize(mnote){
  return JSON.stringify({
    format:MNOTE_FORMAT,
    version:MNOTE_VERSION,
    title:mnote.title || "블록 문서",
    createdAt:mnote.createdAt || Date.now(),
    updatedAt:mnote.updatedAt || Date.now(),
    blocks:mnote.blocks
  }, null, 2);
}

// 이미지 data URI 는 블록 편집 중 바뀌지 않는다. 히스토리마다 base64 를 복제하지 않고
// 문서 세션의 Map 에 한 번만 보관해, 큰 이미지 문서에서도 이전 단계가 총량 제한에 밀리지 않게 한다.
function mnoteRememberImageSources(blocks, imageSources){
  for (const block of (Array.isArray(blocks) ? blocks : [])){
    if (block && block.type === "image" && block.id && block.src){
      imageSources.set(block.id, block.src);
    }
  }
}

function mnoteHistorySnapshot(mnote, imageSources){
  mnoteRememberImageSources(mnote.blocks, imageSources);
  const blocks = mnote.blocks.map(block => block.type === "image"
    ? { ...block, src:undefined }
    : block);
  return JSON.stringify({ title:mnote.title, updatedAt:mnote.updatedAt, blocks });
}

function mnoteHistoryState(snapshot, imageSources){
  const parsed = JSON.parse(snapshot);
  const blocks = (Array.isArray(parsed.blocks) && parsed.blocks.length) ? parsed.blocks : [mnoteTextBlock("")];
  for (const block of blocks){
    if (block && block.type === "image") block.src = imageSources.get(block.id) || "";
  }
  return {
    title:String(parsed.title || ""),
    updatedAt:Number(parsed.updatedAt) || Date.now(),
    blocks
  };
}

function mnoteBlockPlainText(block){
  if (block.type === "table"){
    return (Array.isArray(block.rows) ? block.rows : [])
      .map(row => (Array.isArray(row) ? row : []).join("\t")).join("\n");
  }
  if (block.type === "image"){
    const label = "[이미지: " + (block.name || "그림") + "]";
    return block.caption ? label + "\n" + block.caption : label;
  }
  return String(block.text || "");
}

function mnotePlainText(mnote){
  if (!mnote || !Array.isArray(mnote.blocks)) return "";
  return mnote.blocks.map(mnoteBlockPlainText).join("\n\n");
}

function mnoteBlockMatchesQuery(block, query){
  const q = String(query || "").toLowerCase();
  return !!q && mnoteBlockPlainText(block).toLowerCase().includes(q);
}

/* ===== 내보내기 (HTML / Markdown) =====
   .mnote(JSON)는 재편집용, 아래는 공유·인쇄용 산출물이다. 이미지는 그대로 base64 로 담긴다. */
function mnoteEscapeHtml(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mnoteBlockToHtml(block){
  if (block.type === "table"){
    const rows = Array.isArray(block.rows) ? block.rows : [];
    const cell = (v, tag) => "<" + tag + ">" + mnoteEscapeHtml(v) + "</" + tag + ">";
    let head = "", body = "";
    rows.forEach((row, r) => {
      if (block.header && r === 0) head = "<thead><tr>" + row.map(v => cell(v, "th")).join("") + "</tr></thead>";
      else body += "<tr>" + row.map(v => cell(v, "td")).join("") + "</tr>";
    });
    return "<table>" + head + "<tbody>" + body + "</tbody></table>";
  }
  if (block.type === "image"){
    const cap = block.caption ? "<figcaption>" + mnoteEscapeHtml(block.caption) + "</figcaption>" : "";
    return '<figure><img src="' + mnoteEscapeHtml(block.src) + '" alt="' + mnoteEscapeHtml(block.name) + '">' + cap + "</figure>";
  }
  return "<p>" + mnoteEscapeHtml(block.text) + "</p>";   // 줄바꿈은 CSS white-space:pre-wrap 로 보존
}

function mnoteToHtml(mnote){
  const title = mnoteEscapeHtml(mnote.title || "블록 문서");
  const body = (Array.isArray(mnote.blocks) ? mnote.blocks : []).map(mnoteBlockToHtml).join("\n");
  return [
    "<!doctype html>",
    '<html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + title + "</title>",
    "<style>",
    "body{max-width:820px;margin:40px auto;padding:0 16px;color:#1f2937;",
    "font:16px/1.7 -apple-system,system-ui,'Malgun Gothic','Segoe UI',sans-serif}",
    "h1{font-size:1.7em;margin:0 0 .6em}",
    "p{white-space:pre-wrap;margin:1em 0}",
    "table{border-collapse:collapse;width:100%;margin:1em 0}",
    "th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:left;vertical-align:top}",
    "th{background:#f1f5f9}",
    "figure{margin:1.2em 0;text-align:center}",
    "img{max-width:100%;height:auto}",
    "figcaption{color:#64748b;font-size:.9em;margin-top:6px}",
    "</style></head><body>",
    "<h1>" + title + "</h1>",
    body,
    "</body></html>"
  ].join("\n");
}

function mnoteBlockToMd(block){
  if (block.type === "table"){
    const rows = Array.isArray(block.rows) ? block.rows : [];
    if (!rows.length) return "";
    const esc = v => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\r?\n+/g, " ");
    // GFM 표는 머리글 행이 필수라, header 가 꺼져 있어도 첫 행을 머리글로 쓴다(포맷 한계).
    const lines = [];
    lines.push("| " + rows[0].map(esc).join(" | ") + " |");
    lines.push("| " + rows[0].map(() => "---").join(" | ") + " |");
    for (const row of rows.slice(1)) lines.push("| " + row.map(esc).join(" | ") + " |");
    return lines.join("\n");
  }
  if (block.type === "image"){
    const alt = String(block.name || "그림").replace(/[\[\]]/g, "");
    let md = "![" + alt + "](" + block.src + ")";
    if (block.caption) md += "\n\n*" + block.caption + "*";
    return md;
  }
  return String(block.text || "");
}

function mnoteToMarkdown(mnote){
  const parts = [];
  if (mnote.title) parts.push("# " + mnote.title);
  for (const block of (Array.isArray(mnote.blocks) ? mnote.blocks : [])) parts.push(mnoteBlockToMd(block));
  return parts.filter(s => s !== "").join("\n\n") + "\n";
}

function mnoteExportName(doc, ext){
  const base = String((doc && doc.name) || (doc && doc.mnote && doc.mnote.title) || "블록 문서").replace(/\.mnote$/i, "");
  return base + "." + ext;
}

function mnoteDownload(name, text, mime){
  try {
    const blob = new Blob([text], { type:mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch(e){
    if (typeof toast === "function") toast("내보내기에 실패했어요.", 2400, { type:"error" });
    return false;
  }
}

/* ===== 열기 ===== */
async function loadMnote(file, opts = {}){
  let mnote;
  try {
    mnote = mnoteParse(await file.text());
  } catch(_){
    if (typeof toast === "function") toast("블록 문서(.mnote)를 읽지 못해 텍스트로 열었어요.", 3500);
    return typeof loadText === "function" ? loadText(file, opts) : null;
  }
  const doc = makeDoc("mnote", file.name, opts);
  doc.mnote = mnote;
  doc.sourceFile = file;
  doc.savedText = mnoteSerialize(mnote);
  doc.render = async () => {
    if (doc._mnoteMounted) return;               // 편집 상태를 잃지 않도록 한 번만 마운트
    doc.el.innerHTML = "";
    mountMnoteEditor(doc);
    doc._mnoteMounted = true;
  };
  doc.contentSearchFocus = (query) => mnoteFocusMatch(doc, query);
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

/* ===== 새 문서 만들기 ===== */
function mnoteScratchFileName(n){
  return n && n > 1 ? "블록 문서 " + n + ".mnote" : "블록 문서.mnote";
}
function newMnoteScratch(){
  _mnoteScratchCount++;
  const name = mnoteScratchFileName(_mnoteScratchCount);
  const starter = mnoteSerialize(mnoteEmpty(name.replace(/\.mnote$/i, "")));
  if (typeof handleFiles === "function"){
    handleFiles([new File([starter], name, { type:"application/json" })], { isScratch:true });
  }
}

/* ===== 저장 ===== */
async function saveMnote(doc){
  if (!doc || !doc.mnote) return false;
  const json = mnoteSerialize(doc.mnote);
  const ok = (typeof saveTextDoc === "function") ? await saveTextDoc(json, doc, doc.name) : false;
  if (ok){
    doc.savedText = json;
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  }
  return ok;
}

/* ===== 편집기 ===== */
function mountMnoteEditor(doc){
  const mnote = doc.mnote;
  let activeBlockId = mnote.blocks[0] ? mnote.blocks[0].id : "";
  let history = null;                          // MNEditHistory (아래에서 생성) — touch()가 참조
  const imageSources = new Map();
  mnoteRememberImageSources(mnote.blocks, imageSources);

  const root = document.createElement("div");
  root.className = "mnote-doc";

  // 상단 바: 제목 + 삽입 버튼 + 저장
  const bar = document.createElement("div");
  bar.className = "mnote-bar";
  const titleInput = document.createElement("input");
  titleInput.className = "mnote-title";
  titleInput.type = "text";
  titleInput.value = mnote.title || "";
  titleInput.placeholder = "문서 제목";
  titleInput.setAttribute("aria-label", "문서 제목");
  titleInput.addEventListener("input", () => { mnote.title = titleInput.value; touch(); });

  const insertBar = document.createElement("div");
  insertBar.className = "mnote-insert";
  const makeInsertBtn = (label, title, action) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title;
    b.addEventListener("click", action);
    return b;
  };
  const imageInput = document.createElement("input");
  imageInput.type = "file"; imageInput.accept = "image/*"; imageInput.multiple = true; imageInput.hidden = true;
  imageInput.addEventListener("change", async () => { await addImages(imageInput.files); imageInput.value = ""; });
  insertBar.append(
    makeInsertBtn("+ 글", "글 블록 추가", () => insertBlock(mnoteTextBlock(""))),
    makeInsertBtn("+ 표", "표 블록 추가", () => insertBlock(mnoteTableBlock(2, 2))),
    makeInsertBtn("+ 이미지", "이미지 추가", () => imageInput.click())
  );

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "run-save mnote-save";          // .run-save → 전역 Ctrl+S 가 이 버튼을 클릭한다
  saveBtn.textContent = "💾 저장";
  saveBtn.title = "블록 문서 저장 (Ctrl+S)";
  saveBtn.dataset.shortcutAction = "saveCurrent";
  saveBtn.addEventListener("click", async () => {
    if (history) history.flush();               // 저장 시점을 독립된 되돌리기 기준점으로 남긴다.
    await saveMnote(doc);
  });

  const exportGroup = document.createElement("div");
  exportGroup.className = "mnote-export";
  const exportBtn = (label, title, action) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title;
    b.addEventListener("click", action);
    return b;
  };
  exportGroup.append(
    exportBtn("⬇ HTML", "HTML로 내보내기", () => {
      if (mnoteDownload(mnoteExportName(doc, "html"), mnoteToHtml(mnote), "text/html;charset=utf-8")) setStatus("HTML로 내보냈어요.");
    }),
    exportBtn("⬇ MD", "마크다운으로 내보내기", () => {
      if (mnoteDownload(mnoteExportName(doc, "md"), mnoteToMarkdown(mnote), "text/markdown;charset=utf-8")) setStatus("Markdown으로 내보냈어요.");
    })
  );

  const historyGroup = document.createElement("div");
  historyGroup.className = "mnote-history";
  const undoBtn = document.createElement("button");
  undoBtn.type = "button"; undoBtn.textContent = "↶"; undoBtn.title = "되돌리기 (Ctrl+Z)";
  const redoBtn = document.createElement("button");
  redoBtn.type = "button"; redoBtn.textContent = "↷"; redoBtn.title = "다시 실행 (Ctrl+Y)";
  undoBtn.addEventListener("click", () => { if (history) history.undo(); });
  redoBtn.addEventListener("click", () => { if (history) history.redo(); });
  historyGroup.append(undoBtn, redoBtn);
  const updateHistoryButtons = () => {
    undoBtn.disabled = !(history && history.canUndo());
    redoBtn.disabled = !(history && history.canRedo());
  };

  const status = document.createElement("span");
  status.className = "mnote-status";
  const setStatus = (msg) => { status.textContent = msg || ""; };

  bar.append(titleInput, insertBar, historyGroup, saveBtn, exportGroup, status);

  const list = document.createElement("div");
  list.className = "mnote-blocks";

  root.append(bar, list);
  doc.el.appendChild(root);

  // immediate=true 는 구조 변경(추가·삭제·이동 등)의 되돌리기 경계 — 그 자리에서 한 단계로 확정한다.
  // 타이핑은 immediate 없이 호출해 짧은 유휴 뒤 한 단계로 묶는다(commitSoon).
  /* 갑자기 꺼져도 되살릴 수 있게 복구본을 남긴다(PDF·노트북·표·이미지·화이트보드와 같은 경로).
     .mnote 는 가장 늦게 들어온 형식이라 이 안전망만 빠져 있었다. 원본 파일은 건드리지 않는다. */
  let mnoteRecoveryTimer = 0;
  const scheduleMnoteRecovery = () => {
    clearTimeout(mnoteRecoveryTimer);
    if (typeof appSettings !== "object" || !appSettings || !appSettings.pdfRecovery) return;
    if (typeof saveDocumentRecoverySnapshot !== "function") return;
    mnoteRecoveryTimer = setTimeout(() => {
      mnoteRecoveryTimer = 0;
      if (!doc.hasUnsavedEdits) return;
      let text;
      try { text = mnoteSerialize(mnote); } catch(_){ return; }
      saveDocumentRecoverySnapshot(doc, new TextEncoder().encode(text), "application/json").catch(() => {});
    }, MNOTE_RECOVERY_DELAY);
  };
  const flushMnoteBackup = () => {
    clearTimeout(mnoteRecoveryTimer);
    mnoteRecoveryTimer = 0;
    if (!doc.hasUnsavedEdits || typeof saveDocumentRecoverySnapshot !== "function") return true;
    return saveDocumentRecoverySnapshot(doc, new TextEncoder().encode(mnoteSerialize(mnote)), "application/json");
  };
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.flushBackupRecovery = flushMnoteBackup;
  doc.cleanupFns.push(() => {
    clearTimeout(mnoteRecoveryTimer);
    mnoteRecoveryTimer = 0;
    if (doc.flushBackupRecovery === flushMnoteBackup) delete doc.flushBackupRecovery;
  });

  function touch(immediate){
    mnote.updatedAt = Date.now();
    if (typeof markDocumentDirty === "function") markDocumentDirty(doc, true);
    setStatus("● 저장 안 됨");
    scheduleMnoteRecovery();
    if (history){ if (immediate) history.commit(); else history.commitSoon(400); }
  }
  // 구조 변경은 모델을 바꾼 뒤 전체를 다시 그리고(간단·정확), 지정 셀/영역으로 포커스를 되돌린다.
  function rerender(focusSel){
    renderBlocks();
    if (focusSel){
      const target = list.querySelector(focusSel);
      if (target) target.focus();
    }
  }
  function insertionIndex(){
    const idx = mnote.blocks.findIndex(b => b.id === activeBlockId);
    return idx < 0 ? mnote.blocks.length : idx + 1;
  }
  function structureChange(change, focusSel){
    if (history) history.flush();              // 직전 타이핑을 구조 변경과 별도 단계로 확정
    change();
    touch(true);
    rerender(focusSel);
  }
  function insertBlock(block){
    structureChange(() => {
      mnote.blocks.splice(insertionIndex(), 0, block);
      activeBlockId = block.id;
    }, `[data-block-id="${block.id}"] .mnote-text, [data-block-id="${block.id}"] .mnote-table-cell, [data-block-id="${block.id}"] .mnote-caption`);
  }
  function removeBlock(block){
    const idx = mnote.blocks.findIndex(b => b.id === block.id);
    if (idx < 0) return;
    structureChange(() => {
      mnote.blocks.splice(idx, 1);
      if (!mnote.blocks.length) mnote.blocks.push(mnoteTextBlock(""));
      activeBlockId = mnote.blocks[Math.min(idx, mnote.blocks.length - 1)].id;
    });
  }
  function moveBlock(block, dir){
    const idx = mnote.blocks.findIndex(b => b.id === block.id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= mnote.blocks.length) return;
    structureChange(() => {
      mnote.blocks.splice(next, 0, mnote.blocks.splice(idx, 1)[0]);
      activeBlockId = block.id;
    });
  }
  async function addImages(files){
    const blobs = [...(files || [])].filter(f => f && /^image\//i.test(f.type || "") && f.size > 0);
    if (!blobs.length) return;
    let last = null;
    for (const blob of blobs){
      if (blob.size > MNOTE_MAX_IMAGE_BYTES){ setStatus("이미지 한 장은 25MB까지 넣을 수 있어요."); continue; }
      const src = await mnoteReadDataUrl(blob);
      if (!src) continue;
      if (!last && history) history.flush();    // 이미지 묶음 추가 전 직전 타이핑부터 확정
      const block = mnoteImageBlock(src, { name:blob.name, mime:blob.type });
      imageSources.set(block.id, src);
      mnote.blocks.splice(insertionIndex(), 0, block);
      activeBlockId = block.id;
      last = block;
    }
    if (last){
      touch(true);
      rerender(`[data-block-id="${last.id}"] .mnote-caption`);
    }
  }

  /* ---- 블록 공통 도구(이동·삭제) ---- */
  function blockTools(block){
    const tools = document.createElement("div");
    tools.className = "mnote-block-tools";
    const btn = (label, title, action, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.title = title;
      if (cls) b.className = cls;
      b.addEventListener("click", (e) => { e.stopPropagation(); action(); });
      return b;
    };
    tools.append(
      btn("↑", "위로", () => moveBlock(block, -1)),
      btn("↓", "아래로", () => moveBlock(block, 1)),
      btn("×", "이 블록 삭제", () => removeBlock(block), "danger")
    );
    return tools;
  }
  function blockShell(block){
    const shell = document.createElement("article");
    shell.className = "mnote-block mnote-" + block.type;
    shell.dataset.blockId = block.id;
    shell.addEventListener("pointerdown", () => { activeBlockId = block.id; });
    return shell;
  }

  /* ---- 글 블록 ---- */
  function renderText(block){
    const shell = blockShell(block);
    const area = document.createElement("textarea");
    area.className = "mnote-text";
    area.value = block.text;
    area.rows = 3;
    area.placeholder = "내용을 입력하세요. 이미지는 붙여넣을 수 있어요.";
    area.spellcheck = false;
    const autoGrow = () => { area.style.height = "auto"; area.style.height = area.scrollHeight + "px"; };
    area.addEventListener("focus", () => { activeBlockId = block.id; });
    area.addEventListener("input", () => { block.text = area.value; autoGrow(); touch(); });
    area.addEventListener("paste", async (event) => {
      const imgs = [...((event.clipboardData && event.clipboardData.items) || [])]
        .filter(it => it.kind === "file" && /^image\//i.test(it.type || ""))
        .map(it => it.getAsFile()).filter(Boolean);
      if (!imgs.length) return;
      event.preventDefault();
      activeBlockId = block.id;
      await addImages(imgs);
    });
    // 스펠체크 버튼(있으면) — 전역 헬퍼 재사용
    if (typeof MNKoreanSpellcheck !== "undefined" && MNKoreanSpellcheck && typeof MNKoreanSpellcheck.attach === "function"){
      const tools = blockTools(block);
      try { MNKoreanSpellcheck.attach({ textarea:area, buttonHost:tools, mode:"plain", label:"맞춤법 검사" }); } catch(_){}
      shell.append(tools, area);
    } else {
      shell.append(blockTools(block), area);
    }
    requestAnimationFrame(autoGrow);
    return shell;
  }

  /* ---- 이미지 블록 ---- */
  function renderImage(block){
    const shell = blockShell(block);
    shell.classList.add("size-" + block.width);
    const tools = blockTools(block);
    const size = document.createElement("select");
    size.className = "mnote-image-size";
    size.title = "이미지 크기";
    [["small", "작게"], ["medium", "중간"], ["large", "크게"], ["full", "가득"]].forEach(([v, label]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = label; size.appendChild(o);
    });
    size.value = block.width;
    size.addEventListener("change", () => {
      block.width = MNOTE_IMAGE_SIZES.has(size.value) ? size.value : "medium";
      touch(true); rerender();
    });
    tools.prepend(size);
    const pic = document.createElement("div");
    pic.className = "mnote-image-picture";
    const img = document.createElement("img");
    img.src = block.src; img.alt = block.name || "그림";
    pic.appendChild(img);
    const caption = document.createElement("input");
    caption.className = "mnote-caption";
    caption.type = "text";
    caption.value = block.caption || "";
    caption.placeholder = "설명(선택)";
    caption.addEventListener("focus", () => { activeBlockId = block.id; });
    caption.addEventListener("input", () => { block.caption = caption.value; touch(); });
    shell.append(tools, pic, caption);
    return shell;
  }

  /* ---- 표 블록 (P0 에서 검증한 편집 UX 이식) ---- */
  function renderTable(block){
    const shell = blockShell(block);
    let focusR = 0, focusC = 0;
    const cols = () => (block.rows[0] ? block.rows[0].length : 0);
    const host = () => list.querySelector(`[data-block-id="${block.id}"]`);
    const focusCell = (r, c) => {
      const node = host(); if (!node) return;
      const cell = node.querySelector(`.mnote-table-cell[data-r="${r}"][data-c="${c}"]`);
      if (!cell) return;
      cell.focus();
      const range = document.createRange(); range.selectNodeContents(cell); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    };
    const commit = change => {
      if (history) history.flush();
      change();
      touch(true);
      renderBlocks();
    };
    const addRow = at => {
      if (block.rows.length >= MNOTE_MAX_TABLE_ROWS){ setStatus("표는 최대 " + MNOTE_MAX_TABLE_ROWS + "행이에요."); return; }
      commit(() => block.rows.splice(Math.max(0, Math.min(block.rows.length, at == null ? block.rows.length : at)), 0, Array.from({ length:cols() }, () => "")));
    };
    const addCol = at => {
      if (cols() >= MNOTE_MAX_TABLE_COLS){ setStatus("표는 최대 " + MNOTE_MAX_TABLE_COLS + "열이에요."); return; }
      const idx = Math.max(0, Math.min(cols(), at == null ? cols() : at));
      commit(() => block.rows.forEach(row => row.splice(idx, 0, "")));
    };
    const delRow = at => {
      if (block.rows.length <= 1){ setStatus("행이 하나뿐이라 지울 수 없어요."); return; }
      commit(() => block.rows.splice(Math.max(0, Math.min(block.rows.length - 1, at)), 1));
    };
    const delCol = at => {
      if (cols() <= 1){ setStatus("열이 하나뿐이라 지울 수 없어요."); return; }
      commit(() => block.rows.forEach(row => row.splice(Math.max(0, Math.min(cols() - 1, at)), 1)));
    };

    const tools = blockTools(block);
    const tableTools = document.createElement("div");
    tableTools.className = "mnote-table-tools";
    const ttBtn = (label, title, action, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.title = title;
      if (cls) b.className = cls;
      b.addEventListener("click", (e) => { e.stopPropagation(); action(); });
      return b;
    };
    const headerBtn = ttBtn("머리글", "첫 행을 머리글로", () => commit(() => { block.header = !block.header; }),
      "mnote-table-toggle" + (block.header ? " active" : ""));
    headerBtn.setAttribute("aria-pressed", String(block.header));
    tableTools.append(
      headerBtn,
      ttBtn("＋행", "현재 행 아래에 추가", () => { const r = focusR; addRow(r + 1); focusCell(Math.min(block.rows.length - 1, r + 1), focusC); }),
      ttBtn("－행", "현재 행 삭제", () => { const r = focusR; delRow(r); focusCell(Math.min(block.rows.length - 1, r), Math.min(cols() - 1, focusC)); }),
      ttBtn("＋열", "현재 열 오른쪽에 추가", () => { const c = focusC; addCol(c + 1); focusCell(focusR, Math.min(cols() - 1, c + 1)); }),
      ttBtn("－열", "현재 열 삭제", () => { const c = focusC; delCol(c); focusCell(Math.min(block.rows.length - 1, focusR), Math.min(cols() - 1, c)); })
    );

    const handleKey = (event, r, c) => {
      const nCols = cols(), nRows = block.rows.length;
      if (event.key === "Tab"){
        event.preventDefault();
        let idx = r * nCols + c + (event.shiftKey ? -1 : 1);
        if (idx < 0) idx = 0;
        if (idx > nRows * nCols - 1){ addRow(nRows); focusCell(nRows, 0); return; }
        focusCell(Math.floor(idx / nCols), idx % nCols);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey){
        event.preventDefault();
        if (r === nRows - 1){ addRow(nRows); focusCell(nRows, c); }
        else focusCell(r + 1, c);
      }
    };
    const makeCell = (r, c) => {
      const isHeader = block.header && r === 0;
      const cell = document.createElement(isHeader ? "th" : "td");
      const box = document.createElement("div");
      box.className = "mnote-table-cell";
      box.contentEditable = "true";
      box.textContent = block.rows[r][c] || "";
      box.dataset.r = String(r); box.dataset.c = String(c);
      box.setAttribute("role", "textbox");
      box.setAttribute("aria-label", (r + 1) + "행 " + (c + 1) + "열");
      box.addEventListener("focus", () => { focusR = r; focusC = c; activeBlockId = block.id; });
      box.addEventListener("input", () => { block.rows[r][c] = box.textContent; touch(); });
      box.addEventListener("paste", (event) => {
        event.preventDefault();
        const text = ((event.clipboardData || window.clipboardData) || { getData:() => "" }).getData("text/plain");
        document.execCommand("insertText", false, String(text || "").replace(/[\t\r\n]+/g, " "));
      });
      box.addEventListener("keydown", (event) => handleKey(event, r, c));
      cell.appendChild(box);
      return cell;
    };
    const table = document.createElement("table");
    table.className = "mnote-table";
    for (let r = 0; r < block.rows.length; r++){
      const tr = document.createElement("tr");
      for (let c = 0; c < block.rows[r].length; c++) tr.appendChild(makeCell(r, c));
      table.appendChild(tr);
    }
    const scroll = document.createElement("div");
    scroll.className = "mnote-table-scroll";
    scroll.appendChild(table);
    shell.append(tools, tableTools, scroll);
    return shell;
  }

  function renderBlocks(){
    list.replaceChildren(...mnote.blocks.map(block =>
      block.type === "image" ? renderImage(block)
        : block.type === "table" ? renderTable(block)
        : renderText(block)
    ));
  }

  // 검색 결과 클릭 → 일치 텍스트가 있는 블록으로 스크롤
  doc._mnoteFocus = (query) => {
    const q = String(query || "").toLowerCase();
    if (!q) return;
    const idx = mnote.blocks.findIndex(block => mnoteBlockMatchesQuery(block, q));
    if (idx < 0) return;
    const node = list.querySelector(`[data-block-id="${mnote.blocks[idx].id}"]`);
    if (node) node.scrollIntoView({ block:"center", behavior:"smooth" });
  };

  // 되돌리기/다시실행 — 제목+블록 메타데이터를 문자열 스냅샷으로 보관한다.
  // 변경되지 않는 이미지 base64 는 imageSources Map 에 한 번만 두고 단계 수와 텍스트 총량을 제한한다.
  history = MNEditHistory.create({
    limit: 80,
    sizeOf: (s) => s.length,
    maxBytes: 24 * 1024 * 1024,
    capture: () => mnoteHistorySnapshot(mnote, imageSources),
    isEqual: (a, b) => a === b,
    apply: (snapshot) => {
      let restored;
      try { restored = mnoteHistoryState(snapshot, imageSources); } catch(_){ return; }
      mnote.title = restored.title;
      mnote.blocks = restored.blocks;
      mnote.updatedAt = restored.updatedAt;
      titleInput.value = mnote.title;
      renderBlocks();
      const dirty = mnoteSerialize(mnote) !== doc.savedText;
      if (typeof markDocumentDirty === "function") markDocumentDirty(doc, dirty);
      setStatus(dirty ? "● 저장 안 됨" : "");
    },
    onChange: updateHistoryButtons
  });

  // Ctrl+Z / Ctrl+Y — 텍스트 입력 중에는 브라우저 기본 undo 를 그대로 둔다(스프레드시트와 동일 규약).
  const onHistoryKey = (e) => {
    if (typeof state !== "undefined" && state !== doc) return;   // 활성 문서일 때만
    if (e.defaultPrevented || e.isComposing) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = String(e.key || "").toLowerCase();
    const undo = key === "z" && !e.shiftKey;
    const redo = key === "y" || (key === "z" && e.shiftKey);
    if (!undo && !redo) return;
    const target = e.target;
    if (target && target.closest && target.closest('input,textarea,select,[contenteditable="true"]')) return;
    e.preventDefault(); e.stopPropagation();
    if (redo) history.redo(); else history.undo();
  };
  document.addEventListener("keydown", onHistoryKey, true);
  if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
  doc.cleanupFns.push(() => { document.removeEventListener("keydown", onHistoryKey, true); history.cancel(); });

  renderBlocks();
  history.reset();
  updateHistoryButtons();
  setStatus("");
}

function mnoteFocusMatch(doc, query){
  if (doc && typeof doc._mnoteFocus === "function") doc._mnoteFocus(query);
}

function mnoteReadDataUrl(blob){
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}
