"use strict";

/* 한컴 한셀(HCell) 등 비표준 생성기는 sharedStrings/styles 에 mc:AlternateContent 로
   한컴 전용 확장(hs:)을 끼워넣는데, SheetJS 가 이를 만나면 데이터 시트를 통째로 비워버린다.
   → AlternateContent 를 표준 호환 버전(mc:Fallback)만 남기고 한컴 확장(mc:Choice)은 제거한다.
     (블록을 통째로 지우지 않으므로 스타일 인덱스와 글자 서식이 보존된다.) */
function sanitizeHancomSpreadsheet(bytes){
  if (typeof JSZip === "undefined") return bytes;
  const unwrapAltContent = (xml) =>
    xml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, (block) => {
      const fb = block.match(/<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/);
      return fb ? fb[1] : "";                       // Fallback 없으면 블록 제거
    });
  try {
    const zip = new JSZip(bytes);
    let changed = false;
    ["xl/sharedStrings.xml", "xl/styles.xml"].forEach((path) => {
      const entry = zip.file(path);
      if (!entry) return;
      const xml = entry.asText();
      const fixed = unwrapAltContent(xml);
      if (fixed !== xml){ zip.file(path, fixed); changed = true; }
    });
    if (!changed) return bytes;
    return zip.generate({ type: "uint8array", compression: "STORE" });  // 재압축 생략(속도)
  } catch(e){
    console.warn("xlsx sanitize skipped:", e);
    return bytes;
  }
}

/* 한셀 등이 비정상적으로 부풀려 저장한 시트 크기(!ref)를 실제 값이 있는 범위로 줄인다.
   안 그러면 sheet_to_html 이 수십만~수백만 개의 빈 셀을 그리느라 화면이 멈춘다. */
function tightenSheetRange(ws){
  if (!ws || !ws["!ref"]) return;
  let maxR = -1, maxC = -1;
  for (const k in ws){
    if (k.charCodeAt(0) === 33) continue;                       // "!" 로 시작하는 메타 키 제외
    const c = ws[k];
    if (c == null || c.v === undefined || c.v === "") continue; // 값이 있는 셀만 집계
    const a = XLSX.utils.decode_cell(k);
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  if (maxR < 0){ ws["!ref"] = "A1"; return; }
  const declared = XLSX.utils.decode_range(ws["!ref"]);
  if (maxR < declared.e.r || maxC < declared.e.c){             // 줄어들 때만 갱신
    ws["!ref"] = XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r:maxR, c:maxC } });
    if (Array.isArray(ws["!merges"]))
      ws["!merges"] = ws["!merges"].filter(m => m.s.r <= maxR && m.s.c <= maxC);
  }
}

// 텍스트 인코딩 자동 판별(코드페이지 없는 파일용): UTF-16 BOM → 해당 인코딩, 아니면 "엄격 UTF-8"을
// 먼저 시도(BOM 자동 제거)하고, 유효한 UTF-8이 아니면 CP949(EUC-KR)로 디코드한다.
// 한국어 텍스트(csv·txt·md·코드 등)는 대부분 UTF-8 또는 CP949 이므로 이 둘을 우선한다.
function smartDecodeText(bytes){
  const info = detectTextEncoding(bytes);
  if (info && info.encoding){
    try { return new TextDecoder(info.encoding).decode(bytes); } catch(_){}
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function spreadsheetColumnName(index){
  let n = index + 1, s = "";
  while (n > 0){
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function copySpreadsheetText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch(e){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch(_){}
    ta.remove();
    return ok;
  }
}

// 표 내보내기 공용: 바이트/문자열을 파일로 저장.
function downloadSpreadsheetFile(data, name, mime){
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function sheetBaseName(name){ return String(name || "sheet").replace(/\.[^.]+$/, "") || "sheet"; }
function sanitizeFilePart(s){ return String(s || "").replace(/[\\/:*?"<>|]/g, "").trim() || "sheet"; }

// 새 빈 표(스프레드시트) 만들기 — 유효한 빈 XLSX(12행×6열)를 생성해 열고, 바로 편집 모드로 진입(isScratch).
let _sheetScratchCount = 0;
function newSpreadsheetScratch(){
  if (typeof XLSX === "undefined"){ toast("Excel 라이브러리를 불러오지 못했어요.", 2400); return; }
  _sheetScratchCount++;
  const rows = 12, cols = 6;
  const aoa = Array.from({ length: rows }, () => new Array(cols).fill(""));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!ref"] = "A1:" + spreadsheetColumnName(cols - 1) + rows;   // 빈 셀이라도 격자 크기를 고정
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const name = _sheetScratchCount > 1 ? ("새 표 " + _sheetScratchCount + ".xlsx") : "새 표.xlsx";
  const file = new File([out], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (typeof handleFiles === "function") handleFiles([file], { isScratch: true });
  if (typeof toast === "function") toast("새 빈 표를 만들었어요. 셀을 더블클릭해 입력하세요.", 3200);
}

function enhanceSpreadsheetSelection(sheet, label, opts={}){
  const table = sheet && sheet.querySelector("table");
  if (!table || table.dataset.selectReady === "1") return;
  if (sheet._spreadsheetCleanup) sheet._spreadsheetCleanup();
  table.dataset.selectReady = "1";
  sheet.classList.add("selectable-sheet");
  sheet.tabIndex = 0;

  const originalRows = Array.from(table.rows).filter(row => !row.classList.contains("xlsx-virtual-spacer"));
  if (!originalRows.length) return;
  // colLabels: 열 머리글 텍스트를 A/B/C 대신 실제 컬럼명으로(예: CSV 첫 줄). rowStart: 행 번호 시작 오프셋(페이지네이션용).
  const colLabels = Array.isArray(opts.colLabels) ? opts.colLabels : null;
  const rowStart = Number(opts.rowStart) || 0;
  let maxCols = 0;
  originalRows.forEach(row => { maxCols = Math.max(maxCols, row.cells.length); });
  if (colLabels) maxCols = Math.max(maxCols, colLabels.length);
  if (!maxCols) return;

  const thead = table.tHead || table.createTHead();
  const colRow = document.createElement("tr");
  colRow.className = "sheet-col-row";
  const corner = document.createElement("th"); corner.className = "sheet-corner"; corner.textContent = "";
  colRow.appendChild(corner);
  for (let c = 0; c < maxCols; c++){
    const th = document.createElement("th");
    th.className = "sheet-col-head";
    const named = colLabels && colLabels[c] != null && String(colLabels[c]).trim() !== "";
    const label = named ? String(colLabels[c]) : spreadsheetColumnName(c);
    th.textContent = label;
    th.dataset.col = String(c);
    th.title = named ? (label + " 열 선택") : (label + "열 선택");
    if (colLabels) th.classList.add("sheet-col-head-named");
    colRow.appendChild(th);
  }
  thead.insertBefore(colRow, thead.firstChild);

  const rows = Array.from(table.rows).filter(row =>
    !row.classList.contains("sheet-col-row") && !row.classList.contains("xlsx-virtual-spacer"));
  rows.forEach((row, r) => {
    const cells = Array.from(row.cells);
    cells.forEach((cell, c) => {
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.tabIndex = -1;
    });
    const th = document.createElement("th");
    th.className = "sheet-row-head";
    const rowNo = Array.isArray(opts.rowLabels) && opts.rowLabels[r] != null ? Number(opts.rowLabels[r]) + 1 : rowStart + r + 1;
    th.textContent = String(rowNo);
    th.dataset.row = String(r);
    th.title = rowNo + "행 선택";
    row.insertBefore(th, row.firstChild);
  });

  const bar = sheet.previousElementSibling && sheet.previousElementSibling.classList.contains("sheet-selectbar")
    ? sheet.previousElementSibling
    : document.createElement("div");
  if (!bar.isConnected) sheet.parentNode.insertBefore(bar, sheet);
  bar.className = "sheet-selectbar";
  bar.innerHTML = "";
  const info = document.createElement("span"); info.className = "sheet-select-info"; info.textContent = (label || "표") + " · 셀·행·열 선택";
  const search = document.createElement("input");
  search.className = "sheet-search";
  search.type = "search";
  search.placeholder = "표에서 찾기";
  search.setAttribute("aria-label", "표에서 찾기");
  const findPrev = document.createElement("button"); findPrev.type = "button"; findPrev.textContent = "이전"; findPrev.disabled = true;
  const findNext = document.createElement("button"); findNext.type = "button"; findNext.textContent = "다음"; findNext.disabled = true;
  const findStatus = document.createElement("span"); findStatus.className = "sheet-find-status"; findStatus.textContent = "";
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "복사"; copy.disabled = true;
  const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "선택 해제"; clear.disabled = true;
  const stat = document.createElement("span"); stat.className = "sheet-stat"; stat.textContent = "";   // 선택 영역 합계·평균·개수
  // 찾기·복사/해제를 그룹으로 묶어, 폭이 넘쳐 줄바꿈될 때 버튼 하나만 떨어지지 않고 그룹째 깔끔히 내려가게 한다.
  const findGroup = document.createElement("span"); findGroup.className = "sheet-bar-group";
  findGroup.append(search, findPrev, findNext, findStatus);
  const actGroup = document.createElement("span"); actGroup.className = "sheet-bar-group";
  actGroup.append(copy, clear);
  bar.append(info, findGroup, actGroup, stat);
  if (opts.extra) bar.prepend(opts.extra);   // CSV 페이지 네비 등 외부 컨트롤을 같은 바 앞쪽에 합친다(바 재생성 시 매번 다시 끼움)

  const rowCount = rows.length;
  let selection = null;
  let anchor = null;
  let dragTarget = null;
  let isDragging = false;
  let focusCell = null;   // 키보드 이동의 현재 끝점(방향키가 움직이는 셀)
  // 선택·통계 계산 중 querySelector를 수천 번 반복하지 않도록 현재 표의 셀을 한 번만 색인한다.
  const cachedDataCells = Array.from(table.querySelectorAll("td[data-row],th[data-row]:not(.sheet-row-head):not(.sheet-col-head):not(.sheet-corner)"));
  const cellGrid = Array.from({ length:rowCount }, () => Array(maxCols).fill(null));
  cachedDataCells.forEach(cell => {
    const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
    if (cellGrid[r] && c >= 0 && c < maxCols) cellGrid[r][c] = cell;
  });
  const rowHeads = Array.from(table.querySelectorAll(".sheet-row-head"));
  const colHeads = Array.from(table.querySelectorAll(".sheet-col-head"));
  const dataCells = () => cachedDataCells;
  const cellAt = (r, c) => (cellGrid[r] && cellGrid[r][c]) || null;
  const textAt = (r, c) => {
    const cell = cellAt(r, c);
    return cell ? cell.textContent : "";
  };
  const normalizeRange = (a, b) => ({
    row1: Math.max(0, Math.min(a.row, b.row)),
    row2: Math.min(rowCount - 1, Math.max(a.row, b.row)),
    col1: Math.max(0, Math.min(a.col, b.col)),
    col2: Math.min(maxCols - 1, Math.max(a.col, b.col))
  });
  const targetFromElement = (element) => {
    if (!element || !element.closest) return null;
    const col = element.closest(".sheet-col-head");
    if (col && sheet.contains(col)) return { kind: "col", row: 0, col: Number(col.dataset.col) };
    const row = element.closest(".sheet-row-head");
    if (row && sheet.contains(row)) return { kind: "row", row: Number(row.dataset.row), col: 0 };
    const cell = element.closest("[data-row][data-col]");
    if (cell && sheet.contains(cell) && !cell.classList.contains("sheet-row-head")){
      return { kind: "cell", row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    }
    return null;
  };
  const targetFromEvent = (e) => targetFromElement(e && e.target);
  const selectionFromTargets = (start, end) => {
    if (!start || !end) return null;
    if (start.kind === "row" || end.kind === "row"){
      const a = { row: start.row, col: 0 }, b = { row: end.row, col: maxCols - 1 };
      return { kind: "row", ...normalizeRange(a, b) };
    }
    if (start.kind === "col" || end.kind === "col"){
      const a = { row: 0, col: start.col }, b = { row: rowCount - 1, col: end.col };
      return { kind: "col", ...normalizeRange(a, b) };
    }
    return { kind: "cell", ...normalizeRange(start, end) };
  };
  const rangeLabel = (sel) => {
    if (!sel) return "";
    const first = spreadsheetColumnName(sel.col1) + (sel.row1 + 1);
    const last = spreadsheetColumnName(sel.col2) + (sel.row2 + 1);
    if (sel.kind === "row"){
      return sel.row1 === sel.row2 ? (sel.row1 + 1) + "행 선택" : (sel.row1 + 1) + "-" + (sel.row2 + 1) + "행 선택";
    }
    if (sel.kind === "col"){
      return sel.col1 === sel.col2 ? spreadsheetColumnName(sel.col1) + "열 선택" : spreadsheetColumnName(sel.col1) + ":" + spreadsheetColumnName(sel.col2) + "열 선택";
    }
    if (sel.row1 === sel.row2 && sel.col1 === sel.col2) return first + " 셀 선택";
    return first + ":" + last + " 범위 선택";
  };
  const selectionText = () => {
    if (!selection) return "";
    const lines = [];
    for (let r = selection.row1; r <= selection.row2; r++){
      const cells = [];
      for (let c = selection.col1; c <= selection.col2; c++) cells.push(textAt(r, c));
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  };
  // 셀 표시 텍스트를 숫자로(천단위 콤마·통화·%·회계식 음수 (123) 허용). 숫자가 아니면 null.
  const parseCellNumber = (s) => {
    let t = String(s == null ? "" : s).trim();
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1).trim(); }
    t = t.replace(/[,\s₩$€£¥%]/g, "");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    const n = parseFloat(t);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  };
  const fmtStat = (n) => {
    if (!isFinite(n)) return "-";
    return (Math.round(n * 1e10) / 1e10).toLocaleString(undefined, { maximumFractionDigits: 6 });
  };
  // 엑셀 하단처럼 선택 영역의 합계·평균·최소·최대·숫자개수·선택칸수를 셀렉트바에 표시.
  const updateStat = () => {
    if (!selection){ stat.textContent = ""; return; }
    let count = 0, nums = 0, sum = 0, min = Infinity, max = -Infinity;
    for (let r = selection.row1; r <= selection.row2; r++){
      for (let c = selection.col1; c <= selection.col2; c++){
        const raw = textAt(r, c);
        if (String(raw == null ? "" : raw).trim() !== "") count++;
        const n = parseCellNumber(raw);
        if (n != null){ nums++; sum += n; if (n < min) min = n; if (n > max) max = n; }
      }
    }
    if (count < 2){ stat.textContent = ""; return; }           // 단일 셀은 값이 보이므로 생략
    const parts = [];
    if (nums >= 1){
      parts.push("합계 " + fmtStat(sum), "평균 " + fmtStat(sum / nums), "최소 " + fmtStat(min), "최대 " + fmtStat(max), "숫자 " + nums);
    }
    parts.push("선택 " + count + "칸");
    stat.textContent = parts.join(" · ");
  };
  const MASK_TOP = 1, MASK_RIGHT = 2, MASK_BOTTOM = 4, MASK_LEFT = 8;
  let markedCells = new Map();
  let markedRowHeads = new Set(), markedColHeads = new Set(), markedAnchor = null;
  let selectionStatPending = false;
  const setCellMark = (cell, mask) => {
    cell.classList.toggle("sheet-selected", mask !== null);
    cell.classList.toggle("sheet-range-top", mask !== null && !!(mask & MASK_TOP));
    cell.classList.toggle("sheet-range-right", mask !== null && !!(mask & MASK_RIGHT));
    cell.classList.toggle("sheet-range-bottom", mask !== null && !!(mask & MASK_BOTTOM));
    cell.classList.toggle("sheet-range-left", mask !== null && !!(mask & MASK_LEFT));
  };
  const syncHeadMarks = (current, next) => {
    current.forEach(head => { if (!next.has(head)) head.classList.remove("sheet-active-head"); });
    next.forEach(head => { if (!current.has(head)) head.classList.add("sheet-active-head"); });
    return next;
  };
  const clearMarks = () => {
    markedCells.forEach((_, cell) => setCellMark(cell, null));
    markedCells = new Map();
    markedRowHeads.forEach(head => head.classList.remove("sheet-active-head"));
    markedColHeads.forEach(head => head.classList.remove("sheet-active-head"));
    markedRowHeads = new Set(); markedColHeads = new Set();
    if (markedAnchor) markedAnchor.classList.remove("sheet-anchor");
    markedAnchor = null;
  };
  const flushSelectionStat = () => {
    selectionStatPending = false;
    updateStat();
  };
  const applySelection = (next, options={}) => {
    selection = next;
    if (!selection){
      clearMarks();
      info.textContent = (label || "표") + " · 셀·행·열 선택";
      copy.disabled = true; clear.disabled = true;
      if (options.deferStat) selectionStatPending = true; else flushSelectionStat();
      if (typeof opts.onSelectionChange === "function") opts.onSelectionChange(null);
      return;
    }
    const nextCells = new Map();
    for (let r = selection.row1; r <= selection.row2; r++){
      for (let c = selection.col1; c <= selection.col2; c++){
        const cell = cellAt(r, c);
        if (!cell) continue;
        let mask = 0;
        if (r === selection.row1) mask |= MASK_TOP;
        if (r === selection.row2) mask |= MASK_BOTTOM;
        if (c === selection.col1) mask |= MASK_LEFT;
        if (c === selection.col2) mask |= MASK_RIGHT;
        nextCells.set(cell, mask);
      }
    }
    markedCells.forEach((mask, cell) => {
      const nextMask = nextCells.get(cell);
      if (nextMask === undefined) setCellMark(cell, null);
      else if (nextMask !== mask) setCellMark(cell, nextMask);
    });
    nextCells.forEach((mask, cell) => {
      if (!markedCells.has(cell)) setCellMark(cell, mask);
    });
    markedCells = nextCells;
    const nextRows = new Set(), nextCols = new Set();
    rowHeads.forEach(head => {
      const r = Number(head.dataset.row);
      if (r >= selection.row1 && r <= selection.row2) nextRows.add(head);
    });
    colHeads.forEach(head => {
      const c = Number(head.dataset.col);
      if (c >= selection.col1 && c <= selection.col2) nextCols.add(head);
    });
    markedRowHeads = syncHeadMarks(markedRowHeads, nextRows);
    markedColHeads = syncHeadMarks(markedColHeads, nextCols);
    // 기준(활성) 셀을 흰 배경 + 굵은 테두리로 구분 — 여러 칸을 선택해도 시작점이 한눈에 보이게.
    const nextAnchor = anchor && anchor.kind === "cell" ? cellAt(anchor.row, anchor.col) : null;
    if (markedAnchor && markedAnchor !== nextAnchor) markedAnchor.classList.remove("sheet-anchor");
    markedAnchor = nextAnchor && nextAnchor.classList.contains("sheet-selected") ? nextAnchor : null;
    if (markedAnchor) markedAnchor.classList.add("sheet-anchor");
    info.textContent = rangeLabel(selection);
    copy.disabled = false; clear.disabled = false;
    if (options.deferStat) selectionStatPending = true; else flushSelectionStat();
    if (typeof opts.onSelectionChange === "function") opts.onSelectionChange(selection);
  };
  // 편집기 우클릭 메뉴가 클릭한 셀·행·열을 현재 선택으로 맞출 수 있게 최소 API만 노출한다.
  sheet._selectSpreadsheetElement = (element) => {
    const target = targetFromElement(element);
    if (!target) return false;
    anchor = target;
    focusCell = target.kind === "cell" ? target : null;
    applySelection(selectionFromTargets(target, target));
    return true;
  };
  let findMatches = [];
  let findIndex = -1;
  const updateFindStatus = () => {
    findPrev.disabled = findNext.disabled = !findMatches.length;
    findStatus.textContent = search.value.trim() ? (findMatches.length ? (findIndex + 1) + "/" + findMatches.length : "0/0") : "";
  };
  const focusFoundCell = (match) => {
    if (!match) return;
    anchor = { kind: "cell", row: match.row, col: match.col };
    applySelection(selectionFromTargets(anchor, anchor));
    const cell = cellAt(match.row, match.col);
    if (cell) cell.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  };
  let contentFlashTimer = 0;
  sheet._focusContentCell = (row, col) => {
    const cell = row < 0                                    // row<0 → 컬럼명 머리글(CSV 첫 줄이 헤더로 올라간 경우)
      ? colRow.querySelector(`.sheet-col-head[data-col="${col}"]`)
      : cellAt(row, col);
    if (!cell) return false;
    clearTimeout(contentFlashTimer);
    sheet.querySelectorAll(".content-search-cell").forEach(el => el.classList.remove("content-search-cell"));
    try { sheet.focus({ preventScroll:true }); } catch(_) { sheet.focus(); }
    cell.scrollIntoView({ block:"center", inline:"center", behavior:"smooth" });
    cell.classList.add("content-search-cell");
    contentFlashTimer = setTimeout(() => cell.classList.remove("content-search-cell"), 2400);
    return true;
  };
  const runFind = (dir=1, quiet=false) => {
    const q = search.value.trim().toLowerCase();
    findMatches = q
      ? dataCells().map(cell => ({ cell, row: Number(cell.dataset.row), col: Number(cell.dataset.col), text: cell.textContent || "" }))
        .filter(item => item.text.toLowerCase().includes(q))
      : [];
    if (!findMatches.length){
      findIndex = -1;
      updateFindStatus();
      if (q && !quiet) toast("찾는 내용이 없어요.", 1200);
      return;
    }
    if (findIndex < 0) findIndex = dir < 0 ? findMatches.length - 1 : 0;
    else findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
    updateFindStatus();
    focusFoundCell(findMatches[findIndex]);
  };

  let dragPointerId = null, dragFrame = 0, dragPoint = null, lastDragKey = "";
  const dragKey = (target) => target ? [target.kind, target.row, target.col].join(":") : "";
  const runDragFrame = (allowRepeat=true) => {
    dragFrame = 0;
    if (!isDragging || !dragPoint || !dragTarget) return;
    const rect = sheet.getBoundingClientRect();
    const edge = 34;
    const axisSpeed = (position, start, end) => {
      if (position < start + edge) return -Math.min(24, Math.max(3, Math.ceil((start + edge - position) / 3)));
      if (position > end - edge) return Math.min(24, Math.max(3, Math.ceil((position - (end - edge)) / 3)));
      return 0;
    };
    const dx = axisSpeed(dragPoint.x, rect.left, rect.right);
    const dy = axisSpeed(dragPoint.y, rect.top, rect.bottom);
    const beforeLeft = sheet.scrollLeft, beforeTop = sheet.scrollTop;
    if (dx) sheet.scrollLeft += dx;
    if (dy) sheet.scrollTop += dy;
    const scrolled = beforeLeft !== sheet.scrollLeft || beforeTop !== sheet.scrollTop;

    let hitX = Math.max(rect.left + 2, Math.min(rect.right - 2, dragPoint.x));
    let hitY = Math.max(rect.top + 2, Math.min(rect.bottom - 2, dragPoint.y));
    // 셀 범위 드래그가 고정 행/열 머리글 위에 닿아도 마지막 보이는 데이터 셀까지 계속 확장한다.
    if (dragTarget.kind === "cell"){
      const cornerRect = corner.getBoundingClientRect();
      const colRect = colRow.getBoundingClientRect();
      hitX = Math.max(hitX, cornerRect.right + 2);
      hitY = Math.max(hitY, colRect.bottom + 2);
    }
    const target = targetFromElement(document.elementFromPoint(hitX, hitY));
    if (target && target.kind === dragTarget.kind){
      const key = dragKey(target);
      if (key !== lastDragKey){
        lastDragKey = key;
        focusCell = target;
        applySelection(selectionFromTargets(dragTarget, target), { deferStat:true });
      }
    }
    if (allowRepeat && scrolled && isDragging) dragFrame = requestAnimationFrame(() => runDragFrame(true));
  };
  const queueDragFrame = (e) => {
    if (!isDragging || (dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    dragPoint = { x:e.clientX, y:e.clientY };
    if (!dragFrame) dragFrame = requestAnimationFrame(() => runDragFrame(true));
  };
  const handlePointerDown = (e) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (e.target && e.target.closest && e.target.closest('[contenteditable="true"]')) return;   // 편집 중 셀은 캐럿 배치 허용
    const target = targetFromEvent(e);
    if (!target) return;
    if (e.pointerType === "touch") e.preventDefault();
    sheet.focus({ preventScroll: true });
    const start = e.shiftKey && anchor && anchor.kind === target.kind ? anchor : target;
    dragTarget = start;
    anchor = start;
    focusCell = target;
    isDragging = true;
    dragPointerId = e.pointerId;
    dragPoint = { x:e.clientX, y:e.clientY };
    lastDragKey = dragKey(target);
    try { sheet.setPointerCapture(e.pointerId); } catch(_){}
    applySelection(selectionFromTargets(start, target), { deferStat:true });
  };
  const stopDragging = (e) => {
    if (!isDragging || (e && dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    if (dragFrame){
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
      runDragFrame(false);
    }
    try {
      if (dragPointerId !== null && sheet.hasPointerCapture(dragPointerId)) sheet.releasePointerCapture(dragPointerId);
    } catch(_){}
    isDragging = false; dragTarget = null; dragPointerId = null; dragPoint = null; lastDragKey = "";
    if (selectionStatPending) flushSelectionStat();
  };
  sheet.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", queueDragFrame, { passive:true });
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);
  copy.addEventListener("click", async () => {
    const text = selectionText();
    if (!text) return;
    const ok = await copySpreadsheetText(text);
    toast(ok ? "선택한 표 내용을 복사했어요." : "복사하지 못했어요.", 1800);
  });
  clear.addEventListener("click", () => { anchor = null; applySelection(null); });
  search.addEventListener("input", () => { findIndex = -1; runFind(1, true); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); runFind(e.shiftKey ? -1 : 1); }
    e.stopPropagation();
  });
  findPrev.addEventListener("click", () => runFind(-1));
  findNext.addEventListener("click", () => runFind(1));
  // 키보드 이동 도우미 ──────────────────────────────────────────────
  const clampRow = (r) => Math.max(0, Math.min(rowCount - 1, r));
  const clampCol = (c) => Math.max(0, Math.min(maxCols - 1, c));
  const activeCell = () => {
    if (focusCell && focusCell.kind === "cell") return { row: focusCell.row, col: focusCell.col };
    if (anchor && anchor.kind === "cell") return { row: anchor.row, col: anchor.col };
    return { row: 0, col: 0 };
  };
  // 현재 보이는 높이 기준 한 페이지 행 수(PageUp/PageDown용)
  const pageRows = () => {
    const sample = cellAt(activeCell().row, 0) || cellAt(0, 0);
    const rh = (sample && sample.offsetHeight) || 24;
    return Math.max(1, Math.floor((sheet.clientHeight || 400) / rh) - 1);
  };
  // extend=false 면 단일 셀 선택(anchor 재설정), true(Shift) 면 anchor 고정 후 범위 확장.
  const moveActive = (row, col, extend) => {
    const r = clampRow(row), c = clampCol(col);
    focusCell = { kind: "cell", row: r, col: c };
    if (!extend || !anchor || anchor.kind !== "cell") anchor = { kind: "cell", row: r, col: c };
    applySelection(selectionFromTargets(anchor, focusCell));
    const cell = cellAt(r, c);
    if (cell) cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
  const handleSheetKeydown = async (e) => {
    const target = e.target;
    if (target && target.closest && target.closest("input,textarea,[contenteditable='true']")) return;   // 편집 중 셀·입력창은 건드리지 않음
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod && !e.altKey && String(key).toLowerCase() === "c"){   // 선택 영역 복사
      if (!selection) return;
      e.preventDefault();
      await copySpreadsheetText(selectionText());
      return;
    }
    if (mod && !e.altKey && String(key).toLowerCase() === "a"){   // 전체 선택
      e.preventDefault();
      anchor = { kind: "cell", row: 0, col: 0 };
      focusCell = { kind: "cell", row: rowCount - 1, col: maxCols - 1 };
      applySelection(selectionFromTargets(anchor, focusCell));
      return;
    }
    if (e.altKey || !NAV_KEYS.includes(key)) return;
    e.preventDefault();
    if (!selection){ moveActive(0, 0, false); return; }   // 선택이 없으면 첫 입력은 A1 로 진입
    const cur = activeCell();
    const ext = e.shiftKey;
    switch (key){
      case "ArrowUp":    moveActive(mod ? 0 : cur.row - 1, cur.col, ext); break;                 // Ctrl: 맨 위로
      case "ArrowDown":  moveActive(mod ? rowCount - 1 : cur.row + 1, cur.col, ext); break;       // Ctrl: 맨 아래로
      case "ArrowLeft":  moveActive(cur.row, mod ? 0 : cur.col - 1, ext); break;                 // Ctrl: 맨 왼쪽으로
      case "ArrowRight": moveActive(cur.row, mod ? maxCols - 1 : cur.col + 1, ext); break;        // Ctrl: 맨 오른쪽으로
      case "Home":       moveActive(mod ? 0 : cur.row, 0, ext); break;                            // Ctrl+Home: A1
      case "End":        moveActive(mod ? rowCount - 1 : cur.row, maxCols - 1, ext); break;       // Ctrl+End: 마지막 셀
      case "PageUp":     moveActive(cur.row - pageRows(), cur.col, ext); break;
      case "PageDown":   moveActive(cur.row + pageRows(), cur.col, ext); break;
    }
  };
  sheet.addEventListener("keydown", handleSheetKeydown);
  const doubleClickHandlers = [];
  if (!opts.editable){                                   // 편집 모드에선 더블클릭이 '셀 편집'이라 복사 동작을 달지 않는다
    dataCells().forEach(cell => {
      const handleDoubleClick = async () => {
        await copySpreadsheetText(cell.textContent || "");
        toast("셀 값을 복사했어요.", 1200);
      };
      cell.addEventListener("dblclick", handleDoubleClick);
      doubleClickHandlers.push([cell, handleDoubleClick]);
    });
  }
  setupSheetResize(sheet, table, colRow, rows, label);
  // 첫 행(머리글) 고정을 위해 열 머리글 줄 높이를 CSS 변수로 노출 → .xlsx-edit-header 를 그 아래에 sticky 로 붙인다.
  try { const hh = Math.round(colRow.getBoundingClientRect().height) || 30; sheet.style.setProperty("--sheet-head-h", hh + "px"); } catch(_){}
  sheet._spreadsheetCleanup = () => {
    sheet.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("pointermove", queueDragFrame);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
    sheet.removeEventListener("keydown", handleSheetKeydown);
    if (dragFrame) cancelAnimationFrame(dragFrame);
    clearTimeout(contentFlashTimer);
    doubleClickHandlers.forEach(([cell, handler]) => cell.removeEventListener("dblclick", handler));
    delete sheet._focusContentCell;
    delete sheet._selectSpreadsheetElement;
    delete sheet._spreadsheetCleanup;
  };
  applySelection(null);
}

// 열 폭·행 높이를 화면에서 드래그로 조절(보기 전용 — 파일에는 저장하지 않음).
// 조절값은 sheet 요소에 시트 이름별로 보관해, 편집·필터·정렬·페이지 이동으로 표가 다시 그려져도 유지한다.
// 열 머리글 오른쪽 끝·행 머리글 아래쪽 끝의 얇은 손잡이를 끌고, 더블클릭하면 자동 크기(측정값/기본)로 되돌린다.
function setupSheetResize(sheet, table, colRow, rows, label){
  if (!colRow) return;
  const key = label || "sheet";
  if (!sheet.__sheetSizes) sheet.__sheetSizes = {};
  const sizes = sheet.__sheetSizes[key] || (sheet.__sheetSizes[key] = { col:{}, row:{} });
  const MIN_W = 32, MIN_H = 22;

  const colHeads = Array.from(colRow.querySelectorAll(".sheet-col-head"));
  const corner = colRow.querySelector(".sheet-corner");
  if (!colHeads.length) return;

  // 자동 레이아웃 상태에서 현재 렌더된 폭을 먼저 측정 → 고정 레이아웃으로 바꿔도 반사(리플로우)가 없다.
  const rowHeadW = Math.max(MIN_W, Math.round((corner && corner.getBoundingClientRect().width) || 46));
  const measured = colHeads.map(th => Math.max(MIN_W, Math.round(th.getBoundingClientRect().width) || 80));

  const colgroup = document.createElement("colgroup");
  const headCol = document.createElement("col");
  headCol.style.width = rowHeadW + "px";
  colgroup.appendChild(headCol);
  const cols = colHeads.map((th, c) => {
    const col = document.createElement("col");
    col.style.width = (sizes.col[c] != null ? sizes.col[c] : measured[c]) + "px";
    colgroup.appendChild(col);
    return col;
  });
  table.insertBefore(colgroup, table.firstChild);
  table.classList.add("sheet-sized");                        // table-layout:fixed + 셀 말줄임(CSS)
  const applyTableWidth = () => {
    const total = rowHeadW + cols.reduce((sum, col) => sum + (parseFloat(col.style.width) || 0), 0);
    table.style.width = total + "px";
  };
  applyTableWidth();
  rows.forEach((tr, r) => { if (sizes.row[r] != null) tr.style.height = sizes.row[r] + "px"; });

  const addGrip = (parent, cls) => { const g = document.createElement("div"); g.className = cls; parent.appendChild(g); return g; };
  const wireDrag = (grip, onStart, onMove) => {
    grip.addEventListener("mousedown", (e) => e.stopPropagation());   // 행/열 선택(mousedown)과 충돌 방지
    let drag = null;
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch(_){}
      drag = onStart(e); grip.classList.add("dragging");
    });
    grip.addEventListener("pointermove", (e) => { if (drag) onMove(e, drag); });
    const end = (e) => { if (!drag) return; try { grip.releasePointerCapture(e.pointerId); } catch(_){} drag = null; grip.classList.remove("dragging"); };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };

  colHeads.forEach((th, c) => {
    const grip = addGrip(th, "sheet-col-resizer");
    grip.title = "끌어서 열 폭 조절 · 더블클릭 자동 맞춤";
    grip.addEventListener("dblclick", (e) => { e.stopPropagation(); delete sizes.col[c]; cols[c].style.width = measured[c] + "px"; applyTableWidth(); });
    wireDrag(grip,
      (e) => ({ px:e.clientX, w:parseFloat(cols[c].style.width) || measured[c] }),
      (e, drag) => {
        const w = Math.max(MIN_W, Math.round(drag.w + (e.clientX - drag.px)));
        cols[c].style.width = w + "px"; sizes.col[c] = w; applyTableWidth();
      });
  });

  rows.forEach((tr, r) => {
    const th = tr.querySelector(".sheet-row-head"); if (!th) return;
    // 파일 저장용으로 화면 행 index 가 아니라 실제 모델 행(data-mrow)에 높이를 기록한다(필터·정렬과 무관).
    const dataCell = tr.querySelector("td[data-mrow]");
    const mrow = dataCell ? Number(dataCell.dataset.mrow) : null;
    const grip = addGrip(th, "sheet-row-resizer");
    grip.title = "끌어서 행 높이 조절 · 더블클릭 자동 맞춤";
    grip.addEventListener("dblclick", (e) => {
      e.stopPropagation(); delete sizes.row[r]; tr.style.height = "";
      if (mrow != null && sizes.rowModel) delete sizes.rowModel[mrow];
    });
    wireDrag(grip,
      (e) => ({ py:e.clientY, h:tr.getBoundingClientRect().height }),
      (e, drag) => {
        const h = Math.max(MIN_H, Math.round(drag.h + (e.clientY - drag.py)));
        tr.style.height = h + "px"; sizes.row[r] = h;
        if (mrow != null){ (sizes.rowModel || (sizes.rowModel = {}))[mrow] = h; }
      });
  });
}

// 화면 픽셀 → 엑셀 단위 변환(열 폭=문자 수, 행 높이=포인트)
function pxToExcelColWidth(px){ return Math.max(1, Math.round(((Number(px) || 0) - 5) / 7 * 100) / 100); }
function pxToExcelRowHeight(px){ return Math.max(6, Math.round((Number(px) || 0) * 0.75 * 100) / 100); }

function renderCsvPreview(text, host, filename, ownerDoc){
  if (ownerDoc) ownerDoc.contentSearchFocus = null;
  const rowStarts = indexCsvRows(text);
  if (!rowStarts.length){ host.textContent = "CSV 파일이 비어 있습니다."; return; }
  const recordAt = (index) => text.slice(rowStarts[index], index + 1 < rowStarts.length ? rowStarts[index + 1] : text.length);
  const delimiter = detectCsvDelimiter(recordAt(0));
  const header = parseCsvRecord(recordAt(0), delimiter);
  // 한 페이지 셀 수를 ~8000으로 묶는다. 컬럼이 아주 많은 표(수천 열)에서 50행 강제로 수십만 셀을 만들어 멈추던 문제 방지.
  const pageSize = Math.max(2, Math.min(500, Math.floor(8000 / Math.max(1, header.length))));
  const dataRows = Math.max(0, rowStarts.length - 1);
  const pages = Math.max(1, Math.ceil(dataRows / pageSize));
  let page = 0;

  // 페이지 네비 + XLSX 변환·편집을 별도 줄로 두지 않고, 선택 바(enhance) 앞쪽에 합쳐 한 줄로 보여준다.
  const pagenav = document.createElement("span"); pagenav.className = "csv-pagenav";
  const prev = document.createElement("button"); prev.textContent = "◀ 이전";
  const status = document.createElement("span"); status.className = "csv-pagestatus";
  const next = document.createElement("button"); next.textContent = "다음 ▶";
  pagenav.append(prev, status, next);
  // CSV → XLSX 변환 후 새 편집 탭으로 바로 열기
  if (typeof XLSX !== "undefined"){
    const toXlsx = document.createElement("button"); toXlsx.textContent = "XLSX로 변환·편집";
    toXlsx.title = "이 CSV 전체를 XLSX로 변환해 새 편집 탭에서 열기";
    toXlsx.addEventListener("click", async () => {
      if (rowStarts.length > 300000){ toast("행이 너무 많아 변환할 수 없어요(30만 행 초과).", 2600); return; }
      toXlsx.disabled = true;
      try {
        const aoa = [];
        for (let i = 0; i < rowStarts.length; i++) aoa.push(parseCsvRecord(recordAt(i), delimiter));
        const nb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
        const out = XLSX.write(nb, { type: "array", bookType: "xlsx" });
        const name = sheetBaseName(filename) + ".xlsx";
        const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (typeof handleFiles === "function"){
          await handleFiles([new File([out], name, { type:mime })], { isScratch:true, spreadsheetAoa:aoa });
          toast("XLSX로 변환해 편집 탭을 열었어요.", 2200);
        } else {
          downloadSpreadsheetFile(out, name, mime);
          toast("XLSX로 변환해 저장했어요.", 1800, { type: "success" });
        }
      } catch(e){ console.error(e); toast("변환하지 못했어요.", 2200); }
      finally { toXlsx.disabled = false; }
    });
    pagenav.append(toXlsx);
  }
  if (pages <= 1){ prev.hidden = true; next.hidden = true; }   // 한 페이지면 이동 버튼 숨김(상태·저장은 유지)
  const sheet = document.createElement("div"); sheet.className = "xlsx-sheet csv-sheet";
  host.append(sheet);                                          // 선택 바는 enhance 가 sheet 앞에 만들어 끼운다

  const appendRow = (body, cells) => {
    const tr = document.createElement("tr");
    cells.forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); });
    body.appendChild(tr);
  };
  const showPage = (nextPage) => {
    page = Math.max(0, Math.min(pages - 1, nextPage));
    const table = document.createElement("table"), body = document.createElement("tbody");
    const start = 1 + page * pageSize;                      // CSV 첫 줄(0)은 컬럼명 헤더 → 데이터는 1행부터
    const end = Math.min(rowStarts.length, start + pageSize);
    for (let i = start; i < end; i++) appendRow(body, parseCsvRecord(recordAt(i), delimiter));
    table.appendChild(body); sheet.replaceChildren(table); sheet.scrollTop = 0; sheet.scrollLeft = 0;
    // 첫 줄을 열 머리글로, 왼쪽 행 번호는 페이지에 맞춰 이어지게(rowStart).
    enhanceSpreadsheetSelection(sheet, "CSV", { extra: pagenav, colLabels: header, rowStart: page * pageSize });
    const firstNo = page * pageSize + 1, lastNo = page * pageSize + (end - start);
    status.textContent = dataRows
      ? `${firstNo.toLocaleString()}-${lastNo.toLocaleString()} / 총 ${dataRows.toLocaleString()}행`
      : "데이터 없음(머리글만)";
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
  };
  if (ownerDoc){
    ownerDoc.contentSearchFocus = (query) => {
      const needle = String(query || "").toLocaleLowerCase();
      if (!needle) return false;
      let found = null;
      for (let row = 0; row < rowStarts.length && !found; row++){
        const cells = parseCsvRecord(recordAt(row), delimiter);
        for (let col = 0; col < cells.length; col++){
          if (String(cells[col] || "").toLocaleLowerCase().includes(needle)){
            found = { row, col };
            break;
          }
        }
      }
      if (!found) return false;
      const targetPage = found.row === 0 ? 0 : Math.floor((found.row - 1) / pageSize);
      const visibleRow = found.row === 0 ? -1 : ((found.row - 1) % pageSize);   // 0=헤더 → 컬럼 머리글(-1)
      showPage(targetPage);
      requestAnimationFrame(() => {
        if (typeof sheet._focusContentCell === "function") sheet._focusContentCell(visibleRow, found.col);
      });
      return true;
    };
  }
  prev.onclick = () => showPage(page - 1);
  next.onclick = () => showPage(page + 1);
  showPage(0);
}

// ExcelJS 셀 값/스타일 스냅샷은 Date·수식 결과·리치텍스트 같은 중첩 값을 포함한다.
// JSON 왕복은 Date와 undefined를 잃으므로 XLSX 편집 모델 전용 복제기를 사용한다.
function cloneSpreadsheetValue(value){
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneSpreadsheetValue);
  if (value && typeof value === "object"){
    const out = {};
    Object.keys(value).forEach(key => { out[key] = cloneSpreadsheetValue(value[key]); });
    return out;
  }
  return value;
}

function spreadsheetCellValueSnapshot(cell){
  const value = cell && cell.value;
  // 공유 수식은 원본 master 주소에 종속되므로 독립 수식으로 풀어 두어 행 이동 후에도 수식 자체가 남게 한다.
  if (value && typeof value === "object" && value.sharedFormula !== undefined){
    return { formula: cell.formula, result: cloneSpreadsheetValue(value.result) };
  }
  return cloneSpreadsheetValue(value);
}

function decodeSpreadsheetMerge(range){
  const match = String(range || "").match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i);
  if (!match) return null;
  const col = (letters) => {
    let value = 0;
    for (const ch of letters.toUpperCase()) value = value * 26 + ch.charCodeAt(0) - 64;
    return value - 1;
  };
  return { s:{ c:col(match[1]), r:Number(match[2]) - 1 }, e:{ c:col(match[3]), r:Number(match[4]) - 1 } };
}

function encodeSpreadsheetCell(row, col){
  let letters = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters + String(row + 1);
}

function adjustSpreadsheetMergesAfterRowDelete(merges, deletedRows){
  const deleted = [...new Set((deletedRows || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!deleted.length) return (merges || []).slice();
  const removedBefore = (row) => {
    let count = 0;
    while (count < deleted.length && deleted[count] < row) count++;
    return count;
  };
  const deletedSet = new Set(deleted);
  const result = [];
  (merges || []).forEach(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range){ result.push(text); return; }
    let first = -1, last = -1;
    for (let row = range.s.r; row <= range.e.r; row++){
      if (deletedSet.has(row)) continue;
      const shifted = row - removedBefore(row);
      if (first < 0) first = shifted;
      last = shifted;
    }
    if (first < 0) return;
    if (first === last && range.s.c === range.e.c) return;
    result.push(encodeSpreadsheetCell(first, range.s.c) + ":" + encodeSpreadsheetCell(last, range.e.c));
  });
  return result;
}

function adjustSpreadsheetMergesAfterRowInsert(merges, row, count=1){
  const amount = Math.max(1, Number(count) || 1);
  return (merges || []).map(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range) return text;
    if (row <= range.s.r){ range.s.r += amount; range.e.r += amount; }
    else if (row <= range.e.r) range.e.r += amount;
    return encodeSpreadsheetCell(range.s.r, range.s.c) + ":" + encodeSpreadsheetCell(range.e.r, range.e.c);
  });
}

function adjustSpreadsheetMergesAfterColumnInsert(merges, col, count=1){
  const amount = Math.max(1, Number(count) || 1);
  return (merges || []).map(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range) return text;
    if (col <= range.s.c){ range.s.c += amount; range.e.c += amount; }
    else if (col <= range.e.c) range.e.c += amount;
    return encodeSpreadsheetCell(range.s.r, range.s.c) + ":" + encodeSpreadsheetCell(range.e.r, range.e.c);
  });
}

function adjustSpreadsheetMergesAfterColumnDelete(merges, deletedCols){
  const deleted = [...new Set((deletedCols || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!deleted.length) return (merges || []).slice();
  const removedBefore = (col) => {
    let count = 0;
    while (count < deleted.length && deleted[count] < col) count++;
    return count;
  };
  const deletedSet = new Set(deleted);
  const result = [];
  (merges || []).forEach(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range){ result.push(text); return; }
    let first = -1, last = -1;
    for (let col = range.s.c; col <= range.e.c; col++){
      if (deletedSet.has(col)) continue;
      const shifted = col - removedBefore(col);
      if (first < 0) first = shifted;
      last = shifted;
    }
    if (first < 0) return;
    if (first === last && range.s.r === range.e.r) return;
    result.push(encodeSpreadsheetCell(range.s.r, first) + ":" + encodeSpreadsheetCell(range.e.r, last));
  });
  return result;
}

// 두 셀 범위({s:{r,c},e:{r,c}})가 겹치는지 판정(병합 해제·중복 병합 제거에 사용)
function spreadsheetRangesOverlap(a, b){
  if (!a || !b) return false;
  return a.s.r <= b.e.r && a.e.r >= b.s.r && a.s.c <= b.e.c && a.e.c >= b.s.c;
}

// 클립보드 텍스트(엑셀/구글시트 복사본)를 2차원 배열로 파싱.
// 탭=열 구분, 줄바꿈=행 구분. 큰따옴표로 감싼 필드는 내부에 탭·줄바꿈·""(이스케이프)를 허용한다.
function parseClipboardTable(text){
  const s = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;
  while (i < s.length){
    const ch = s[i];
    if (inQuotes){
      if (ch === '"'){
        if (s[i + 1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"'){ inQuotes = true; i++; continue; }
    if (ch === '\t'){ row.push(field); field = ""; i++; continue; }
    if (ch === '\n'){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  row.push(field); rows.push(row);
  // 마지막 줄바꿈이 만든 빈 행(단일 빈 칸) 제거
  if (rows.length > 1){
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

/* ===================== 간단 수식 엔진 =====================
   지원: 사칙연산·괄호·거듭제곱(^)·백분율(%)·문자연결(&)·비교(=,<>,<,>,<=,>=),
         셀/범위 참조(A1, A1:B3), 핵심 함수(SUM/AVERAGE/MIN/MAX/COUNT/IF/ROUND …).
   단일 시트 기준. 오류는 {__err:"#..."} 로 전파, 값은 number|string|boolean.
   resolver(colIndex, rowIndex) → 그 셀의 스칼라 값(다른 수식 셀이면 그 결과)을 돌려주는 함수. */
const FORMULA_ERR = (code) => ({ __err: code });
function isFormulaError(v){ return !!(v && typeof v === "object" && typeof v.__err === "string"); }
function spreadsheetDateSerial(d){ return 25569 + (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000; }
// 엑셀 직렬값 ↔ 달력 구성요소(spreadsheetDateSerial 과 동일 규약: 벽시계 기준)
function spreadsheetDateToSerial(y, m, d, hh, mm, ss){ return 25569 + Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0) / 86400000; }
function spreadsheetSerialToParts(serial){
  const dt = new Date(Math.round((serial - 25569) * 86400000));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay(), hh: dt.getUTCHours(), mm: dt.getUTCMinutes(), ss: dt.getUTCSeconds() };
}
// 간단 숫자/날짜 서식(TEXT 함수용) — 자주 쓰는 패턴만 지원
function spreadsheetFormatByPattern(value, pattern){
  const p = String(pattern);
  if (/[ymdhs]/i.test(p) && !/[#0]/.test(p)){          // 날짜 서식
    const n = Number(value); if (!isFinite(n)) return String(value);
    const t = spreadsheetSerialToParts(n), pad = (x, w) => String(x).padStart(w, "0");
    return p
      .replace(/yyyy/gi, t.y).replace(/yy/gi, pad(t.y % 100, 2))
      .replace(/mm/g, pad(t.mo, 2)).replace(/m(?![ap])/gi, t.mo)
      .replace(/dd/gi, pad(t.d, 2)).replace(/d/gi, t.d)
      .replace(/hh/gi, pad(t.hh, 2)).replace(/ss/gi, pad(t.ss, 2));
  }
  const n = Number(value); if (!isFinite(n)) return String(value);
  if (/%/.test(p)){ const dec = (p.split(".")[1] || "").length; return (n * 100).toFixed(dec) + "%"; }
  const dec = (p.split(".")[1] || "").replace(/[^0#]/g, "").length;
  let s = n.toFixed(dec);
  if (/,/.test(p)){ const [ip, fp] = s.split("."); s = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fp ? "." + fp : ""); }
  return s;
}
function formulaColumnIndex(letters){
  let n = 0;
  for (const ch of String(letters).toUpperCase()){ if (ch < "A" || ch > "Z") return -1; n = n * 26 + (ch.charCodeAt(0) - 64); }
  return n - 1;
}
function parseA1Ref(ref){
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return null;
  return { c: formulaColumnIndex(m[1]), r: Number(m[2]) - 1 };
}
function tokenizeFormula(input){
  const specs = [
    ["ws", /^\s+/],
    ["num", /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/],
    ["str", /^"(?:[^"]|"")*"/],
    ["sheetq", /^'(?:[^']|'')*'/],                       // 따옴표로 감싼 시트 이름: 'My Sheet'
    ["err", /^#(?:REF!|DIV\/0!|NAME\?|VALUE!|NUM!|N\/A|NULL!|CYCLE!|ERROR!)/i],
    ["op", /^(?:<=|>=|<>|[-+*/^&<>=(),:%!])/],
    ["ref", /^\$?[A-Za-z]{1,3}\$?\d+/],
    ["name", /^[A-Za-z_ㄱ-ㆎ가-힣][A-Za-z0-9_.ㄱ-ㆎ가-힣]*/]
  ];
  const toks = []; let s = String(input);
  while (s.length){
    let matched = false;
    for (const [type, re] of specs){
      const m = re.exec(s); if (!m) continue;
      s = s.slice(m[0].length); matched = true;
      if (type !== "ws") toks.push({ type, text: m[0] });
      break;
    }
    if (!matched) throw new Error("수식 토큰 오류: " + s[0]);
  }
  return toks;
}
function parseFormula(input){
  const toks = tokenizeFormula(input);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (t) => { const tk = next(); if (!tk || tk.text !== t) throw new Error("수식 구문 오류: " + t + " 기대"); };
  const parseExpr = () => parseCompare();
  function parseCompare(){
    let node = parseConcat();
    while (peek() && peek().type === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().text)){
      const op = next().text; node = { t:"bin", op, a:node, b:parseConcat() };
    }
    return node;
  }
  function parseConcat(){
    let node = parseAdd();
    while (peek() && peek().text === "&"){ next(); node = { t:"bin", op:"&", a:node, b:parseAdd() }; }
    return node;
  }
  function parseAdd(){
    let node = parseMul();
    while (peek() && (peek().text === "+" || peek().text === "-")){ const op = next().text; node = { t:"bin", op, a:node, b:parseMul() }; }
    return node;
  }
  function parseMul(){
    let node = parsePow();
    while (peek() && (peek().text === "*" || peek().text === "/")){ const op = next().text; node = { t:"bin", op, a:node, b:parsePow() }; }
    return node;
  }
  function parsePow(){
    let node = parseUnary();
    if (peek() && peek().text === "^"){ next(); node = { t:"bin", op:"^", a:node, b:parsePow() }; }   // 우결합
    return node;
  }
  function parseUnary(){
    if (peek() && (peek().text === "-" || peek().text === "+")){ const op = next().text; return { t:"unary", op, x:parseUnary() }; }
    return parsePostfix();
  }
  function parsePostfix(){
    let node = parsePrimary();
    while (peek() && peek().text === "%"){ next(); node = { t:"unary", op:"%", x:node }; }
    return node;
  }
  function parsePrimary(){
    const tk = peek();
    if (!tk) throw new Error("수식이 갑자기 끝남");
    if (tk.type === "num"){ next(); return { t:"num", v:Number(tk.text) }; }
    if (tk.type === "str"){ next(); return { t:"str", v:tk.text.slice(1, -1).replace(/""/g, '"') }; }
    if (tk.type === "err"){ next(); return { t:"errlit", code:tk.text.toUpperCase() }; }
    if (tk.text === "("){ next(); const e = parseExpr(); expect(")"); return e; }
    // sheetName!Ref / 'sheet name'!Ref (시트 간 참조)
    const refWithSheet = (sheet) => {
      const rt = next();
      if (!rt || rt.type !== "ref") throw new Error("시트 참조 뒤에 셀이 와야 함");
      const a = parseA1Ref(rt.text); if (!a) throw new Error("셀 참조 오류");
      if (peek() && peek().text === ":" && toks[i + 1] && toks[i + 1].type === "ref"){
        next(); const b = parseA1Ref(next().text);
        return { t:"range", c1:a.c, r1:a.r, c2:b.c, r2:b.r, sheet };
      }
      return { t:"ref", c:a.c, r:a.r, sheet };
    };
    if (tk.type === "sheetq"){
      next(); expect("!");
      return refWithSheet(tk.text.slice(1, -1).replace(/''/g, "'"));
    }
    if (tk.type === "ref"){
      next(); const a = parseA1Ref(tk.text); if (!a) throw new Error("셀 참조 오류");
      if (peek() && peek().text === ":" && toks[i + 1] && toks[i + 1].type === "ref"){
        next(); const b = parseA1Ref(next().text);
        return { t:"range", c1:a.c, r1:a.r, c2:b.c, r2:b.r };
      }
      return { t:"ref", c:a.c, r:a.r };
    }
    if (tk.type === "name"){
      next(); const up = tk.text.toUpperCase();
      if (peek() && peek().text === "!") { next(); return refWithSheet(tk.text); }   // Sheet1!A1
      if (peek() && peek().text === "("){
        next(); const args = [];
        if (peek() && peek().text !== ")"){ args.push(parseExpr()); while (peek() && peek().text === ","){ next(); args.push(parseExpr()); } }
        expect(")");
        return { t:"call", name:up, args };
      }
      if (up === "TRUE") return { t:"bool", v:true };
      if (up === "FALSE") return { t:"bool", v:false };
      return { t:"nameref", name:up };
    }
    throw new Error("예상치 못한 토큰: " + tk.text);
  }
  const ast = parseExpr();
  if (i < toks.length) throw new Error("수식에 남는 토큰이 있음");
  return ast;
}
function formulaToNumber(v){
  if (isFormulaError(v)) return v;
  if (Array.isArray(v)) return v.length ? formulaToNumber(v[0]) : 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === "" || v == null) return 0;
  if (typeof v === "string"){ const t = v.trim(); if (t === "") return 0; const n = Number(t); return (!isNaN(n) && isFinite(n)) ? n : FORMULA_ERR("#VALUE!"); }
  return FORMULA_ERR("#VALUE!");
}
function formulaToString(v){
  if (isFormulaError(v)) return v;
  if (Array.isArray(v)) return v.length ? formulaToString(v[0]) : "";
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function formulaToBool(v){
  if (isFormulaError(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string"){ if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; return v !== ""; }
  return !!v;
}
function evaluateAst(ast, resolver){
  const res = resolver || (() => "");
  const scal = (v) => Array.isArray(v) ? (v.length ? v[0] : "") : v;
  const flat = (vals) => { const o = []; vals.forEach(v => Array.isArray(v) ? o.push(...v) : o.push(v)); return o; };
  const collectNumbers = (vals) => {
    let err = null; const ns = [];
    flat(vals).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (typeof v === "number") ns.push(v); });
    return { ns, err };
  };
  // 조회(VLOOKUP/MATCH)용 비교 — 숫자끼리는 수치, 그 외는 대소문자 무시 문자열
  const lookupEqual = (a, b) => (typeof a === "number" && typeof b === "number") ? a === b
    : formulaToString(a).toLowerCase() === formulaToString(b).toLowerCase();
  const lookupCompare = (a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    const sa = formulaToString(a).toLowerCase(), sb = formulaToString(b).toLowerCase();
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
  };
  const makeCriteria = (crit) => {
    if (isFormulaError(crit)) crit = "";
    if (typeof crit === "number") return (v) => (typeof v === "number" ? v === crit : Number(v) === crit);
    const s = String(crit); const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(s); const op = m[1] || "="; const rhs = m[2];
    const rn = Number(rhs.trim()); const rhsIsNum = rhs.trim() !== "" && !isNaN(rn) && isFinite(rn);
    return (v) => {
      if (rhsIsNum){
        const n = (typeof v === "number") ? v : Number(String(v).trim());
        if (isNaN(n) || !isFinite(n)) return op === "<>";
        switch (op){ case "=": return n === rn; case "<>": return n !== rn; case "<": return n < rn; case ">": return n > rn; case "<=": return n <= rn; case ">=": return n >= rn; }
      }
      const sv = formulaToString(v);
      switch (op){ case "=": return sv === rhs; case "<>": return sv !== rhs; case "<": return sv < rhs; case ">": return sv > rhs; case "<=": return sv <= rhs; case ">=": return sv >= rhs; }
      return false;
    };
  };
  const ev = (node) => {
    switch (node.t){
      case "num": return node.v;
      case "str": return node.v;
      case "bool": return node.v;
      case "errlit": return FORMULA_ERR(node.code);
      case "nameref": return FORMULA_ERR("#NAME?");
      case "ref": return res(node.c, node.r, node.sheet);
      case "range": {
        const out = []; const r1 = Math.min(node.r1, node.r2), r2 = Math.max(node.r1, node.r2), c1 = Math.min(node.c1, node.c2), c2 = Math.max(node.c1, node.c2);
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(res(c, r, node.sheet));
        out.__rows = r2 - r1 + 1; out.__cols = c2 - c1 + 1;   // VLOOKUP/INDEX/MATCH 용 2차원 형태 정보
        return out;
      }
      case "unary": {
        const x = formulaToNumber(scal(ev(node.x)));
        if (isFormulaError(x)) return x;
        if (node.op === "%") return x / 100;
        return node.op === "-" ? -x : x;
      }
      case "bin": return evBin(node);
      case "call": return evCall(node);
    }
    return FORMULA_ERR("#ERROR!");
  };
  const evBin = (node) => {
    const op = node.op;
    if (op === "&"){ const a = formulaToString(scal(ev(node.a))); if (isFormulaError(a)) return a; const b = formulaToString(scal(ev(node.b))); if (isFormulaError(b)) return b; return a + b; }
    if (["=", "<>", "<", ">", "<=", ">="].includes(op)){
      const a = scal(ev(node.a)), b = scal(ev(node.b));
      if (isFormulaError(a)) return a; if (isFormulaError(b)) return b;
      let cmp;
      if (typeof a === "number" && typeof b === "number") cmp = a - b;
      else cmp = String(a == null ? "" : a).localeCompare(String(b == null ? "" : b));
      switch (op){ case "=": return cmp === 0; case "<>": return cmp !== 0; case "<": return cmp < 0; case ">": return cmp > 0; case "<=": return cmp <= 0; case ">=": return cmp >= 0; }
    }
    const a = formulaToNumber(scal(ev(node.a))); if (isFormulaError(a)) return a;
    const b = formulaToNumber(scal(ev(node.b))); if (isFormulaError(b)) return b;
    switch (op){ case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return b === 0 ? FORMULA_ERR("#DIV/0!") : a / b; case "^": return Math.pow(a, b); }
    return FORMULA_ERR("#ERROR!");
  };
  const evCall = (node) => {
    const A = () => node.args.map(ev);
    const num1 = (args, k, dflt) => formulaToNumber(scal(args[k] !== undefined ? args[k] : dflt));
    switch (node.name){
      case "SUM": { const { ns, err } = collectNumbers(A()); return err || ns.reduce((s, n) => s + n, 0); }
      case "PRODUCT": { const { ns, err } = collectNumbers(A()); return err || ns.reduce((s, n) => s * n, 1); }
      case "AVERAGE": case "AVG": { const { ns, err } = collectNumbers(A()); return err || (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : FORMULA_ERR("#DIV/0!")); }
      case "MIN": { const { ns, err } = collectNumbers(A()); return err || (ns.length ? Math.min(...ns) : 0); }
      case "MAX": { const { ns, err } = collectNumbers(A()); return err || (ns.length ? Math.max(...ns) : 0); }
      case "COUNT": { const { ns, err } = collectNumbers(A()); return err || ns.length; }
      case "COUNTA": { let err = null, n = 0; flat(A()).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (!(v === "" || v == null)) n++; }); return err || n; }
      case "COUNTBLANK": { let n = 0; flat(A()).forEach(v => { if (v === "" || v == null) n++; }); return n; }
      case "IF": { const args = A(); const c = formulaToBool(scal(args[0])); if (isFormulaError(c)) return c; return c ? scal(args[1] !== undefined ? args[1] : true) : (args.length > 2 ? scal(args[2]) : false); }
      case "IFERROR": { const v = ev(node.args[0]); return isFormulaError(v) ? (node.args[1] !== undefined ? scal(ev(node.args[1])) : "") : scal(v); }
      case "AND": { let err = null, r = true; flat(A()).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (!formulaToBool(v)) r = false; }); return err || r; }
      case "OR": { let err = null, r = false; flat(A()).forEach(v => { if (isFormulaError(v)){ if (!err) err = v; } else if (formulaToBool(v)) r = true; }); return err || r; }
      case "NOT": { const v = formulaToBool(scal(A()[0])); return isFormulaError(v) ? v : !v; }
      case "ROUND": { const args = A(); const x = num1(args, 0); if (isFormulaError(x)) return x; const d = num1(args, 1, 0); if (isFormulaError(d)) return d; const f = Math.pow(10, d); return Math.round(x * f) / f; }
      case "ROUNDUP": { const args = A(); const x = num1(args, 0); if (isFormulaError(x)) return x; const d = num1(args, 1, 0); const f = Math.pow(10, d); return (x < 0 ? -1 : 1) * Math.ceil(Math.abs(x) * f) / f; }
      case "ROUNDDOWN": { const args = A(); const x = num1(args, 0); if (isFormulaError(x)) return x; const d = num1(args, 1, 0); const f = Math.pow(10, d); return (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) * f) / f; }
      case "ABS": { const x = num1(A(), 0); return isFormulaError(x) ? x : Math.abs(x); }
      case "INT": { const x = num1(A(), 0); return isFormulaError(x) ? x : Math.floor(x); }
      case "SQRT": { const x = num1(A(), 0); if (isFormulaError(x)) return x; return x < 0 ? FORMULA_ERR("#NUM!") : Math.sqrt(x); }
      case "MOD": { const args = A(); const a = num1(args, 0); if (isFormulaError(a)) return a; const b = num1(args, 1); if (isFormulaError(b)) return b; return b === 0 ? FORMULA_ERR("#DIV/0!") : ((a % b) + b) % b; }
      case "POWER": { const args = A(); const a = num1(args, 0); if (isFormulaError(a)) return a; const b = num1(args, 1); if (isFormulaError(b)) return b; return Math.pow(a, b); }
      case "LEN": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.length; }
      case "LEFT": { const args = A(); const s = formulaToString(scal(args[0])); if (isFormulaError(s)) return s; const n = args[1] !== undefined ? num1(args, 1) : 1; return s.slice(0, Math.max(0, n)); }
      case "RIGHT": { const args = A(); const s = formulaToString(scal(args[0])); if (isFormulaError(s)) return s; const n = args[1] !== undefined ? num1(args, 1) : 1; return n <= 0 ? "" : s.slice(-n); }
      case "MID": { const args = A(); const s = formulaToString(scal(args[0])); if (isFormulaError(s)) return s; const st = num1(args, 1); const ln = num1(args, 2); return s.substr(Math.max(0, st - 1), Math.max(0, ln)); }
      case "TRIM": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.replace(/\s+/g, " ").trim(); }
      case "UPPER": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.toUpperCase(); }
      case "LOWER": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.toLowerCase(); }
      case "CONCAT": case "CONCATENATE": { let out = ""; for (const v of flat(A())){ if (isFormulaError(v)) return v; out += formulaToString(v); } return out; }
      case "COUNTIF": { if (node.args.length < 2) return FORMULA_ERR("#VALUE!"); const rng = flat([ev(node.args[0])]); const crit = makeCriteria(scal(ev(node.args[1]))); let n = 0; for (const v of rng){ if (isFormulaError(v)) continue; if (crit(v)) n++; } return n; }
      case "SUMIF": { if (node.args.length < 2) return FORMULA_ERR("#VALUE!"); const rng = flat([ev(node.args[0])]); const crit = makeCriteria(scal(ev(node.args[1]))); const sr = node.args[2] !== undefined ? flat([ev(node.args[2])]) : rng; let s = 0; for (let k = 0; k < rng.length; k++){ if (crit(rng[k])){ const n = sr[k]; if (typeof n === "number") s += n; } } return s; }
      case "AVERAGEIF": { const rng = flat([ev(node.args[0])]); const crit = makeCriteria(scal(ev(node.args[1]))); const ar = node.args[2] !== undefined ? flat([ev(node.args[2])]) : rng; let s = 0, cnt = 0; for (let k = 0; k < rng.length; k++){ if (crit(rng[k])){ const n = ar[k]; if (typeof n === "number"){ s += n; cnt++; } } } return cnt ? s / cnt : FORMULA_ERR("#DIV/0!"); }
      case "VLOOKUP": case "HLOOKUP": {
        const args = node.args; if (args.length < 3) return FORMULA_ERR("#VALUE!");
        const key = scal(ev(args[0])); if (isFormulaError(key)) return key;
        const table = ev(args[1]); if (!Array.isArray(table) || !table.__rows) return FORMULA_ERR("#VALUE!");
        const idx = formulaToNumber(scal(ev(args[2]))); if (isFormulaError(idx)) return idx;
        const approx = args[3] !== undefined ? formulaToBool(scal(ev(args[3]))) : true;
        const rows = table.__rows, cols = table.__cols, cell = (r, c) => table[r * cols + c];
        const isV = node.name === "VLOOKUP";
        const lanes = isV ? rows : cols;                 // 검색 방향 길이(세로: 행, 가로: 열)
        const otherMax = isV ? cols : rows;              // 반환 인덱스 최대
        if (idx < 1 || idx > otherMax) return FORMULA_ERR("#REF!");
        const keyAt = (i) => isV ? cell(i, 0) : cell(0, i);
        let found = -1;
        if (approx){ for (let i = 0; i < lanes; i++){ const v = keyAt(i); if (isFormulaError(v)) continue; if (lookupCompare(v, key) <= 0) found = i; else break; } }
        else { for (let i = 0; i < lanes; i++){ const v = keyAt(i); if (!isFormulaError(v) && lookupEqual(v, key)){ found = i; break; } } }
        if (found < 0) return FORMULA_ERR("#N/A");
        return isV ? cell(found, idx - 1) : cell(idx - 1, found);
      }
      case "MATCH": {
        const args = node.args; if (args.length < 2) return FORMULA_ERR("#VALUE!");
        const key = scal(ev(args[0])); if (isFormulaError(key)) return key;
        const arr = flat([ev(args[1])]);
        const type = args[2] !== undefined ? formulaToNumber(scal(ev(args[2]))) : 1;
        if (type === 0){ for (let i = 0; i < arr.length; i++){ if (!isFormulaError(arr[i]) && lookupEqual(arr[i], key)) return i + 1; } return FORMULA_ERR("#N/A"); }
        let pos = -1;
        for (let i = 0; i < arr.length; i++){ const v = arr[i]; if (isFormulaError(v)) continue; const cmp = lookupCompare(v, key); if (type >= 1 ? cmp <= 0 : cmp >= 0) pos = i; else break; }
        return pos < 0 ? FORMULA_ERR("#N/A") : pos + 1;
      }
      case "INDEX": {
        const args = node.args; const arr = ev(args[0]);
        if (!Array.isArray(arr)) return isFormulaError(arr) ? arr : arr;
        const rows = arr.__rows || 1, cols = arr.__cols || arr.length;
        const a1 = formulaToNumber(scal(ev(args[1]))); if (isFormulaError(a1)) return a1;
        if (args[2] !== undefined){                      // INDEX(범위, 행, 열)
          const a2 = formulaToNumber(scal(ev(args[2]))); if (isFormulaError(a2)) return a2;
          if (a1 < 1 || a1 > rows || a2 < 1 || a2 > cols) return FORMULA_ERR("#REF!");
          return arr[(a1 - 1) * cols + (a2 - 1)];
        }
        if (a1 < 1 || a1 > arr.length) return FORMULA_ERR("#REF!");   // 1차원(행/열 벡터)
        return arr[a1 - 1];
      }
      case "TODAY": return Math.floor(spreadsheetDateSerial(new Date()));
      case "NOW": return spreadsheetDateSerial(new Date());
      // ----- 날짜 -----
      case "DATE": { const a = A(); const y = num1(a, 0), m = num1(a, 1), d = num1(a, 2); if (isFormulaError(y)) return y; if (isFormulaError(m)) return m; if (isFormulaError(d)) return d; return spreadsheetDateToSerial(y, m, d); }
      case "YEAR": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).y; }
      case "MONTH": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).mo; }
      case "DAY": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).d; }
      case "HOUR": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).hh; }
      case "MINUTE": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).mm; }
      case "SECOND": { const x = num1(A(), 0); return isFormulaError(x) ? x : spreadsheetSerialToParts(x).ss; }
      case "WEEKDAY": { const a = A(); const x = num1(a, 0); if (isFormulaError(x)) return x; const type = a[1] !== undefined ? num1(a, 1) : 1; const wd = spreadsheetSerialToParts(x).wd; return type === 2 ? (wd === 0 ? 7 : wd) : (type === 3 ? (wd + 6) % 7 : wd + 1); }
      case "EDATE": { const a = A(); const x = num1(a, 0); if (isFormulaError(x)) return x; const mo = num1(a, 1); if (isFormulaError(mo)) return mo; const t = spreadsheetSerialToParts(x); return spreadsheetDateToSerial(t.y, t.mo + mo, t.d, t.hh, t.mm, t.ss); }
      case "DATEDIF": { const a = A(); const s1 = num1(a, 0), s2 = num1(a, 1); if (isFormulaError(s1)) return s1; if (isFormulaError(s2)) return s2; const p1 = spreadsheetSerialToParts(s1), p2 = spreadsheetSerialToParts(s2); const unit = formulaToString(scal(a[2])).toUpperCase(); if (unit === "D") return Math.floor(s2 - s1); if (unit === "M") return (p2.y - p1.y) * 12 + (p2.mo - p1.mo) - (p2.d < p1.d ? 1 : 0); if (unit === "Y") { let yr = p2.y - p1.y; if (p2.mo < p1.mo || (p2.mo === p1.mo && p2.d < p1.d)) yr--; return yr; } return FORMULA_ERR("#NUM!"); }
      // ----- 텍스트 -----
      case "TEXT": { const a = A(); const v = scal(a[0]); if (isFormulaError(v)) return v; return spreadsheetFormatByPattern(v, formulaToString(scal(a[1]))); }
      case "VALUE": { const s = formulaToString(scal(A()[0])); if (isFormulaError(s)) return s; const n = Number(String(s).replace(/[,\s₩$€£¥%]/g, "")); return isFinite(n) ? n : FORMULA_ERR("#VALUE!"); }
      case "SUBSTITUTE": { const a = A(); const s = formulaToString(scal(a[0])); if (isFormulaError(s)) return s; const oldT = formulaToString(scal(a[1])), newT = formulaToString(scal(a[2])); if (oldT === "") return s; if (a[3] !== undefined){ const inst = num1(a, 3); let k = 0; let idx = -1; let from = 0; while ((idx = s.indexOf(oldT, from)) >= 0){ k++; if (k === inst) return s.slice(0, idx) + newT + s.slice(idx + oldT.length); from = idx + oldT.length; } return s; } return s.split(oldT).join(newT); }
      case "REPLACE": { const a = A(); const s = formulaToString(scal(a[0])); if (isFormulaError(s)) return s; const start = num1(a, 1), len = num1(a, 2), newT = formulaToString(scal(a[3])); return s.slice(0, Math.max(0, start - 1)) + newT + s.slice(Math.max(0, start - 1) + Math.max(0, len)); }
      case "FIND": { const a = A(); const sub = formulaToString(scal(a[0])), s = formulaToString(scal(a[1])); if (isFormulaError(sub)) return sub; if (isFormulaError(s)) return s; const start = a[2] !== undefined ? num1(a, 2) : 1; const idx = s.indexOf(sub, Math.max(0, start - 1)); return idx < 0 ? FORMULA_ERR("#VALUE!") : idx + 1; }
      case "SEARCH": { const a = A(); const sub = formulaToString(scal(a[0])).toLowerCase(), s = formulaToString(scal(a[1])).toLowerCase(); const start = a[2] !== undefined ? num1(a, 2) : 1; const idx = s.indexOf(sub, Math.max(0, start - 1)); return idx < 0 ? FORMULA_ERR("#VALUE!") : idx + 1; }
      case "REPT": { const a = A(); const s = formulaToString(scal(a[0])); if (isFormulaError(s)) return s; const n = num1(a, 1); return n > 0 ? s.repeat(Math.min(10000, Math.floor(n))) : ""; }
      case "PROPER": { const s = formulaToString(scal(A()[0])); return isFormulaError(s) ? s : s.replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\B\w/g, ch => ch.toLowerCase()); }
      case "EXACT": { const a = A(); return formulaToString(scal(a[0])) === formulaToString(scal(a[1])); }
      case "TEXTJOIN": { const a = A(); const delim = formulaToString(scal(a[0])); const ignoreEmpty = a[1] !== undefined ? formulaToBool(scal(a[1])) : true; const parts = []; for (const v of flat(a.slice(2))){ if (isFormulaError(v)) return v; const sv = formulaToString(v); if (ignoreEmpty && sv === "") continue; parts.push(sv); } return parts.join(delim); }
      default: return FORMULA_ERR("#NAME?");
    }
  };
  const out = ev(ast);
  return Array.isArray(out) ? (out.length ? out[0] : "") : out;
}
// 편의용(테스트/단발 평가): 오류는 "#..." 문자열, 불리언은 TRUE/FALSE 문자열로 반환
function evaluateFormula(formula, resolver){
  const src = String(formula == null ? "" : formula).replace(/^\s*=/, "");   // 앞의 '=' 는 있어도 됨
  let ast; try { ast = parseFormula(src); } catch(e){ return "#ERROR!"; }
  let r; try { r = evaluateAst(ast, resolver); } catch(e){ return "#ERROR!"; }
  if (isFormulaError(r)) return r.__err;
  if (typeof r === "boolean") return r ? "TRUE" : "FALSE";
  return r;
}
// 수식 문자열의 셀 참조를 transform(col, row, {colAbs,rowAbs}) → {c,r}|null 로 재작성.
// 행/열 삽입·삭제·정렬로 셀이 이동할 때 참조를 따라가게 한다($ 절대표기는 그대로 보존, null 이면 #REF!).
function remapFormulaRefs(formula, transform){
  let toks;
  try { toks = tokenizeFormula(formula); } catch(_){ return formula; }
  let out = "", prev = "";
  for (const tk of toks){
    if (tk.type === "ref" && prev !== "!"){          // prev "!" 이면 시트 간 참조(Sheet2!A1) → 건드리지 않음
      const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(tk.text);
      if (m){
        const colAbs = m[1] === "$", rowAbs = m[3] === "$";
        const res = transform(formulaColumnIndex(m[2]), Number(m[4]) - 1, { colAbs, rowAbs });
        out += (!res || res.c < 0 || res.r < 0)
          ? "#REF!"
          : (colAbs ? "$" : "") + spreadsheetColumnName(res.c) + (rowAbs ? "$" : "") + (res.r + 1);
        prev = tk.text;
        continue;
      }
    }
    out += tk.text;
    prev = tk.text;
  }
  return out;
}

// 선택 데이터로 간단 차트(막대·선·원)를 SVG 문자열로 생성. 오프라인·무의존.
const SPREADSHEET_CHART_COLORS = ["#4f46e5","#10b981","#f59e0b","#ef4444","#0ea5e9","#8b5cf6","#ec4899","#14b8a6","#f97316","#64748b"];
function escapeChartText(s){ return String(s == null ? "" : s).replace(/[<>&]/g, ch => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[ch])); }
function buildSpreadsheetChartSvg(type, labels, values, opts){
  opts = opts || {};
  const W = opts.width || 640, H = opts.height || 380;
  const n = values.length;
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString();
  const axisColor = "#94a3b8", gridColor = "#e2e8f0", textColor = "#334155";
  if (type === "pie"){
    const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const cx = W * 0.36, cy = H / 2, R = Math.min(W * 0.30, H * 0.40);
    let ang = -Math.PI / 2, parts = "";
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total, a2 = ang + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
      const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      const col = SPREADSHEET_CHART_COLORS[i % SPREADSHEET_CHART_COLORS.length];
      parts += n === 1
        ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${col}"/>`
        : `<path d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${col}"/>`;
      ang = a2;
    });
    let legend = "";
    labels.forEach((lab, i) => {
      const ly = 40 + i * 22; const col = SPREADSHEET_CHART_COLORS[i % SPREADSHEET_CHART_COLORS.length];
      const pct = Math.round(Math.max(0, values[i]) / total * 100);
      legend += `<rect x="${W * 0.66}" y="${ly - 10}" width="12" height="12" rx="2" fill="${col}"/>` +
        `<text x="${W * 0.66 + 18}" y="${ly}" font-size="12" fill="${textColor}">${escapeChartText(lab)} · ${pct}%</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts}${legend}</svg>`;
  }
  // 막대/선 공통: 좌표축 + 눈금
  const padL = 52, padR = 18, padT = 24, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(0, ...values), minV = Math.min(0, ...values);
  const span = (maxV - minV) || 1;
  const y = (v) => padT + plotH * (1 - (v - minV) / span);
  const isLine = type === "line";
  // 선: 양 끝까지 채움 / 막대: 구간 중앙(마지막 막대·라벨이 잘리지 않게)
  const x = (i) => isLine ? padL + (n <= 1 ? plotW / 2 : plotW * i / (n - 1))
                          : padL + plotW * (i + 0.5) / n;
  let grid = "", ticks = 5;
  for (let t = 0; t <= ticks; t++){
    const v = minV + span * t / ticks, yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="${gridColor}"/>` +
      `<text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${textColor}">${fmt(v)}</text>`;
  }
  let body = "", xlabels = "";
  const labelStep = Math.ceil(n / 12);
  for (let i = 0; i < n; i++){
    if (i % labelStep === 0)
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - padB + 16}" font-size="11" text-anchor="middle" fill="${textColor}">${escapeChartText(labels[i])}</text>`;
  }
  if (type === "line"){
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    body += `<polyline points="${pts}" fill="none" stroke="${SPREADSHEET_CHART_COLORS[0]}" stroke-width="2.5"/>`;
    values.forEach((v, i) => { body += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${SPREADSHEET_CHART_COLORS[0]}"/>`; });
  } else {
    const bw = Math.max(4, (n <= 1 ? plotW * 0.4 : plotW / n * 0.66));
    values.forEach((v, i) => {
      const bx = x(i) - bw / 2, top = Math.min(y(v), y(0)), h = Math.abs(y(v) - y(0));
      body += `<rect x="${bx.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${SPREADSHEET_CHART_COLORS[i % SPREADSHEET_CHART_COLORS.length]}"/>`;
    });
  }
  const zeroY = y(0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    grid +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${axisColor}"/>` +
    `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="${axisColor}"/>` +
    body + xlabels + `</svg>`;
}

function spreadsheetVirtualWindow(totalRows, scrollTop, viewportHeight, rowHeight=29, overscan=14){
  const total = Math.max(0, Number(totalRows) || 0);
  const height = Math.max(1, Number(rowHeight) || 29);
  const extra = Math.max(0, Number(overscan) || 0);
  const count = Math.min(total, Math.max(20, Math.ceil((Number(viewportHeight) || 500) / height) + extra * 2));
  const start = Math.max(0, Math.min(Math.max(0, total - count), Math.floor((Number(scrollTop) || 0) / height) - extra));
  return {
    start,
    count,
    topHeight:start * height,
    bottomHeight:Math.max(0, (total - start - count) * height)
  };
}

function writeStructuredSpreadsheetModel(ws, model, merges){
  const existingMerges = (ws && ws.model && Array.isArray(ws.model.merges)) ? ws.model.merges.slice() : [];
  existingMerges.forEach(range => { try { ws.unMergeCells(range); } catch(_){} });
  if (ws.rowCount > model.length) ws.spliceRows(model.length + 1, ws.rowCount - model.length);
  for (let r = 0; r < model.length; r++){
    for (let c = 0; c < model[r].length; c++){
      const snapshot = model[r][c];
      const cell = ws.getCell(r + 1, c + 1);
      if (snapshot.f){                                   // 수식 셀: 수식 + 마지막 계산 결과를 함께 저장
        const result = (snapshot.v === "" || snapshot.v == null) ? null : cloneSpreadsheetValue(snapshot.v);
        cell.value = { formula: snapshot.f, result };
        cell.style = cloneSpreadsheetValue(snapshot.style || {});
        continue;
      }
      const value = snapshot.xv !== undefined ? snapshot.xv : snapshot.v;
      cell.value = (value === "" ? null : cloneSpreadsheetValue(value));
      // 빈 스타일도 명시적으로 써야 정렬 전 위치의 서식이 새 셀에 잔류하지 않는다.
      cell.style = cloneSpreadsheetValue(snapshot.style || {});
    }
  }
  (merges || []).forEach(range => { try { ws.mergeCells(range); } catch(_){} });
}

async function renderXlsx(file, host, doc){
  if (typeof XLSX === "undefined"){ toast("Excel 뷰어 로드 실패"); return; }
  const csvFastAoa = doc && Array.isArray(doc.spreadsheetAoa) ? doc.spreadsheetAoa : null;
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (looksEncryptedOffice(bytes)){
    const dec = await promptAndDecrypt(bytes, "xlsx");
    if (!dec) throw new Error("cancelled");             // 취소/실패 → 드롭존
    bytes = dec;
  }
  if (/\.csv$/i.test(file.name)){
    renderCsvPreview(smartDecodeText(bytes), host, file.name, doc);
    return;
  }
  let wb;
  if (csvFastAoa){
    const rows = Math.max(1, csvFastAoa.length);
    const cols = Math.max(1, csvFastAoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0));
    // 변환 직후에는 이미 CSV 행 배열이 있으므로 같은 XLSX를 SheetJS로 다시 풀지 않는다.
    wb = { SheetNames:["Sheet1"], Sheets:{ Sheet1:{ "!ref":"A1:" + spreadsheetColumnName(cols - 1) + rows } } };
  } else {
    try { wb = XLSX.read(bytes, { type: "array" }); } catch(e){ wb = null; }
  }
  // 한컴 한셀 등에서 일부 시트가 비어버리거나(또는 파싱 실패) 하면 정화 후 재시도
  if (!csvFastAoa && (!wb || wb.SheetNames.some(n => !wb.Sheets[n]))){
    const fixed = sanitizeHancomSpreadsheet(bytes);
    if (fixed !== bytes){
      try { wb = XLSX.read(fixed, { type: "array" }); } catch(e){ /* 원본 결과 유지 */ }
    }
  }
  if (!wb || !wb.SheetNames.length){ host.textContent = "시트가 없습니다."; return; }
  if (!csvFastAoa) wb.SheetNames.forEach(n => tightenSheetRange(wb.Sheets[n]));   // 부풀려진 시트 크기 보정(속도)
  const tabs = document.createElement("div"); tabs.className = "xlsx-tabs";
  const sheet = document.createElement("div"); sheet.className = "xlsx-sheet";

  // ===== 내보내기: 현재 시트를 CSV/XLSX 로, 또는 전체 통합문서를 XLSX 로 다운로드 =====
  let currentSheet = wb.SheetNames[0];
  const base = sheetBaseName(file.name);
  const exp = document.createElement("div"); exp.className = "xlsx-export";
  const expLabel = document.createElement("span"); expLabel.className = "xlsx-export-label"; expLabel.textContent = "내보내기:";
  const mkExp = (text, title, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.title = title;
    b.addEventListener("click", () => { try { fn(); } catch(e){ console.error(e); toast("내보내지 못했어요.", 2200); } });
    return b;
  };
  // 편집 모델이 있으면 그 값(수식 계산 결과 포함)으로 내보내기용 시트를 만든다.
  // CSV 변환본은 SheetJS wb 가 껍데기(스텁)라 편집 모델이 유일한 데이터 원본이다.
  const exportSheetOf = (name) => {
    const model = exModels[name];
    if (!model) return wb.Sheets[name];
    try { maybeRecalc(name); } catch(_){}
    const aoa = model.map(row => row.map(cell => {
      const val = cell ? cell.v : null;
      if (val == null || val === "") return null;
      if (typeof val === "object" && !(val instanceof Date)) return dispCell(cell);   // 리치텍스트 등은 표시 문자열로
      return val;
    }));
    return XLSX.utils.aoa_to_sheet(aoa);
  };
  const csvBtn = mkExp("현재 시트 CSV", "현재 시트를 CSV 파일로 저장(Excel 호환 UTF-8)", () => {
    const csv = "﻿" + XLSX.utils.sheet_to_csv(exportSheetOf(currentSheet));   // BOM: Excel 한글 깨짐 방지
    downloadSpreadsheetFile(csv, base + "_" + sanitizeFilePart(currentSheet) + ".csv", "text/csv;charset=utf-8");
    toast("현재 시트를 CSV로 저장했어요.", 1800, { type: "success" });
  });
  const sheetXlsxBtn = mkExp("현재 시트 XLSX", "현재 시트만 새 XLSX 파일로 저장(시트 분리)", () => {
    const nb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(nb, exportSheetOf(currentSheet), sanitizeFilePart(currentSheet).slice(0, 31) || "Sheet1");
    const out = XLSX.write(nb, { type: "array", bookType: "xlsx" });
    downloadSpreadsheetFile(out, base + "_" + sanitizeFilePart(currentSheet) + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    toast("현재 시트를 XLSX로 저장했어요.", 1800, { type: "success" });
  });
  // 내보내기 버튼은 별도 래퍼로 묶어, 편집 모드에서만 이 래퍼를 숨긴다(모드 토글은 항상 보이게).
  const expBtns = document.createElement("div"); expBtns.className = "xlsx-export-btns";
  expBtns.append(expLabel, csvBtn, sheetXlsxBtn);
  if (wb.SheetNames.length > 1){
    expBtns.append(mkExp("전체 XLSX", "모든 시트를 한 XLSX 파일로 저장", () => {
      let out;
      if (Object.keys(exModels).length){                       // 편집한 시트가 있으면 편집 반영본으로 재구성
        const nb = XLSX.utils.book_new();
        wb.SheetNames.forEach(n => XLSX.utils.book_append_sheet(nb, exportSheetOf(n), n.slice(0, 31) || "Sheet1"));
        out = XLSX.write(nb, { type: "array", bookType: "xlsx" });
      } else {
        out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      }
      downloadSpreadsheetFile(out, base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast("전체 시트를 XLSX로 저장했어요.", 1800, { type: "success" });
    }));
  }

  // ===== 편집·정렬·필터 모드 (ExcelJS 백엔드 — 셀 서식·색·글꼴·번호서식·병합·수식 보존) =====
  // 보기 모드는 SheetJS(sheet_to_html) 유지. 편집은 원본 바이트를 ExcelJS 로 읽어 '편집한 셀만' 되돌려 써서
  // 손대지 않은 셀의 서식·수식·병합을 그대로 보존한다. 정렬/행·열 구조 변경이 일어난 시트만 전체 재작성.
  let editMode = !!(doc && doc.isScratch);
  const editTitle = document.createElement("strong"); editTitle.className = "xlsx-edit-title"; editTitle.textContent = "편집 도구";
  const editToggle = document.createElement("button"); editToggle.type = "button"; editToggle.className = "xlsx-editmode-btn";
  editToggle.title = "셀 편집·정렬·필터 모드 (저장 시 서식 보존)";
  const syncEditToggle = () => {
    editToggle.textContent = editMode ? "읽기 전용" : "표 편집·정렬";
    editToggle.title = editMode ? "편집을 마치고 읽기 전용으로 전환" : "셀 편집·정렬·필터 모드로 전환";
    editToggle.classList.toggle("active", editMode);
    editTitle.hidden = !editMode;
    exp.classList.toggle("editing", editMode);
  };
  syncEditToggle();
  editToggle.addEventListener("click", () => { editMode = !editMode; syncEditToggle(); rerender(); });
  exp.append(editTitle, editToggle, expBtns);

  const editBar = document.createElement("div"); editBar.className = "xlsx-editbar"; editBar.hidden = true;
  // 수식 입력줄(활성 셀 참조 + 값/수식 편집) — 편집 모드에서만 표시
  const formulaBar = document.createElement("div"); formulaBar.className = "xlsx-formulabar"; formulaBar.hidden = true;
  const fbRef = document.createElement("span"); fbRef.className = "xlsx-fb-ref"; fbRef.textContent = "";
  const fbInput = document.createElement("input"); fbInput.type = "text"; fbInput.className = "xlsx-fb-input";
  fbInput.placeholder = "값 또는 =수식 (예: =SUM(A1:A3))"; fbInput.disabled = true;
  formulaBar.append(fbRef, fbInput);
  let fbCell = null;
  host.appendChild(tabs); host.appendChild(exp); host.appendChild(editBar); host.appendChild(formulaBar); host.appendChild(sheet);

  // ----- ExcelJS 워크북 로드(최초 편집 진입 시 1회, 원본 바이트에서) -----
  let exWb = null, exLoadPromise = null;
  const ensureExWb = async () => {
    if (exWb) return exWb;
    if (typeof ExcelJS === "undefined") return null;
    if (!exLoadPromise){
      exLoadPromise = (async () => {
        const w = new ExcelJS.Workbook();
        await w.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        return w;
      })();
    }
    try { exWb = await exLoadPromise; } catch(e){ console.error(e); exWb = null; exLoadPromise = null; }
    return exWb;
  };

  // ----- 셀 값/표시 헬퍼 -----
  const exRaw = (cell) => {
    let v = cell && cell.value;
    if (v === null || v === undefined) return "";
    if (typeof v === "object"){
      if (v instanceof Date) return v;
      if (v.formula !== undefined || v.sharedFormula !== undefined) return (v.result !== undefined && v.result !== null) ? v.result : "";
      if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("");
      if (v.text !== undefined) return v.text;          // 하이퍼링크
      if (v.error !== undefined) return v.error;
      return "";
    }
    return v;
  };
  const dateToSerial = (d) => 25569 + (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000;
  const dispCell = (s) => {
    const v = s.v;
    if (v === "" || v === null || v === undefined) return "";
    if (v instanceof Date){
      if (s.nf){ try { return XLSX.SSF.format(s.nf, dateToSerial(v)); } catch(_){} }
      return v.toISOString().slice(0, 10);
    }
    if (typeof v === "number" && s.nf){ try { return XLSX.SSF.format(s.nf, v); } catch(_){ return String(v); } }
    return String(v);
  };
  const rawText = (s) => (s.v instanceof Date) ? dispCell(s) : (s.v === "" || s.v == null ? "" : String(s.v));
  const coerce = (text) => {
    const t = String(text).trim();
    if (t === "") return "";
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);   // 순수 숫자만 number(콤마/통화/% 는 문자열 유지)
    return text;
  };

  // ----- 시트별 편집 모델: [[ {v, nf, style} ]] + 변경 추적 -----
  const exModels = {};            // name -> model(2D snapshots)
  const exMerges = {};            // name -> 원본 병합 ["A1:B2", ...]
  const editedCells = {};         // name -> Map("r,c" -> value)  (구조변경 전 값 편집만)
  const styledCells = {};         // name -> Map("r,c" -> true)   (구조변경 전 서식 편집만)
  const structChanged = new Set();// 구조(정렬·행/열) 바뀐 시트 → 저장 시 전체 재작성
  const sheetsWithFormula = new Set();  // 수식이 하나라도 있는 시트 → 편집 시 재계산 대상
  let csvFastModelPromise = null;
  let anyDirty = false;
  const blankCell = () => ({ v: "", xv: null, nf: null, style: {}, f: null });
  const cellFormula = (cell) => {                        // 수식 셀이면 '=' 없는 수식 문자열, 아니면 null
    const val = cell && cell.value;
    if (val && typeof val === "object" && (val.formula !== undefined || val.sharedFormula !== undefined)){
      const f = cell.formula || val.formula;
      return f ? String(f) : null;
    }
    return null;
  };
  const buildExModel = (ws, name) => {
    let rowN = Math.max(1, ws.rowCount || 1), colN = Math.max(1, ws.columnCount || 1);
    if (doc && doc.isScratch){ rowN = Math.max(rowN, 12); colN = Math.max(colN, 6); }   // 새 빈 표는 넉넉한 격자
    const model = [];
    for (let r = 1; r <= rowN; r++){
      const row = [];
      for (let c = 1; c <= colN; c++){
        const cell = ws.getCell(r, c);
        let style = {}; try { style = cloneSpreadsheetValue(cell.style || {}); } catch(_){ style = {}; }
        const f = cellFormula(cell);
        if (f && name) sheetsWithFormula.add(name);
        row.push({ v: exRaw(cell), xv: spreadsheetCellValueSnapshot(cell), nf: cell.numFmt || null, style, f });
      }
      model.push(row);
    }
    return model;
  };
  const buildCsvFastModel = async () => {
    const rowN = Math.max(1, csvFastAoa.length);
    const colN = Math.max(1, csvFastAoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0));
    const model = [];
    for (let r = 0; r < rowN; r++){
      const source = csvFastAoa[r] || [];
      const row = new Array(colN);
      for (let c = 0; c < colN; c++){
        const value = source[c] == null ? "" : source[c];
        row[c] = { v:value, xv:value === "" ? null : value, nf:null, style:{}, f:null };
      }
      model.push(row);
      if (r > 0 && r % 400 === 0){
        sheet.textContent = "CSV 편집 데이터를 준비하는 중… " + Math.min(r, rowN).toLocaleString() + " / " + rowN.toLocaleString() + "행";
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    // 셀 스냅샷으로 옮긴 뒤 원본 CSV 배열 참조를 비워 메모리 이중 점유를 피한다.
    csvFastAoa.length = 0;
    if (doc) doc.spreadsheetAoa = null;
    return model;
  };
  const exModelFor = async (name) => {
    if (exModels[name]) return exModels[name];
    if (csvFastAoa){
      exMerges[name] = [];
      editedCells[name] = new Map();
      styledCells[name] = new Map();
      if (!csvFastModelPromise) csvFastModelPromise = buildCsvFastModel();
      exModels[name] = await csvFastModelPromise;
      return exModels[name];
    }
    const w = await ensureExWb();
    if (!w) return null;
    const ws = w.getWorksheet(name) || w.worksheets[0];
    exMerges[name] = (ws && ws.model && Array.isArray(ws.model.merges)) ? ws.model.merges.slice() : [];
    editedCells[name] = new Map();
    styledCells[name] = new Map();
    exModels[name] = ws ? buildExModel(ws, name) : [[blankCell()]];
    if (sheetsWithFormula.size) recalcAll();   // 로드 직후 결과를 한 번 새로 계산(시트 간 참조 포함)
    return exModels[name];
  };
  const markEdit = (name, r, c, val) => {
    anyDirty = true;
    if (!structChanged.has(name)) editedCells[name].set(r + "," + c, val);   // 타깃 저장용 기록
  };

  // ----- 수식 재계산 -----
  const astCache = new Map();
  const getAst = (f) => {
    if (astCache.has(f)) return astCache.get(f);
    let ast = null; try { ast = parseFormula(f); } catch(_){ ast = null; }
    astCache.set(f, ast);
    return ast;
  };
  // 워크북 전체 수식 재계산(시트 간 참조 지원 · 메모이즈 · 순환참조 감지).
  // 각 수식 셀의 v 를 결과로 갱신하고, { 시트이름: [{r,c}] } 를 반환.
  const findModelSheet = (nm) => {
    if (exModels[nm]) return nm;
    const lower = String(nm).toLowerCase();
    return Object.keys(exModels).find(k => k.toLowerCase() === lower)
      || (wb.SheetNames || []).find(k => k.toLowerCase() === lower) || nm;
  };
  const recalcAll = () => {
    if (!sheetsWithFormula.size) return {};
    const cache = new Map(), computing = new Set();
    const resolve = (c, r, sheetName, home) => {
      const nm = findModelSheet(sheetName || home);
      const model = exModels[nm];
      if (!model) return (wb.SheetNames || []).some(s => s.toLowerCase() === String(nm).toLowerCase()) ? "" : FORMULA_ERR("#REF!");
      if (r < 0 || c < 0 || r >= model.length || !model[r] || c >= model[r].length) return "";
      const key = nm + " " + r + "," + c;
      if (cache.has(key)) return cache.get(key);
      const s = model[r][c];
      if (!s.f){ let v = s.v; if (v instanceof Date) v = spreadsheetDateSerial(v); else if (v == null) v = ""; cache.set(key, v); return v; }
      if (computing.has(key)){ const e = FORMULA_ERR("#CYCLE!"); cache.set(key, e); return e; }
      computing.add(key);
      const ast = getAst(s.f);
      let res = FORMULA_ERR("#NAME?");
      if (ast){ try { res = evaluateAst(ast, (cc, rr, sh) => resolve(cc, rr, sh, nm)); } catch(_){ res = FORMULA_ERR("#ERROR!"); } }
      if (Array.isArray(res)) res = res.length ? res[0] : "";
      computing.delete(key);
      cache.set(key, res);
      return res;
    };
    const updatedBySheet = {};
    Object.keys(exModels).forEach(nm => {
      if (!sheetsWithFormula.has(nm)) return;
      const model = exModels[nm]; const upd = [];
      for (let r = 0; r < model.length; r++){
        if (!model[r]) continue;
        for (let c = 0; c < model[r].length; c++){
          const s = model[r][c]; if (!s.f) continue;
          const res = resolve(c, r, nm, nm);
          s.v = isFormulaError(res) ? res.__err : (typeof res === "boolean" ? (res ? "TRUE" : "FALSE") : res);
          upd.push({ r, c });
        }
      }
      updatedBySheet[nm] = upd;
    });
    return updatedBySheet;
  };
  const maybeRecalc = () => { recalcAll(); };
  // 시트 간 참조 해석을 위해 모든 시트 모델을 미리 만든다(다중 시트 워크북 첫 편집 시 1회).
  let allSheetsBuilt = false;
  const ensureAllModelsBuilt = async () => {
    if (csvFastAoa || allSheetsBuilt) return;
    for (const nm of (wb.SheetNames || [])){ if (!exModels[nm]) await exModelFor(nm); }
    allSheetsBuilt = true;
  };
  // 행/열 삽입·삭제·정렬 시 모든 수식 셀의 참조를 transform 으로 이동시킨다(수식이 있는 시트에서만).
  const remapModelFormulas = (name, transform) => {
    if (!sheetsWithFormula.has(name)) return;
    const model = exModels[name]; if (!model) return;
    const copiedRows = new Set();
    for (let r = 0; r < model.length; r++){
      if (!model[r]) continue;
      for (let c = 0; c < model[r].length; c++){
        const s = model[r][c];
        if (!s || !s.f) continue;
        const nf = remapFormulaRefs(s.f, transform);
        if (nf === s.f) continue;
        if (csvFastAoa){
          if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
          model[r][c] = { ...model[r][c], f:nf };
        } else {
          s.f = nf;
        }
      }
    }
  };
  const recalcAndRefresh = () => {
    if (!sheetsWithFormula.size) return;
    sheetsWithFormula.forEach(nm => { if (exModels[nm]) structChanged.add(nm); });   // 결과가 바뀔 수 있어 전체 재작성
    anyDirty = true;
    const updated = recalcAll();
    const model = exModels[currentSheet];
    (updated[currentSheet] || []).forEach(({ r, c }) => {
      const td = modelCellTd(r, c);
      if (td && model && model[r] && model[r][c]){ const s = model[r][c]; td.textContent = dispCell(s); td.classList.toggle("num", typeof s.v === "number"); }
    });
  };

  // ----- 셀 서식(채우기·테두리) 편집 헬퍼 -----
  const argbToCss = (argb) => {
    if (!argb || typeof argb !== "string") return null;
    const h = argb.length === 8 ? argb.slice(2) : (argb.length === 6 ? argb : null);   // ExcelJS 는 AARRGGBB
    return h && /^[0-9a-fA-F]{6}$/.test(h) ? ("#" + h) : null;
  };
  const cssToArgb = (hex) => "FF" + String(hex).replace(/^#/, "").toUpperCase();
  // 엑셀 테두리 스타일(thin/medium/thick/dashed/dotted/double …) → CSS border 문자열
  const borderSideCss = (side) => {
    if (!side || !side.style) return "";
    const color = (side.color && argbToCss(side.color.argb)) || "#475569";
    const style = String(side.style);
    if (style === "double") return "3px double " + color;
    const type = (style === "dashed" || style === "mediumDashed") ? "dashed"
      : (style === "dotted") ? "dotted" : "solid";
    const width = (style === "thick" || style === "medium" || style === "mediumDashed") ? "2px" : "1px";
    return width + " " + type + " " + color;
  };
  // 모델 셀의 style(fill/border/font/alignment) → <td> 인라인 스타일로 반영(편집·보기 공통 렌더)
  const applyCellStyleToTd = (td, s) => {
    const st = (s && s.style) || {};
    const fill = (st.fill && st.fill.pattern === "solid" && st.fill.fgColor) ? argbToCss(st.fill.fgColor.argb) : null;
    // 테두리 렌더: 격자(border-collapse)와의 충돌을 피하려고 격자 위에 덧그린다.
    //  · 실선(얇게/중간/굵게) → box-shadow(--cell-border)
    //  · 점선/점선 → 배경 그라디언트 레이어 + 해당 변의 격자선을 hidden 으로 억제(격자가 점선을 덮지 않게)
    //  · 이중선 → border(3px 라 충돌에서 이김)
    const b = st.border || {};
    const shadow = [], bgLayers = [], bgPos = [], bgSize = [];
    const SIDE = {
      top:    { prop:"borderTop",    styleProp:"borderTopStyle",    dir:"to right",  pos:"left top",    size:"100% 1px", shadow:(w, c) => "inset 0 " + w + "px 0 0 " + c },
      bottom: { prop:"borderBottom", styleProp:"borderBottomStyle", dir:"to right",  pos:"left bottom", size:"100% 1px", shadow:(w, c) => "inset 0 -" + w + "px 0 0 " + c },
      left:   { prop:"borderLeft",   styleProp:"borderLeftStyle",   dir:"to bottom", pos:"left top",    size:"1px 100%", shadow:(w, c) => "inset " + w + "px 0 0 0 " + c },
      right:  { prop:"borderRight",  styleProp:"borderRightStyle",  dir:"to bottom", pos:"right top",   size:"1px 100%", shadow:(w, c) => "inset -" + w + "px 0 0 0 " + c }
    };
    ["top", "bottom", "left", "right"].forEach(name => {
      const cfg = SIDE[name], side = b[name];
      td.style[cfg.prop] = ""; td.style[cfg.styleProp] = "";   // 매 렌더마다 초기화(격자 기본값으로)
      if (!side || !side.style) return;
      const style = String(side.style);
      const color = (side.color && argbToCss(side.color.argb)) || "#475569";
      if (style === "double"){ td.style[cfg.prop] = "3px double " + color; return; }
      if (style === "dashed" || style === "mediumDashed" || style === "dotted"){
        const on = style === "dotted" ? 1 : 3, off = style === "dotted" ? 2 : 3;
        td.style[cfg.styleProp] = "hidden";                    // 격자선 억제 → 점선이 가려지지 않음
        bgLayers.push("repeating-linear-gradient(" + cfg.dir + "," + color + " 0," + color + " " + on + "px,transparent " + on + "px,transparent " + (on + off) + "px)");
        bgPos.push(cfg.pos); bgSize.push(cfg.size);
        return;
      }
      const w = style === "thick" ? 3 : (style === "medium" ? 2 : 1);
      shadow.push(cfg.shadow(w, color));
    });
    td.style.setProperty("--cell-border", shadow.length ? shadow.join(", ") : "0 0 transparent");
    // 채우기 색 + 점선 테두리 배경 레이어 합성
    td.style.backgroundColor = fill || "";
    if (bgLayers.length){
      td.style.backgroundImage = bgLayers.join(", ");
      td.style.backgroundPosition = bgPos.join(", ");
      td.style.backgroundSize = bgSize.join(", ");
      td.style.backgroundRepeat = "no-repeat";
    } else {
      td.style.backgroundImage = ""; td.style.backgroundPosition = ""; td.style.backgroundSize = ""; td.style.backgroundRepeat = "";
    }
    // 글꼴: 굵게·기울임·밑줄·글자색·크기·글꼴
    const f = st.font || {};
    td.style.fontWeight = f.bold ? "700" : "";
    td.style.fontStyle = f.italic ? "italic" : "";
    td.style.textDecoration = f.underline ? "underline" : "";
    td.style.color = (f.color && argbToCss(f.color.argb)) || "";
    td.style.fontSize = (typeof f.size === "number" && f.size > 0) ? (f.size + "pt") : "";
    td.style.fontFamily = (f.name && typeof f.name === "string") ? f.name : "";
    // 정렬: 가로·세로·자동 줄바꿈
    const a = st.alignment || {};
    const h = a.horizontal;
    td.style.textAlign = (h === "left" || h === "center" || h === "right" || h === "justify") ? h : "";
    td.style.verticalAlign = (a.vertical === "top" || a.vertical === "middle" || a.vertical === "bottom") ? a.vertical : "";
    td.style.whiteSpace = a.wrapText ? "normal" : "";
    td.classList.toggle("xlsx-wrap", !!a.wrapText);
  };
  const markStyle = (name, r, c) => {
    anyDirty = true;
    if (!structChanged.has(name)) (styledCells[name] || (styledCells[name] = new Map())).set(r + "," + c, true);
  };
  // 현재 선택의 첫 셀 style(토글 버튼이 현재 상태를 읽어 켜기/끄기를 판단)
  const firstSelectedStyle = () => {
    const td = sheet.querySelector('td.sheet-selected[data-mrow]');
    if (!td) return null;
    const model = exModels[currentSheet];
    const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
    return (model && model[r] && model[r][c]) ? (model[r][c].style || {}) : null;
  };
  // 선택된(td.sheet-selected) 셀에 서식 변경을 적용하고 즉시 인라인 반영(선택 유지).
  // mutate(s, ctx) — ctx: { r,c, r1,r2,c1,c2 } 선택 범위 경계(바깥쪽 테두리 등에 사용)
  const applyFormatToSelection = (mutate) => {
    const model = exModels[currentSheet]; if (!model) return 0;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length){ toast("먼저 셀을 선택하세요.", 1800); return 0; }
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      if (r < r1) r1 = r; if (r > r2) r2 = r; if (c < c1) c1 = c; if (c > c2) c2 = c;
    });
    pushUndo(currentSheet);
    let n = 0;
    const copiedRows = new Set();
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      let s = model[r] && model[r][c]; if (!s) return;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        s = { ...s, style:cloneSpreadsheetValue(s.style || {}) };
        model[r][c] = s;
      }
      s.style = s.style || {};
      mutate(s, { r, c, r1, r2, c1, c2 });
      applyCellStyleToTd(td, s);
      td.textContent = dispCell(s);                    // 표시형식 변경도 즉시 반영
      td.classList.toggle("num", typeof s.v === "number");
      markStyle(currentSheet, r, c);
      n++;
    });
    return n;
  };
  const setSelectionFill = (hex) => {
    const n = applyFormatToSelection(s => {
      s.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cssToArgb(hex) } };
    });
    if (n) toast(n + "개 셀에 채우기 적용(선택 해제 시 보임)", 1800);
  };
  // 테두리: where = all(전체) · outline(바깥쪽) · inside(내부) · inside-h(안쪽 가로) · inside-v(안쪽 세로) · top/bottom/left/right · none(지움)
  const setSelectionBorder = (hex, styleName, where) => {
    const n = applyFormatToSelection((s, ctx) => {
      const side = () => ({ style: styleName || "thin", color: { argb: cssToArgb(hex) } });
      const b = { ...(s.style.border || {}) };
      const insideH = where === "inside" || where === "inside-h";   // 안쪽 가로선(위/아래로 이웃이 더 있을 때)
      const insideV = where === "inside" || where === "inside-v";   // 안쪽 세로선(좌/우로 이웃이 더 있을 때)
      if (where === "none"){ delete b.top; delete b.bottom; delete b.left; delete b.right; }
      else if (where === "all"){ b.top = side(); b.bottom = side(); b.left = side(); b.right = side(); }
      else if (where === "outline"){
        if (ctx.r === ctx.r1) b.top = side();
        if (ctx.r === ctx.r2) b.bottom = side();
        if (ctx.c === ctx.c1) b.left = side();
        if (ctx.c === ctx.c2) b.right = side();
      }
      else if (insideH || insideV){
        // 각 내부선을 한쪽(아래·오른쪽)에서만 그림 → 양쪽 중복으로 2배 굵어 보이던 문제 해결
        if (insideH && ctx.r < ctx.r2) b.bottom = side();
        if (insideV && ctx.c < ctx.c2) b.right = side();
      }
      else if (where === "top") b.top = side();
      else if (where === "bottom") b.bottom = side();
      else if (where === "left") b.left = side();
      else if (where === "right") b.right = side();
      s.style.border = b;
    });
    if (n) toast(n + "개 셀에 테두리 적용", 1500);
  };
  const clearSelectionFormat = () => {
    const n = applyFormatToSelection(s => {
      delete s.style.fill; delete s.style.border; delete s.style.font; delete s.style.alignment;
      delete s.style.numFmt; s.nf = null;
    });
    if (n) toast(n + "개 셀의 서식 제거", 1600);
  };
  // 글꼴 — 굵게·기울임·밑줄(토글), 글자색, 크기, 글꼴
  const toggleFontProp = (prop, label) => {
    const st0 = firstSelectedStyle();
    const on = !(st0 && st0.font && st0.font[prop]);
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}) };
      if (on) s.style.font[prop] = true; else delete s.style.font[prop];
    });
    if (n) toast(n + "개 셀 " + label + (on ? " 적용" : " 해제"), 1300);
  };
  const setFontColor = (hex) => {
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}), color: { argb: cssToArgb(hex) } };
    });
    if (n) toast(n + "개 셀 글자색 적용", 1300);
  };
  const setFontSize = (pt) => {
    const size = Number(pt);
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}) };
      if (size > 0) s.style.font.size = size; else delete s.style.font.size;
    });
    if (n) toast(n + "개 셀 글자 크기 변경", 1300);
  };
  const setFontName = (name) => {
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}) };
      if (name) s.style.font.name = name; else delete s.style.font.name;
    });
    if (n) toast(n + "개 셀 글꼴 변경", 1300);
  };
  // 정렬 — 가로·세로·자동 줄바꿈
  const setAlign = (horizontal) => {
    const n = applyFormatToSelection(s => {
      s.style.alignment = { ...(s.style.alignment || {}) };
      if (horizontal) s.style.alignment.horizontal = horizontal; else delete s.style.alignment.horizontal;
    });
    if (n) toast(n + "개 셀 정렬", 1100);
  };
  const setVAlign = (vertical) => {
    const n = applyFormatToSelection(s => {
      s.style.alignment = { ...(s.style.alignment || {}) };
      if (vertical) s.style.alignment.vertical = vertical; else delete s.style.alignment.vertical;
    });
    if (n) toast(n + "개 셀 세로 정렬", 1100);
  };
  const toggleWrap = () => {
    const st0 = firstSelectedStyle();
    const on = !(st0 && st0.alignment && st0.alignment.wrapText);
    const n = applyFormatToSelection(s => {
      s.style.alignment = { ...(s.style.alignment || {}) };
      if (on) s.style.alignment.wrapText = true; else delete s.style.alignment.wrapText;
    });
    if (n) toast(n + "개 셀 자동 줄바꿈 " + (on ? "켜기" : "끄기"), 1100);
  };
  // 표시형식(번호서식) — code가 빈값이면 '일반'(서식 제거)
  const setNumberFormat = (code) => {
    const n = applyFormatToSelection(s => {
      if (code){ s.style.numFmt = code; s.nf = code; }
      else { delete s.style.numFmt; s.nf = null; }
    });
    if (n) toast(n + "개 셀 표시형식 적용", 1300);
  };

  // ----- 서식 복사 붓(선택 셀 서식 복제 → 다른 선택에 붙이기) -----
  let copiedFormat = null;
  const copyCellFormat = () => {
    const st = firstSelectedStyle();
    if (st == null){ toast("서식을 복사할 셀을 먼저 선택하세요.", 1900); return; }
    copiedFormat = cloneSpreadsheetValue(st || {});
    toast("서식을 복사했어요. 대상 선택 후 '서식 붙이기'.", 2400);
  };
  const pasteCellFormat = () => {
    if (!copiedFormat){ toast("먼저 '서식 복사'를 누르세요.", 1900); return; }
    const n = applyFormatToSelection(s => {
      s.style = cloneSpreadsheetValue(copiedFormat);
      s.nf = copiedFormat.numFmt || null;
    });
    if (n) toast(n + "개 셀에 서식을 붙였어요.", 1500);
  };

  // ----- 찾기·바꿈(현재 시트 · 선택이 있으면 선택 범위만, 대/소문자 무시) -----
  const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replaceAllInSheet = (findStr, replStr) => {
    if (!findStr){ toast("찾을 내용을 입력하세요.", 1600); return; }
    const model = exModels[currentSheet]; if (!model) return;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    const scope = marked.length ? new Set(marked.map(td => td.dataset.mrow + "," + td.dataset.mcol)) : null;
    const re = () => new RegExp(escapeRegExp(findStr), "gi");
    const changes = [];
    for (let r = 0; r < model.length; r++){
      for (let c = 0; c < model[r].length; c++){
        if (scope && !scope.has(r + "," + c)) continue;
        const s = model[r][c];
        if (s.f) continue;                              // 수식 셀은 결과값을 바꾸지 않는다
        if (s.v === "" || s.v == null) continue;
        const orig = (s.v instanceof Date) ? dispCell(s) : String(s.v);
        const replaced = orig.replace(re(), replStr);
        if (replaced !== orig) changes.push({ r, c, val: coerce(replaced) });
      }
    }
    if (!changes.length){ toast("바꿀 내용을 찾지 못했어요.", 1700); return; }
    pushUndo(currentSheet);
    const copiedRows = new Set();
    changes.forEach(({ r, c, val }) => {
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        model[r][c] = { ...model[r][c], v:val, xv: val === "" ? null : val, style:cloneSpreadsheetValue(model[r][c].style || {}) };
      } else {
        const s = model[r][c]; s.v = val; s.xv = val === "" ? null : val;
        if (!structChanged.has(currentSheet)) markEdit(currentSheet, r, c, val);
      }
    });
    anyDirty = true;
    renderEditable(currentSheet);
    toast(changes.length + "곳을 바꿨어요" + (scope ? "(선택 범위)" : "") + ".", 1900);
  };

  // ----- 조건부 강조(선택 범위에서 조건에 맞는 셀만 채우기 색 적용 — 저장 시 고정 서식으로 남음) -----
  const highlightByCondition = (op, rawVal, hex) => {
    const model = exModels[currentSheet]; if (!model) return;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length){ toast("강조할 범위를 먼저 선택하세요.", 2000); return; }
    const num = parseFloat(String(rawVal).replace(/[,\s₩$€£¥%]/g, ""));
    const toNum = (v) => (typeof v === "number") ? v : parseFloat(String(v).replace(/[,\s₩$€£¥%]/g, ""));
    const test = (v) => {
      if (op === "contains") return String(v).toLowerCase().includes(String(rawVal).toLowerCase());
      const n = toNum(v);
      if (!isFinite(n) || !isFinite(num)) return false;
      switch (op){
        case "ge": return n >= num; case "gt": return n > num;
        case "le": return n <= num; case "lt": return n < num;
        case "eq": return n === num; case "ne": return n !== num;
      }
      return false;
    };
    const hits = marked.filter(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      const s = model[r] && model[r][c];
      return s && s.v !== "" && s.v != null && test(s.v);
    });
    if (!hits.length){ toast("조건에 맞는 셀이 없어요.", 1700); return; }
    pushUndo(currentSheet);
    const copiedRows = new Set();
    hits.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      let s = model[r][c];
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        s = { ...s, style:cloneSpreadsheetValue(s.style || {}) }; model[r][c] = s;
      }
      s.style = s.style || {};
      s.style.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: cssToArgb(hex) } };
      applyCellStyleToTd(td, s);
      markStyle(currentSheet, r, c);
    });
    anyDirty = true;
    toast(hits.length + "개 셀을 강조했어요.", 1600);
  };

  // ----- 차트: 선택 범위에서 (라벨, 값) 추출 → SVG 미리보기 모달 -----
  const extractChartData = () => {
    const model = exModels[currentSheet]; if (!model) return null;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    marked.forEach(td => { const r = +td.dataset.mrow, c = +td.dataset.mcol; r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c); });
    const cellVal = (r, c) => (model[r] && model[r][c]) ? model[r][c].v : "";
    const asNum = (v) => (typeof v === "number") ? v : parseFloat(String(v == null ? "" : v).replace(/[,\s₩$€£¥%]/g, ""));
    const labels = [], values = [];
    const twoCol = (c2 - c1) >= 1;
    for (let r = r1; r <= r2; r++){
      const val = asNum(cellVal(r, twoCol ? c1 + 1 : c1));
      if (!isFinite(val)) continue;                     // 값이 숫자인 행만(머리글 행 자동 제외)
      labels.push(twoCol ? String(cellVal(r, c1)) : String(r + 1));
      values.push(val);
    }
    return values.length ? { labels, values } : null;
  };
  // 차트: 드래그로 이동·모서리로 크기 조절 가능한 떠 있는 패널(배경을 가리지 않아 표가 보임)
  let chartModal = null;
  const openChartModal = (data) => {
    if (!chartModal){
      chartModal = document.createElement("div"); chartModal.className = "xlsx-chart-modal"; chartModal.hidden = true;
      chartModal.innerHTML =
        '<div class="xlsx-chart-head">' +
        '<strong>차트</strong>' +
        '<span class="xlsx-chart-types"><button data-t="bar">막대</button><button data-t="line">선</button><button data-t="pie">원</button></span>' +
        '<span class="xlsx-chart-actions"><button data-a="memo">📝 메모에 넣기</button><button data-a="png">PNG 저장</button><button data-a="close">닫기</button></span>' +
        '</div><div class="xlsx-chart-canvas" draggable="true" title="이미지를 메모로 드래그하거나 \'메모에 넣기\'를 누르세요"></div>';
      document.body.appendChild(chartModal);
      const head = chartModal.querySelector(".xlsx-chart-head");
      const canvas = chartModal.querySelector(".xlsx-chart-canvas");
      const chartFileName = () => sanitizeFilePart(base || "chart") + "_chart.png";
      // 현재 차트를 2배 해상도 PNG로 렌더 → 드래그용 dataURL + 버튼용 Blob 을 준비(그릴 때마다 갱신)
      chartModal._preparePng = () => {
        chartModal._pngBlob = null; chartModal._pngUrl = "";
        const svg = canvas.querySelector("svg"); if (!svg) return;
        const vb = svg.viewBox && svg.viewBox.baseVal, W = (vb && vb.width) || 640, H = (vb && vb.height) || 380;
        const xml = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas"); cv.width = Math.round(W * 2); cv.height = Math.round(H * 2);
          const ctx = cv.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          try { chartModal._pngUrl = cv.toDataURL("image/png"); } catch(_){}
          cv.toBlob((blob) => { chartModal._pngBlob = blob; }, "image/png");
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      };
      const pngBlobNow = async () => {
        if (chartModal._pngBlob) return chartModal._pngBlob;
        if (chartModal._pngUrl){ try { return await (await fetch(chartModal._pngUrl)).blob(); } catch(_){} }
        return null;
      };
      chartModal._draw = () => {
        const tp = chartModal._type || "bar";
        chartModal.querySelectorAll(".xlsx-chart-types button").forEach(b => b.classList.toggle("active", b.dataset.t === tp));
        const w = Math.max(320, Math.round(canvas.clientWidth)), h = Math.max(200, Math.round(canvas.clientHeight));
        canvas.innerHTML = buildSpreadsheetChartSvg(tp, chartModal._data.labels, chartModal._data.values, { width: w, height: h });
        chartModal._preparePng();
      };
      chartModal._png = async () => {
        const blob = await pngBlobNow();
        if (blob) downloadSpreadsheetFile(blob, chartFileName(), "image/png");
        else toast("차트 이미지를 만들지 못했어요.", 2000);
      };
      chartModal._toMemo = async () => {
        if (typeof window.addImagesToScratchpad !== "function"){ toast("메모 기능을 사용할 수 없어요.", 2200); return; }
        const blob = await pngBlobNow();
        if (!blob){ toast("차트 이미지를 만들지 못했어요.", 2000); return; }
        try {
          await window.addImagesToScratchpad([new File([blob], chartFileName(), { type: "image/png" })], { name: (base || "차트") + " 차트" });
          toast("차트를 메모에 넣었어요.", 1600);
        } catch(e){ console.error(e); toast("메모에 넣지 못했어요.", 2000); }
      };
      // 캔버스를 메모로 직접 드래그(미리 만든 PNG dataURL, 없으면 SVG로 폴백)
      canvas.addEventListener("dragstart", (e) => {
        const svg = canvas.querySelector("svg");
        let url = chartModal._pngUrl;
        if (!url && svg) url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
        if (!url || !e.dataTransfer) return;
        try {
          e.dataTransfer.setData("text/uri-list", url);
          e.dataTransfer.setData("text/plain", url);
          e.dataTransfer.setData("text/html", '<img src="' + url + '" alt="chart">');
          e.dataTransfer.effectAllowed = "copy";
          if (svg) e.dataTransfer.setDragImage(svg, 20, 20);
        } catch(_){}
      });
      chartModal.addEventListener("click", (e) => {
        const d = e.target.dataset || {};
        if (d.a === "close"){ chartModal.hidden = true; return; }
        if (d.t){ chartModal._type = d.t; chartModal._draw(); }
        if (d.a === "png") chartModal._png();
        if (d.a === "memo") chartModal._toMemo();
      });
      // 헤더 드래그로 이동
      let drag = null;
      head.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        const rect = chartModal.getBoundingClientRect();
        drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        chartModal.style.left = rect.left + "px"; chartModal.style.top = rect.top + "px";
        chartModal.style.right = "auto"; chartModal.style.bottom = "auto"; chartModal.style.transform = "none";
        try { head.setPointerCapture(e.pointerId); } catch(_){}
        e.preventDefault();
      });
      head.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const nx = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
        const ny = Math.max(0, Math.min(window.innerHeight - 36, e.clientY - drag.dy));
        chartModal.style.left = nx + "px"; chartModal.style.top = ny + "px";
      });
      const endDrag = (e) => { if (drag){ try { head.releasePointerCapture(e.pointerId); } catch(_){} drag = null; } };
      head.addEventListener("pointerup", endDrag);
      head.addEventListener("pointercancel", endDrag);
      // 크기 조절(모서리 드래그) → 다시 그림
      let rafId = 0;
      if (typeof ResizeObserver === "function"){
        new ResizeObserver(() => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; if (!chartModal.hidden) chartModal._draw(); }); }).observe(canvas);
      }
      window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chartModal.hidden) chartModal.hidden = true; });
    }
    chartModal._data = data; chartModal._type = "bar";
    chartModal.hidden = false;
    requestAnimationFrame(() => chartModal._draw());
  };
  const insertChart = () => {
    const data = extractChartData();
    if (!data){ toast("차트로 만들 숫자 범위를 선택하세요(라벨 열 + 값 열).", 2600); return; }
    openChartModal(data);
  };

  // ----- 선택 범위 → 이미지: 모델(값·서식) + 화면 셀 크기로 canvas 에 그려 PNG 생성 -----
  const SELIMG_MAX_PX = 4000;
  const captureSelectionCanvas = () => {
    const model = exModels[currentSheet]; if (!model) return null;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    const colW = {}, rowH = {};
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c);
      const rect = td.getBoundingClientRect();
      if (colW[c] == null) colW[c] = Math.max(24, rect.width);
      if (rowH[r] == null) rowH[r] = Math.max(16, rect.height);
    });
    for (let c = c1; c <= c2; c++) if (!colW[c]) colW[c] = 80;
    for (let r = r1; r <= r2; r++) if (!rowH[r]) rowH[r] = 24;
    const xAt = {}, yAt = {}; let totalW = 0, totalH = 0;
    for (let c = c1; c <= c2; c++){ xAt[c] = totalW; totalW += colW[c]; }
    for (let r = r1; r <= r2; r++){ yAt[r] = totalH; totalH += rowH[r]; }
    totalW = Math.round(totalW); totalH = Math.round(totalH);
    if (totalW < 1 || totalH < 1) return null;
    let scale = 2;
    if (totalW * scale > SELIMG_MAX_PX || totalH * scale > SELIMG_MAX_PX) scale = Math.max(1, Math.min(SELIMG_MAX_PX / totalW, SELIMG_MAX_PX / totalH));
    const cv = document.createElement("canvas");
    cv.width = Math.round(totalW * scale); cv.height = Math.round(totalH * scale);
    const ctx = cv.getContext("2d"); ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, totalW, totalH);
    ctx.textBaseline = "middle";
    const stroke = (x1, y1, x2, y2, color, w, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    };
    const sideSpec = (side) => {
      const style = String(side.style), color = (side.color && argbToCss(side.color.argb)) || "#475569";
      const w = style === "thick" ? 3 : (style === "medium" || style === "double") ? 2 : 1;
      const dash = (style === "dashed" || style === "mediumDashed") ? [4, 3] : (style === "dotted") ? [1, 3] : [];
      return { color, w, dash };
    };
    // 1) 채우기 + 텍스트
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++){
      const s = model[r] && model[r][c]; if (!s) continue;
      const stl = s.style || {}, x = xAt[c], y = yAt[r], w = colW[c], h = rowH[r];
      const fill = (stl.fill && stl.fill.pattern === "solid" && stl.fill.fgColor) ? argbToCss(stl.fill.fgColor.argb) : null;
      if (fill){ ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      const text = dispCell(s);
      if (text !== "" && text != null){
        const f = stl.font || {}, a = stl.alignment || {};
        const px = (typeof f.size === "number" && f.size > 0) ? Math.round(f.size * 96 / 72) : 13;
        ctx.font = (f.italic ? "italic " : "") + (f.bold ? "700 " : "400 ") + px + "px " + (f.name ? ("'" + f.name + "',") : "") + "'Malgun Gothic',sans-serif";
        ctx.fillStyle = (f.color && argbToCss(f.color.argb)) || "#1e293b";
        const isNum = typeof s.v === "number";
        const align = (a.horizontal === "center" || a.horizontal === "right" || a.horizontal === "left") ? a.horizontal : (isNum ? "right" : "left");
        ctx.textAlign = align;
        const tx = align === "center" ? x + w / 2 : (align === "right" ? x + w - 5 : x + 5);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.fillText(String(text), tx, y + h / 2 + 0.5);
        ctx.restore();
      }
    }
    // 2) 기본 격자(연한 회색)
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++){
      const x = xAt[c], y = yAt[r], w = colW[c], h = rowH[r];
      stroke(x + 0.5, y + 0.5, x + w - 0.5, y + 0.5, "#d7dee8", 1);
      stroke(x + 0.5, y + h - 0.5, x + w - 0.5, y + h - 0.5, "#d7dee8", 1);
      stroke(x + 0.5, y + 0.5, x + 0.5, y + h - 0.5, "#d7dee8", 1);
      stroke(x + w - 0.5, y + 0.5, x + w - 0.5, y + h - 0.5, "#d7dee8", 1);
    }
    // 3) 사용자 지정 테두리(격자 위에 덧그림)
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++){
      const s = model[r] && model[r][c]; if (!s || !s.style || !s.style.border) continue;
      const b = s.style.border, x = xAt[c], y = yAt[r], w = colW[c], h = rowH[r];
      const one = (side, x1, y1, x2, y2) => { if (side && side.style){ const sp = sideSpec(side); stroke(x1, y1, x2, y2, sp.color, sp.w, sp.dash); } };
      one(b.top, x, y + 0.5, x + w, y + 0.5);
      one(b.bottom, x, y + h - 0.5, x + w, y + h - 0.5);
      one(b.left, x + 0.5, y, x + 0.5, y + h);
      one(b.right, x + w - 0.5, y, x + w - 0.5, y + h);
    }
    return cv;
  };
  const saveSelectionToMemo = () => {
    const cv = captureSelectionCanvas();
    if (!cv){ toast("이미지로 만들 셀 범위를 먼저 선택하세요.", 2400); return; }
    cv.toBlob((blob) => {
      if (!blob){ toast("이미지를 만들지 못했어요.", 2200); return; }
      const name = sanitizeFilePart(base || "표") + "_선택.png";
      if (typeof window.addImagesToScratchpad === "function"){
        Promise.resolve(window.addImagesToScratchpad([new File([blob], name, { type: "image/png" })], { name: (base || "표") + " 선택 영역" }))
          .then(() => toast("선택 영역을 이미지로 메모에 넣었어요.", 1900))
          .catch((e) => { console.error(e); downloadSpreadsheetFile(blob, name, "image/png"); toast("메모에 못 넣어 이미지로 저장했어요.", 2600); });
      } else {
        downloadSpreadsheetFile(blob, name, "image/png");
        toast("선택 영역을 이미지로 저장했어요.", 1900, { type: "success" });
      }
    }, "image/png");
  };

  // ----- 되돌리기 / 다시실행 (시트별 스냅샷 스택) -----
  const undoStacks = {};          // name -> [snapshot]
  const redoStacks = {};          // name -> [snapshot]
  const MAX_UNDO = 40;
  let undoBtn = null, redoBtn = null;
  const cloneModel = (model) => {
    if (typeof structuredClone === "function"){ try { return structuredClone(model); } catch(_){} }
    return (model || []).map(row => row.map(s => ({
      v: cloneSpreadsheetValue(s.v),
      xv: cloneSpreadsheetValue(s.xv),
      nf: s.nf,
      style: cloneSpreadsheetValue(s.style || {}),
      f: s.f || null
    })));
  };
  const snapshot = (name) => ({
    // CSV 변환본은 수정할 행만 복사하는 copy-on-write 모델이라 최상위 행 배열만 보관해도 안전하다.
    model: csvFastAoa ? (exModels[name] || []).slice() : cloneModel(exModels[name] || []),
    edited: new Map(editedCells[name] || []),
    styled: new Map(styledCells[name] || []),
    merges: (exMerges[name] || []).slice(),
    struct: structChanged.has(name)
  });
  const restoreSnapshot = (name, snap) => {
    exModels[name] = csvFastAoa ? (snap.model || []).slice() : cloneModel(snap.model);
    editedCells[name] = new Map(snap.edited);
    styledCells[name] = new Map(snap.styled);
    exMerges[name] = (snap.merges || []).slice();
    if (snap.struct) structChanged.add(name); else structChanged.delete(name);
  };
  const recomputeDirty = () => {
    anyDirty = structChanged.size > 0
      || Object.values(editedCells).some(m => m && m.size)
      || Object.values(styledCells).some(m => m && m.size);
  };
  const updateUndoButtons = () => {
    if (undoBtn) undoBtn.disabled = !((undoStacks[currentSheet] || []).length);
    if (redoBtn) redoBtn.disabled = !((redoStacks[currentSheet] || []).length);
  };
  // 각 편집 직전 호출: 현재 상태를 undo 스택에 저장하고 redo 무효화
  const pushUndo = (name) => {
    const st = undoStacks[name] || (undoStacks[name] = []);
    st.push(snapshot(name));
    if (st.length > MAX_UNDO) st.shift();
    redoStacks[name] = [];
    updateUndoButtons();
  };
  const applyRestore = (name, targetStack, otherStack) => {
    (otherStack[name] || (otherStack[name] = [])).push(snapshot(name));
    restoreSnapshot(name, targetStack[name].pop());
    recomputeDirty();
    buildEditBar();                 // 편집 버튼 클로저가 새 model 참조를 캡처하도록 툴바 재생성
    renderEditable(name);
    updateUndoButtons();
    try { sheet.focus({ preventScroll: true }); } catch(_){}
  };
  const doUndo = () => {
    const name = currentSheet;
    if (!(undoStacks[name] || []).length){ toast("되돌릴 작업이 없어요.", 1400); return; }
    applyRestore(name, undoStacks, redoStacks);
  };
  const doRedo = () => {
    const name = currentSheet;
    if (!(redoStacks[name] || []).length){ toast("다시 실행할 작업이 없어요.", 1400); return; }
    applyRestore(name, redoStacks, undoStacks);
  };
  // Del/Backspace: 선택 셀의 내용 삭제(서식은 유지 — 엑셀과 동일)
  const clearSelectionContents = () => {
    const model = exModels[currentSheet]; if (!model) return false;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return false;
    const cellAt = (td) => { const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol); return model[r] && model[r][c] ? { r, c, s:model[r][c] } : null; };
    if (!marked.some(td => { const x = cellAt(td); return x && ((x.s.v !== "" && x.s.v != null) || x.s.f); })) return false;   // 이미 다 비어있으면 무시
    pushUndo(currentSheet);
    const copiedRows = new Set();
    let hadFormula = false, n = 0;
    marked.forEach(td => {
      const x = cellAt(td); if (!x) return;
      const { r, c } = x;
      if (model[r][c].f) hadFormula = true;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        model[r][c] = { ...model[r][c], v:"", xv:null, f:null, style:cloneSpreadsheetValue(model[r][c].style || {}) };
      } else {
        const s = model[r][c]; s.v = ""; s.xv = null; s.f = null;
        if (!structChanged.has(currentSheet)) markEdit(currentSheet, r, c, "");
      }
      td.textContent = ""; td.classList.remove("num");
      n++;
    });
    anyDirty = true;
    if (hadFormula) structChanged.add(currentSheet);   // 수식 삭제는 전체 재작성으로 저장
    recalcAndRefresh(currentSheet);                     // 지운 셀에 의존하던 수식 갱신
    toast(n + "개 셀 내용을 지웠어요.", 1200);
    return true;
  };

  // Ctrl+Z / Ctrl+Y(또는 Ctrl+Shift+Z), Del/Backspace: 편집 모드에서 시트에 포커스가 있을 때
  sheet.addEventListener("keydown", (e) => {
    if (!editMode) return;
    const t = e.target;
    if (t && t.closest && t.closest('[contenteditable="true"]')) return;   // 셀 편집 중엔 네이티브 동작
    if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey){
      if (sheet.querySelector('td.sheet-selected[data-mrow]')){   // 선택이 있으면 브라우저 뒤로가기 등 기본동작 차단
        e.preventDefault(); e.stopPropagation();
        clearSelectionContents();
      }
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key).toLowerCase();
    if (k === "z" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); doUndo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)){ e.preventDefault(); e.stopPropagation(); doRedo(); }
  });

  let editState = { filter: "", headerFrozen: true, sortCol: -1, sortDir: 1 };
  const virtualCsvEditor = !!csvFastAoa && csvFastAoa.length *
    Math.max(1, csvFastAoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)) > 12000;

  const matchingModelRows = (model, editable) => {
    const head = editState.headerFrozen ? 1 : 0;
    const term = editable ? editState.filter.trim().toLowerCase() : "";
    const result = [];
    for (let r = 0; r < model.length; r++){
      if (editable && term && r >= head && !model[r].some(s => dispCell(s).toLowerCase().includes(term))) continue;
      result.push(r);
    }
    return result;
  };
  // 병합 정보 → 좌상단 span 맵 + 가려지는 셀 집합. 편집 모드는 격자를 평평하게 유지(선택·편집 정확도)하되
  // 병합 위치를 점선 힌트로 표시하고, 읽기 전용 모드에서는 실제 colspan/rowspan 으로 합쳐 그린다.
  const mergeRenderInfo = () => {
    const list = exMerges[currentSheet] || [];
    const covered = new Set(), spanAt = new Map();
    list.forEach(text => {
      const rg = decodeSpreadsheetMerge(text); if (!rg) return;
      spanAt.set(rg.s.r + "," + rg.s.c, { rs: rg.e.r - rg.s.r + 1, cs: rg.e.c - rg.s.c + 1 });
      for (let r = rg.s.r; r <= rg.e.r; r++)
        for (let c = rg.s.c; c <= rg.e.c; c++)
          if (!(r === rg.s.r && c === rg.s.c)) covered.add(r + "," + c);
    });
    return { covered, spanAt };
  };
  const tableFromModel = (model, editable, options={}) => {
    const cols = model.length ? model[0].length : 1;
    const head = editState.headerFrozen ? 1 : 0;
    const rowIndexes = options.rowIndexes || matchingModelRows(model, editable);
    const { covered, spanAt } = mergeRenderInfo();
    const table = document.createElement("table"), body = document.createElement("tbody");
    const spacer = (height, where) => {
      if (!(height > 0)) return;
      const tr = document.createElement("tr"); tr.className = "xlsx-virtual-spacer xlsx-virtual-spacer-" + where;
      const td = document.createElement("td"); td.colSpan = cols + 1; td.style.height = height + "px";
      tr.appendChild(td); body.appendChild(tr);
    };
    spacer(options.topHeight, "top");
    for (const r of rowIndexes){
      const tr = document.createElement("tr");
      if (head && r < head) tr.className = "xlsx-edit-header";
      for (let c = 0; c < cols; c++){
        const key = r + "," + c;
        if (!editable && covered.has(key)) continue;       // 읽기 전용: 가려지는 셀은 생략(좌상단이 span)
        const s = model[r][c];
        const td = document.createElement("td");
        td.textContent = dispCell(s);
        if (typeof s.v === "number") td.classList.add("num");
        applyCellStyleToTd(td, s);                       // 채우기·테두리 서식 반영
        const sp = spanAt.get(key);
        if (editable){
          td.dataset.mrow = String(r); td.dataset.mcol = String(c);
          if (sp) td.classList.add("xlsx-merged-anchor");
          else if (covered.has(key)) td.classList.add("xlsx-merged-cover");
        } else if (sp){
          if (sp.rs > 1) td.rowSpan = sp.rs;
          if (sp.cs > 1) td.colSpan = sp.cs;
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    spacer(options.bottomHeight, "bottom");
    table.appendChild(body);
    return table;
  };

  const clearVirtualEditor = () => {
    if (typeof sheet._xlsxVirtualCleanup === "function") sheet._xlsxVirtualCleanup();
    sheet.classList.remove("xlsx-virtualized");
  };
  const bindEditableTable = (table, name) => {
    table.addEventListener("dblclick", (e) => {
      const td = e.target.closest('td[data-mcol]');
      if (td) startCellEdit(td, name);
    });
  };
  const renderVirtualModel = (name, editable) => {
    const model = exModels[name];
    const rowIndexes = matchingModelRows(model, editable);
    const rowHeight = 29, overscan = 14;
    let lastStart = -1, frame = 0, disposed = false;
    sheet.classList.add("xlsx-virtualized");
    const draw = (force=false) => {
      frame = 0;
      if (disposed) return;
      const windowState = spreadsheetVirtualWindow(rowIndexes.length, sheet.scrollTop, sheet.clientHeight, rowHeight, overscan);
      if (!force && windowState.start === lastStart) return;
      lastStart = windowState.start;
      const visible = rowIndexes.slice(windowState.start, windowState.start + windowState.count);
      const topBefore = sheet.scrollTop, leftBefore = sheet.scrollLeft;
      const table = tableFromModel(model, editable, {
        rowIndexes:visible, topHeight:windowState.topHeight, bottomHeight:windowState.bottomHeight
      });
      sheet.replaceChildren(table);
      enhanceSpreadsheetSelection(sheet, name, { editable, rowLabels:visible, onSelectionChange: editable ? onCellSelect : undefined });
      if (editable) bindEditableTable(table, name);
      sheet.scrollTop = topBefore; sheet.scrollLeft = leftBefore;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => draw(false));
    };
    sheet.addEventListener("scroll", onScroll);
    sheet._xlsxVirtualCleanup = () => {
      disposed = true;
      sheet.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      delete sheet._xlsxVirtualCleanup;
    };
    draw(true);
  };

  // ===== 자동 채우기 핸들: 선택 우하단 사각형을 끌어 값 채우기(숫자 수열은 이어서, 그 외는 복사) =====
  const fillHandle = document.createElement("div");
  fillHandle.className = "sheet-fill-handle";
  fillHandle.title = "끌어서 자동 채우기";
  let fillState = null;
  const fillSelBounds = () => {
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    const rs = marked.map(td => Number(td.dataset.mrow)), cs = marked.map(td => Number(td.dataset.mcol));
    return { r1:Math.min(...rs), r2:Math.max(...rs), c1:Math.min(...cs), c2:Math.max(...cs) };
  };
  const modelCellTd = (r, c) => sheet.querySelector('td[data-mrow="' + r + '"][data-mcol="' + c + '"]');
  function positionFillHandle(){
    if (fillState) return;                        // 드래그 중엔 위치 고정
    if (!editMode){ if (fillHandle.parentNode) fillHandle.remove(); return; }
    const b = fillSelBounds();
    const br = b && modelCellTd(b.r2, b.c2);
    if (!br){ if (fillHandle.parentNode) fillHandle.remove(); return; }
    br.appendChild(fillHandle);
  }
  // 수식 입력줄 갱신: 활성(기준) 셀의 참조와 값/수식을 표시
  const updateFormulaBar = () => {
    if (!editMode){ formulaBar.hidden = true; return; }
    formulaBar.hidden = false;
    const anchor = sheet.querySelector('td.sheet-anchor[data-mrow]') || sheet.querySelector('td.sheet-selected[data-mrow]');
    if (!anchor){ fbCell = null; fbRef.textContent = ""; fbInput.disabled = true; if (document.activeElement !== fbInput) fbInput.value = ""; return; }
    const r = Number(anchor.dataset.mrow), c = Number(anchor.dataset.mcol);
    fbCell = { r, c };
    fbRef.textContent = spreadsheetColumnName(c) + (r + 1);
    fbInput.disabled = false;
    const model = exModels[currentSheet];
    const s = model && model[r] && model[r][c];
    if (document.activeElement !== fbInput) fbInput.value = s ? ((s.f != null && s.f !== "") ? ("=" + s.f) : rawText(s)) : "";
  };
  fbInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      if (fbCell) applyCellInput(currentSheet, fbCell.r, fbCell.c, fbInput.value);
      try { sheet.focus({ preventScroll:true }); } catch(_){ }
      updateFormulaBar();
    } else if (e.key === "Escape"){
      e.preventDefault(); updateFormulaBar(); try { sheet.focus(); } catch(_){ }
    }
    e.stopPropagation();
  });
  // 선택이 바뀌면 채우기 핸들 위치 + 수식 입력줄을 함께 갱신
  const onCellSelect = () => { positionFillHandle(); updateFormulaBar(); };
  const clearFillPreview = () => sheet.querySelectorAll(".sheet-fill-preview").forEach(el => el.classList.remove("sheet-fill-preview"));
  // 숫자 수열이면 마지막 간격만큼 이어서 생성, 아니면 원본 값을 순환 복사
  const fillSeries = (vals) => {
    const nums = vals.map(v => (typeof v === "number") ? v : null);
    if (nums.length && nums.every(n => n != null)){
      const base = nums[nums.length - 1];
      const step = nums.length === 1 ? 1 : (nums[nums.length - 1] - nums[nums.length - 2]);
      return (i) => base + step * (i + 1);
    }
    return (i) => vals[i % vals.length];
  };
  const applyFill = (src, t) => {
    const model = exModels[currentSheet]; if (!model) return;
    pushUndo(currentSheet);
    const copiedRows = new Set();
    // val(리터럴) 또는 f(수식, 있으면 우선) 로 대상 셀을 채운다.
    const setCell = (r, c, val, f) => {
      if (!model[r] || !model[r][c]) return;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        const prev = model[r][c];
        model[r][c] = f
          ? { ...prev, f, style:cloneSpreadsheetValue(prev.style || {}) }
          : { ...prev, v:val, xv: val === "" ? null : val, f:null, style:cloneSpreadsheetValue(prev.style || {}) };
      } else {
        const s = model[r][c];
        if (f){ s.f = f; }
        else { s.v = val; s.xv = val === "" ? null : val; s.f = null; if (!structChanged.has(currentSheet)) markEdit(currentSheet, r, c, val); }
      }
      if (f) sheetsWithFormula.add(currentSheet);
      const td = modelCellTd(r, c);                // 수식 셀은 recalcAndRefresh가 값을 채워 갱신, 리터럴은 여기서 바로
      if (td && !f){ td.textContent = dispCell(model[r][c]); td.classList.toggle("num", typeof model[r][c].v === "number"); applyCellStyleToTd(td, model[r][c]); }
    };
    // 수식이 섞인 원본은 셀 단위로 복제(수식은 상대참조를 이동 델타만큼 조정), 순수 숫자는 등차수열 연장.
    const shiftRow = (delta) => (cc, rr, ab) => ({ c: cc, r: ab.rowAbs ? rr : rr + delta });
    const shiftCol = (delta) => (cc, rr, ab) => ({ c: ab.colAbs ? cc : cc + delta, r: rr });
    if (t.axis === "v"){
      const down = t.r2 > src.r2;
      for (let c = src.c1; c <= src.c2; c++){
        const srcCells = []; for (let r = src.r1; r <= src.r2; r++) srcCells.push(model[r][c]);
        const H = srcCells.length;
        if (srcCells.every(s => !s.f && typeof s.v === "number")){         // 순수 숫자 → 등차 연장
          const gen = fillSeries(down ? srcCells.map(s => s.v) : srcCells.map(s => s.v).slice().reverse());
          let i = 0;
          if (down) for (let r = src.r2 + 1; r <= t.r2; r++) setCell(r, c, gen(i++), null);
          else for (let r = src.r1 - 1; r >= t.r1; r--) setCell(r, c, gen(i++), null);
        } else {                                                            // 그 외 → 패턴 순환(수식은 참조 조정)
          let i = 0;
          const put = (r) => {
            const idx = i % H, sIdx = down ? idx : (H - 1 - idx);
            const s = srcCells[sIdx], srcRow = down ? (src.r1 + sIdx) : (src.r2 - sIdx);
            if (s.f) setCell(r, c, null, remapFormulaRefs(s.f, shiftRow(r - srcRow)));
            else setCell(r, c, s.v, null);
            i++;
          };
          if (down) for (let r = src.r2 + 1; r <= t.r2; r++) put(r);
          else for (let r = src.r1 - 1; r >= t.r1; r--) put(r);
        }
      }
    } else {
      const right = t.c2 > src.c2;
      for (let r = src.r1; r <= src.r2; r++){
        const srcCells = []; for (let c = src.c1; c <= src.c2; c++) srcCells.push(model[r][c]);
        const W = srcCells.length;
        if (srcCells.every(s => !s.f && typeof s.v === "number")){
          const gen = fillSeries(right ? srcCells.map(s => s.v) : srcCells.map(s => s.v).slice().reverse());
          let i = 0;
          if (right) for (let c = src.c2 + 1; c <= t.c2; c++) setCell(r, c, gen(i++), null);
          else for (let c = src.c1 - 1; c >= t.c1; c--) setCell(r, c, gen(i++), null);
        } else {
          let i = 0;
          const put = (c) => {
            const idx = i % W, sIdx = right ? idx : (W - 1 - idx);
            const s = srcCells[sIdx], srcCol = right ? (src.c1 + sIdx) : (src.c2 - sIdx);
            if (s.f) setCell(r, c, null, remapFormulaRefs(s.f, shiftCol(c - srcCol)));
            else setCell(r, c, s.v, null);
            i++;
          };
          if (right) for (let c = src.c2 + 1; c <= t.c2; c++) put(c);
          else for (let c = src.c1 - 1; c >= t.c1; c--) put(c);
        }
      }
    }
    anyDirty = true;
    recalcAndRefresh(currentSheet);              // 채운 값에 의존하는 수식 갱신
    toast("자동 채우기 완료", 1100);
  };
  fillHandle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const b = fillSelBounds(); if (!b) return;
    fillState = { src:b, target:null };
    try { fillHandle.setPointerCapture(e.pointerId); } catch(_){}
  });
  fillHandle.addEventListener("pointermove", (e) => {
    if (!fillState) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const td = el && el.closest && el.closest('td[data-mrow]');
    if (!td) return;
    const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol), b = fillState.src;
    const down = Math.max(0, r - b.r2), up = Math.max(0, b.r1 - r);
    const rightN = Math.max(0, c - b.c2), leftN = Math.max(0, b.c1 - c);
    const vert = Math.max(down, up), horiz = Math.max(rightN, leftN);
    let target = null;
    if (vert >= horiz && vert > 0) target = { r1:Math.min(b.r1, r), r2:Math.max(b.r2, r), c1:b.c1, c2:b.c2, axis:"v" };
    else if (horiz > 0) target = { r1:b.r1, r2:b.r2, c1:Math.min(b.c1, c), c2:Math.max(b.c2, c), axis:"h" };
    fillState.target = target;
    clearFillPreview();
    if (target){
      for (let rr = target.r1; rr <= target.r2; rr++)
        for (let cc = target.c1; cc <= target.c2; cc++){
          if (rr >= b.r1 && rr <= b.r2 && cc >= b.c1 && cc <= b.c2) continue;
          const cell = modelCellTd(rr, cc);
          if (cell) cell.classList.add("sheet-fill-preview");
        }
    }
  });
  const endFill = (e) => {
    if (!fillState) return;
    try { fillHandle.releasePointerCapture(e.pointerId); } catch(_){}
    const t = fillState.target, src = fillState.src;
    fillState = null;
    clearFillPreview();
    if (t && t.axis) applyFill(src, t);
    positionFillHandle();
  };
  fillHandle.addEventListener("pointerup", endFill);
  fillHandle.addEventListener("pointercancel", endFill);

  const renderReadonly = (name) => {
    formulaBar.hidden = true;
    clearVirtualEditor();
    if (exModels[name]){                          // 편집한 적 있으면 모델 값으로(편집 반영). 서식 표시는 유지, 색/병합은 보기에선 단순화.
      maybeRecalc(name);
      if (virtualCsvEditor){ renderVirtualModel(name, false); return; }
      sheet.replaceChildren(tableFromModel(exModels[name], false));
    } else {
      sheet.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false });
    }
    sheet.scrollTop = 0;
    enhanceSpreadsheetSelection(sheet, name);
  };

  const renderEditable = (name) => {
    const model = exModels[name];
    if (!model){ sheet.textContent = "편집 데이터를 불러오는 중…"; return; }
    maybeRecalc(name);
    clearVirtualEditor();
    if (virtualCsvEditor){
      sheet.scrollTop = 0;
      renderVirtualModel(name, true);
      return;
    }
    const table = tableFromModel(model, true);
    sheet.replaceChildren(table); sheet.scrollTop = 0;
    enhanceSpreadsheetSelection(sheet, name, { editable: true, onSelectionChange: onCellSelect });
    bindEditableTable(table, name);
    updateFormulaBar();
  };

  // 셀에 입력값(리터럴 또는 =수식)을 반영 — 셀 편집·수식 입력줄 공용. 변경되면 true.
  const applyCellInput = (name, r, c, text) => {
    const model = exModels[name]; if (!model || !model[r] || !model[r][c]) return false;
    let s = model[r][c];
    const isFormula = text[0] === "=" && text.length > 1;
    const newF = isFormula ? text.slice(1).trim() : null;
    const val = isFormula ? s.v : coerce(text);                 // 수식이면 값은 재계산이 채움
    const changed = isFormula ? (newF !== s.f) : (val !== s.v || s.f != null);
    if (!changed) return false;
    pushUndo(name);
    if (csvFastAoa){
      model[r] = model[r].slice();
      s = { ...s, v:val, xv:isFormula ? s.xv : (val === "" ? null : val), f:newF, style:cloneSpreadsheetValue(s.style || {}) };
      model[r][c] = s;
    } else {
      s.f = newF;
      if (!isFormula){ s.v = val; s.xv = val === "" ? null : val; }
    }
    if (isFormula){ sheetsWithFormula.add(name); structChanged.add(name); anyDirty = true; }   // 수식 셀은 전체 재작성 경로로 저장
    else if (!structChanged.has(name)) markEdit(name, r, c, val);
    recalcAndRefresh();
    const td2 = modelCellTd(r, c);
    if (td2){ td2.textContent = dispCell(model[r][c]); td2.classList.toggle("num", typeof model[r][c].v === "number"); }
    return true;
  };

  const startCellEdit = (td, name) => {
    const model = exModels[name]; if (!model) return;
    const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
    let s = model[r][c];
    td.contentEditable = "true"; td.classList.add("editing");
    td.textContent = (s.f != null && s.f !== "") ? ("=" + s.f) : rawText(s);   // 수식 셀은 '=수식'을 보여줌
    td.focus();
    const range = document.createRange(); range.selectNodeContents(td);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const finish = (commit) => {
      td.removeEventListener("blur", onBlur); td.removeEventListener("keydown", onKey);
      td.contentEditable = "false"; td.classList.remove("editing");
      if (commit) applyCellInput(name, r, c, td.textContent);
      s = model[r][c];
      td.textContent = dispCell(s);
      td.classList.toggle("num", typeof s.v === "number");
      updateFormulaBar();
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
      if (e.key === "Enter"){ e.preventDefault(); td.blur(); }
      else if (e.key === "Escape"){ e.preventDefault(); finish(false); }
      e.stopPropagation();
    };
    td.addEventListener("blur", onBlur);
    td.addEventListener("keydown", onKey);
  };

  // ----- 선택 범위의 좌상단(붙여넣기·병합 기준점) -----
  const selectionTopLeft = () => {
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return { r:0, c:0 };
    return {
      r: Math.min(...marked.map(td => Number(td.dataset.mrow))),
      c: Math.min(...marked.map(td => Number(td.dataset.mcol)))
    };
  };
  const selectionBounds = () => {
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    const rows = marked.map(td => Number(td.dataset.mrow)), cols = marked.map(td => Number(td.dataset.mcol));
    return { s:{ r:Math.min(...rows), c:Math.min(...cols) }, e:{ r:Math.max(...rows), c:Math.max(...cols) } };
  };

  // ----- 클립보드 표 붙여넣기(선택 좌상단부터 채우고, 부족하면 행·열 확장) -----
  const pasteGridIntoSelection = (grid) => {
    const model = exModels[currentSheet];
    if (!model || !grid.length) return;
    const { r:r0, c:c0 } = selectionTopLeft();
    const gridCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    const needRows = r0 + grid.length, needCols = c0 + gridCols;
    pushUndo(currentSheet);
    const curCols = model[0] ? model[0].length : 0;
    let grew = false;
    while (model.length < needRows){ model.push(Array.from({ length: Math.max(curCols, needCols) }, blankCell)); grew = true; }
    if (needCols > curCols){ model.forEach((row, i) => { while (row.length < needCols) row.push(blankCell()); }); grew = true; }
    const copiedRows = new Set();
    for (let i = 0; i < grid.length; i++){
      for (let j = 0; j < grid[i].length; j++){
        const r = r0 + i, c = c0 + j;
        const val = coerce(grid[i][j]);
        if (csvFastAoa){
          if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
          const prev = model[r][c];
          model[r][c] = { ...prev, v:val, xv:val === "" ? null : val, f:null, style:cloneSpreadsheetValue(prev.style || {}) };
        } else {
          const s = model[r][c]; s.v = val; s.xv = val === "" ? null : val; s.f = null;   // 붙여넣기는 리터럴로 덮음
          if (!grew && !structChanged.has(currentSheet)) markEdit(currentSheet, r, c, val);
        }
      }
    }
    if (grew || sheetsWithFormula.has(currentSheet)) structChanged.add(currentSheet);   // 수식 있으면 결과 갱신 위해 전체 재작성
    anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);      // renderEditable 이 재계산까지 수행
    toast(grid.length + "×" + gridCols + " 붙여넣었어요.", 1800);
  };

  // ----- 셀 병합 / 병합 해제 -----
  const mergeSelection = () => {
    const b = selectionBounds();
    if (!b || (b.s.r === b.e.r && b.s.c === b.e.c)){ toast("두 칸 이상 선택해 병합하세요.", 2000); return; }
    pushUndo(currentSheet);
    const model = exModels[currentSheet];
    exMerges[currentSheet] = (exMerges[currentSheet] || [])
      .filter(m => !spreadsheetRangesOverlap(decodeSpreadsheetMerge(m), b));      // 겹치는 기존 병합 흡수
    exMerges[currentSheet].push(encodeSpreadsheetCell(b.s.r, b.s.c) + ":" + encodeSpreadsheetCell(b.e.r, b.e.c));
    for (let r = b.s.r; r <= b.e.r; r++)                                          // 좌상단 외 값 비움(엑셀 동작)
      for (let c = b.s.c; c <= b.e.c; c++){
        if (r === b.s.r && c === b.s.c) continue;
        const s = model[r] && model[r][c]; if (s){ s.v = ""; s.xv = null; }
      }
    structChanged.add(currentSheet); anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);
    toast("선택 범위를 병합했어요.", 1500);
  };
  const unmergeSelection = () => {
    const b = selectionBounds();
    if (!b){ toast("병합 해제할 셀을 선택하세요.", 1800); return; }
    const before = (exMerges[currentSheet] || []).length;
    const kept = (exMerges[currentSheet] || []).filter(m => !spreadsheetRangesOverlap(decodeSpreadsheetMerge(m), b));
    if (kept.length === before){ toast("선택 안에 병합된 셀이 없어요.", 1800); return; }
    pushUndo(currentSheet);
    exMerges[currentSheet] = kept;
    structChanged.add(currentSheet); anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);
    toast("병합을 해제했어요.", 1400);
  };

  // 편집 모드에서 시트에 포커스가 있을 때 클립보드 붙여넣기(셀 편집 중이면 네이티브 붙여넣기)
  sheet.addEventListener("paste", (e) => {
    if (!editMode) return;
    const t = e.target;
    if (t && t.closest && t.closest('[contenteditable="true"]')) return;
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const grid = parseClipboardTable(text);
    if (grid.length) pasteGridIntoSelection(grid);
  });

  // ----- 편집 모델 → CSV(현재 시트) -----
  const csvCell = (s) => {
    let v = s.v;
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else if (v === null || v === undefined) v = "";
    else v = String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const modelToCsv = (model) => model.map(row => row.map(csvCell).join(",")).join("\r\n");

  // ----- 편집 반영해 ExcelJS 바이트 생성(저장용). 손 안 댄 셀의 서식·수식·병합 보존 -----
  const exportExBytes = async () => {
    // 캐시된 편집 기준 워크북을 직접 바꾸면 "저장 → 되돌리기 → 다시 저장"에서 이전 변경이 남는다.
    // 매 저장마다 원본 바이트를 새 워크북에 로드한 뒤 현재 모델만 반영한다.
    if (typeof ExcelJS === "undefined") return null;
    // 화면에서 조절한 열 폭·행 높이(모델 인덱스 기준)와 머리글 고정을 워크시트에 반영한다.
    const applyViewSizes = (ws, name) => {
      const sizes = sheet.__sheetSizes && sheet.__sheetSizes[name];
      if (sizes){
        Object.keys(sizes.col || {}).forEach(c => {
          try { ws.getColumn(Number(c) + 1).width = pxToExcelColWidth(sizes.col[c]); } catch(_){}
        });
        Object.keys(sizes.rowModel || {}).forEach(r => {
          try { ws.getRow(Number(r) + 1).height = pxToExcelRowHeight(sizes.rowModel[r]); } catch(_){}
        });
      }
      if (editState.headerFrozen){                // '첫 행 머리글 고정' → 파일에도 틀 고정 반영(엑셀에서 그대로 열림)
        try { ws.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2", activeCell: "A2" }]; } catch(_){}
      }
    };
    const w = new ExcelJS.Workbook();
    if (csvFastAoa){
      for (const name of Object.keys(exModels)){
        const ws = w.addWorksheet(name);
        writeStructuredSpreadsheetModel(ws, exModels[name], exMerges[name] || []);
        applyViewSizes(ws, name);
      }
      return await w.xlsx.writeBuffer();
    }
    await w.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    for (const name of Object.keys(exModels)){
      const ws = w.getWorksheet(name); if (!ws) continue;
      const model = exModels[name];
      applyViewSizes(ws, name);
      if (structChanged.has(name)){
        // 구조가 바뀐 시트도 원본 값 객체(수식·리치텍스트·링크)와 현재 병합 범위를 함께 되쓴다.
        writeStructuredSpreadsheetModel(ws, model, exMerges[name] || []);
      } else {
        // 값만 편집된 시트: 바뀐 셀만 갱신 → 나머지 서식·수식·병합 그대로.
        editedCells[name].forEach((val, key) => {
          const [r, c] = key.split(",").map(Number);
          try { ws.getCell(r + 1, c + 1).value = (val === "" ? null : val); } catch(_){}
        });
        // 서식만 바뀐 셀: 값은 건드리지 않고 전체 스타일(글꼴·정렬·표시형식·채우기·테두리) 반영(수식·병합 보존)
        const sm = styledCells[name];
        if (sm && sm.size){
          const model = exModels[name];
          sm.forEach((_, key) => {
            const [r, c] = key.split(",").map(Number);
            const st = model[r] && model[r][c] && model[r][c].style;
            try { ws.getCell(r + 1, c + 1).style = cloneSpreadsheetValue(st || {}); } catch(_){}
          });
        }
      }
    }
    return await w.xlsx.writeBuffer();
  };

  let editToolMenus = [];
  let editContextActions = [];
  let editContextColumn = -1;
  let editContextMenu = null;
  let editContextOutside = null;
  let editContextKeydown = null;
  const closeEditToolMenus = (except=null) => {
    editToolMenus.forEach(menu => { if (menu !== except) menu.open = false; });
  };
  // <details> 는 바깥 클릭으로 닫히지 않으므로, 메뉴가 열린 동안만 문서 레벨 리스너로 닫아 준다.
  let editToolOutside = null;
  let editToolEscape = null;
  const detachEditToolClosers = () => {
    if (editToolOutside){ document.removeEventListener("pointerdown", editToolOutside, true); editToolOutside = null; }
    if (editToolEscape){ document.removeEventListener("keydown", editToolEscape, true); editToolEscape = null; }
  };
  const attachEditToolClosers = () => {
    if (editToolOutside) return;
    editToolOutside = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".xlsx-tool-menu")) closeEditToolMenus();
    };
    editToolEscape = (event) => {
      if (event.key === "Escape"){ closeEditToolMenus(); event.stopPropagation(); }
    };
    document.addEventListener("pointerdown", editToolOutside, true);
    document.addEventListener("keydown", editToolEscape, true);
  };
  const closeEditContextMenu = () => {
    if (editContextMenu){ editContextMenu.remove(); editContextMenu = null; }
    if (editContextOutside){ document.removeEventListener("pointerdown", editContextOutside, true); editContextOutside = null; }
    if (editContextKeydown){ document.removeEventListener("keydown", editContextKeydown, true); editContextKeydown = null; }
  };
  const openEditContextMenu = (x, y) => {
    closeEditContextMenu();
    const menu = document.createElement("div");
    menu.className = "xlsx-context-menu";
    menu.setAttribute("role", "menu");
    editContextActions.forEach(item => {
      if (item.separator){
        const sep = document.createElement("div"); sep.className = "xlsx-context-sep"; menu.appendChild(sep); return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.disabled = typeof item.disabled === "function" ? !!item.disabled() : !!item.disabled;
      button.addEventListener("click", () => {
        closeEditContextMenu();
        if (!button.disabled && typeof item.action === "function") item.action();
      });
      menu.appendChild(button);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, x)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, y)) + "px";
    editContextMenu = menu;
    editContextOutside = (event) => { if (!menu.contains(event.target)) closeEditContextMenu(); };
    editContextKeydown = (event) => { if (event.key === "Escape") closeEditContextMenu(); };
    setTimeout(() => {
      if (!editContextMenu) return;
      document.addEventListener("pointerdown", editContextOutside, true);
      document.addEventListener("keydown", editContextKeydown, true);
    }, 0);
  };
  sheet.addEventListener("contextmenu", (event) => {
    if (!editMode) return;
    const target = event.target && event.target.closest
      ? event.target.closest("td[data-mrow],.sheet-row-head,.sheet-col-head")
      : null;
    if (!target || !sheet.contains(target)) return;
    event.preventDefault();
    closeEditToolMenus();
    if (!target.classList.contains("sheet-selected") && typeof sheet._selectSpreadsheetElement === "function"){
      sheet._selectSpreadsheetElement(target);
    }
    editContextColumn = Number(target.dataset.mcol != null ? target.dataset.mcol : target.dataset.col);
    if (!Number.isInteger(editContextColumn)) editContextColumn = -1;
    openEditContextMenu(event.clientX, event.clientY);
  });
  sheet.addEventListener("pointerdown", () => {
    closeEditToolMenus();
    closeEditContextMenu();
  });

  // ===== 편집 도구막대: 자주 쓰는 기능은 2줄에 유지하고, 세부 기능은 드롭다운·우클릭으로 제공 =====
  const buildEditBar = () => {
    editBar.innerHTML = "";
    editToolMenus = [];
    closeEditContextMenu();
    const model = exModels[currentSheet] || [[blankCell()]];
    const cols = model.length ? model[0].length : 1;

    const filterInput = document.createElement("input");
    filterInput.type = "search"; filterInput.className = "xlsx-filter"; filterInput.placeholder = "행 필터(포함 텍스트)";
    filterInput.value = editState.filter;
    filterInput.addEventListener("input", () => { editState.filter = filterInput.value; renderEditable(currentSheet); });

    const sortSel = document.createElement("select"); sortSel.className = "xlsx-sortcol";
    for (let c = 0; c < cols; c++){ const o = document.createElement("option"); o.value = String(c); o.textContent = spreadsheetColumnName(c) + "열"; sortSel.appendChild(o); }
    if (editState.sortCol >= 0 && editState.sortCol < cols) sortSel.value = String(editState.sortCol);
    const doSort = (dir) => {
      if ((exMerges[currentSheet] || []).length){
        toast("병합 셀이 있는 시트는 병합을 유지하기 위해 정렬하지 않았어요.", 2600);
        return;
      }
      pushUndo(currentSheet);
      const col = Number(sortSel.value); editState.sortCol = col; editState.sortDir = dir;
      const head = editState.headerFrozen ? 1 : 0;
      const cmp = (a, b) => {                      // a,b = 셀 스냅샷
        const an = typeof a.v === "number", bn = typeof b.v === "number";
        if (an && bn) return a.v - b.v;
        if (an) return -1; if (bn) return 1;
        return dispCell(a).localeCompare(dispCell(b), undefined, { numeric: true });
      };
      // 원래 모델 행 index 를 함께 들고 정렬 → 정렬 후 old→new 매핑으로 수식 상대참조를 따라가게 한다.
      const tagged = model.slice(head).map((row, i) => ({ row, old: head + i }));
      tagged.sort((a, b) => cmp(a.row[col], b.row[col]) * dir);
      const oldToNew = new Map();
      tagged.forEach((t, i) => oldToNew.set(t.old, head + i));
      model.splice(head, model.length - head, ...tagged.map(t => t.row));
      const lastRow = model.length - 1;
      remapModelFormulas(currentSheet, (c, r, abs) =>
        (!abs.rowAbs && r >= head && r <= lastRow && oldToNew.has(r)) ? { c, r: oldToNew.get(r) } : { c, r });
      structChanged.add(currentSheet); anyDirty = true;
      renderEditable(currentSheet);
    };
    const ascBtn = document.createElement("button"); ascBtn.type = "button"; ascBtn.textContent = "▲ 오름"; ascBtn.title = "선택 열 오름차순 정렬"; ascBtn.onclick = () => doSort(1);
    const descBtn = document.createElement("button"); descBtn.type = "button"; descBtn.textContent = "▼ 내림"; descBtn.title = "선택 열 내림차순 정렬"; descBtn.onclick = () => doSort(-1);

    const addRowBtn = document.createElement("button"); addRowBtn.type = "button"; addRowBtn.textContent = "+ 행"; addRowBtn.title = "선택 행 위에 빈 행 추가(선택이 없으면 맨 아래)";
    addRowBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mrow]');
      const selectedRows = [...marked].map(td => Number(td.dataset.mrow)).filter(Number.isInteger);
      const at = selectedRows.length ? Math.min(...selectedRows) : model.length;
      pushUndo(currentSheet);
      model.splice(at, 0, Array.from({ length:model[0] ? model[0].length : 1 }, blankCell));
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterRowInsert(exMerges[currentSheet], at);
      remapModelFormulas(currentSheet, (c, r) => ({ c, r: r >= at ? r + 1 : r }));   // 삽입 지점 이하 참조 +1
      structChanged.add(currentSheet); anyDirty = true;
      renderEditable(currentSheet);
      toast(selectedRows.length ? "선택 행 위에 빈 행을 추가했어요." : "맨 아래에 빈 행을 추가했어요.", 1600);
    };
    const addColBtn = document.createElement("button"); addColBtn.type = "button"; addColBtn.textContent = "+ 열"; addColBtn.title = "선택 열 왼쪽에 빈 열 추가(선택이 없으면 맨 오른쪽)";
    addColBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mcol]');
      const selectedCols = [...marked].map(td => Number(td.dataset.mcol)).filter(Number.isInteger);
      const at = selectedCols.length ? Math.min(...selectedCols) : (model[0] ? model[0].length : 0);
      pushUndo(currentSheet);
      model.forEach((row, index) => { model[index] = [...row.slice(0, at), blankCell(), ...row.slice(at)]; });
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterColumnInsert(exMerges[currentSheet], at);
      remapModelFormulas(currentSheet, (c, r) => ({ c: c >= at ? c + 1 : c, r }));   // 삽입 지점 이후 열참조 +1
      structChanged.add(currentSheet); anyDirty = true;
      buildEditBar(); renderEditable(currentSheet);
      toast(selectedCols.length ? "선택 열 왼쪽에 빈 열을 추가했어요." : "맨 오른쪽에 빈 열을 추가했어요.", 1600);
    };
    const delRowBtn = document.createElement("button"); delRowBtn.type = "button"; delRowBtn.textContent = "− 선택행"; delRowBtn.title = "현재 선택한 행 삭제";
    delRowBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mrow]');
      const rows = [...new Set([...marked].map(td => Number(td.dataset.mrow)))].sort((a, b) => b - a);
      if (!rows.length){ toast("삭제할 행을 먼저 선택하세요(행 머리글 클릭).", 2200); return; }
      pushUndo(currentSheet);
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterRowDelete(exMerges[currentSheet], rows);
      const delRowSet = new Set(rows);
      remapModelFormulas(currentSheet, (c, r) => delRowSet.has(r) ? null : { c, r: r - rows.filter(d => d < r).length });
      rows.forEach(r => model.splice(r, 1));
      if (!model.length) model.push(Array.from({ length: cols }, blankCell));
      structChanged.add(currentSheet); anyDirty = true;
      renderEditable(currentSheet);
      toast(rows.length + "개 행을 삭제했어요.", 1600);
    };
    const delColBtn = document.createElement("button"); delColBtn.type = "button"; delColBtn.textContent = "− 선택열"; delColBtn.title = "현재 선택한 열 삭제";
    delColBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mcol]');
      const colsSel = [...new Set([...marked].map(td => Number(td.dataset.mcol)))].sort((a, b) => b - a);
      if (!colsSel.length){ toast("삭제할 열을 먼저 선택하세요(열 머리글 클릭).", 2200); return; }
      pushUndo(currentSheet);
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterColumnDelete(exMerges[currentSheet], colsSel);
      const delColSet = new Set(colsSel);
      remapModelFormulas(currentSheet, (c, r) => delColSet.has(c) ? null : { c: c - colsSel.filter(d => d < c).length, r });
      model.forEach(row => colsSel.forEach(c => row.splice(c, 1)));   // 내림차순 → 큰 인덱스부터 안전 삭제
      if (model[0] && !model[0].length) model.forEach(row => row.push(blankCell()));
      structChanged.add(currentSheet); anyDirty = true;
      buildEditBar(); renderEditable(currentSheet);
      toast(colsSel.length + "개 열을 삭제했어요.", 1600);
    };
    const mergeBtn = document.createElement("button"); mergeBtn.type = "button"; mergeBtn.textContent = "⊞ 병합"; mergeBtn.title = "선택 범위를 하나로 병합(좌상단 값만 유지)";
    mergeBtn.onclick = () => mergeSelection();
    const unmergeBtn = document.createElement("button"); unmergeBtn.type = "button"; unmergeBtn.textContent = "⊟ 병합해제"; unmergeBtn.title = "선택 범위의 병합을 해제";
    unmergeBtn.onclick = () => unmergeSelection();

    const frozen = document.createElement("label"); frozen.className = "xlsx-frozen";
    const fchk = document.createElement("input"); fchk.type = "checkbox"; fchk.checked = editState.headerFrozen;
    fchk.addEventListener("change", () => { editState.headerFrozen = fchk.checked; renderEditable(currentSheet); });
    frozen.append(fchk, document.createTextNode(" 첫 행 머리글 고정"));

    // 되돌리기 / 다시실행
    undoBtn = document.createElement("button"); undoBtn.type = "button"; undoBtn.textContent = "↶"; undoBtn.title = "되돌리기 (Ctrl+Z)";
    undoBtn.onclick = () => doUndo();
    redoBtn = document.createElement("button"); redoBtn.type = "button"; redoBtn.textContent = "↷"; redoBtn.title = "다시실행 (Ctrl+Y)";
    redoBtn.onclick = () => doRedo();

    // ----- 글꼴: 굵게·기울임·밑줄 · 글자색 · 크기 · 글꼴 -----
    const mkFmtBtn = (text, title, onClick, extraClass) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.title = title;
      if (extraClass) b.className = extraClass;
      b.onclick = onClick; return b;
    };
    const boldBtn = mkFmtBtn("B", "굵게 (선택 셀)", () => toggleFontProp("bold", "굵게"), "xlsx-fmt-btn xlsx-fmt-bold");
    const italicBtn = mkFmtBtn("I", "기울임 (선택 셀)", () => toggleFontProp("italic", "기울임"), "xlsx-fmt-btn xlsx-fmt-italic");
    const underlineBtn = mkFmtBtn("U", "밑줄 (선택 셀)", () => toggleFontProp("underline", "밑줄"), "xlsx-fmt-btn xlsx-fmt-underline");
    const fontColorWrap = document.createElement("label"); fontColorWrap.className = "xlsx-frozen"; fontColorWrap.title = "선택 셀 글자 색";
    const fontColor = document.createElement("input"); fontColor.type = "color"; fontColor.className = "xlsx-fmt-color"; fontColor.value = "#1f2937";
    fontColor.addEventListener("change", () => setFontColor(fontColor.value));
    fontColorWrap.append(document.createTextNode("글자색 "), fontColor);
    const sizeSel = document.createElement("select"); sizeSel.className = "xlsx-sortcol"; sizeSel.title = "글자 크기";
    [["", "크기"], ...[8,9,10,11,12,14,16,18,20,24,28,36].map(v => [String(v), String(v)])]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; sizeSel.appendChild(o); });
    sizeSel.addEventListener("change", () => { if (sizeSel.value) setFontSize(sizeSel.value); sizeSel.value = ""; });
    const fontSel = document.createElement("select"); fontSel.className = "xlsx-sortcol"; fontSel.title = "글꼴";
    [["", "글꼴"], ["맑은 고딕","맑은 고딕"], ["굴림","굴림"], ["돋움","돋움"], ["바탕","바탕"], ["궁서","궁서"],
     ["Arial","Arial"], ["Calibri","Calibri"], ["Times New Roman","Times New Roman"], ["Courier New","Courier New"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; fontSel.appendChild(o); });
    fontSel.addEventListener("change", () => { if (fontSel.value) setFontName(fontSel.value); fontSel.value = ""; });

    // ----- 정렬: 가로 · 세로 · 자동 줄바꿈 -----
    const alignLeftBtn = mkFmtBtn("⌫", "왼쪽 맞춤", () => setAlign("left"), "xlsx-fmt-btn");
    alignLeftBtn.textContent = "◧"; alignLeftBtn.title = "왼쪽 맞춤";
    const alignCenterBtn = mkFmtBtn("▥", "가운데 맞춤", () => setAlign("center"), "xlsx-fmt-btn");
    const alignRightBtn = mkFmtBtn("◨", "오른쪽 맞춤", () => setAlign("right"), "xlsx-fmt-btn");
    const vAlignSel = document.createElement("select"); vAlignSel.className = "xlsx-sortcol"; vAlignSel.title = "세로 맞춤";
    [["", "세로맞춤"], ["top","위"], ["middle","가운데"], ["bottom","아래"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; vAlignSel.appendChild(o); });
    vAlignSel.addEventListener("change", () => { setVAlign(vAlignSel.value); });
    const wrapBtn = mkFmtBtn("↵ 줄바꿈", "자동 줄바꿈 켜기/끄기", () => toggleWrap(), "xlsx-fmt-btn");

    // ----- 표시형식(번호서식) -----
    const numSel = document.createElement("select"); numSel.className = "xlsx-sortcol"; numSel.title = "표시형식(숫자·통화·백분율·날짜)";
    [["", "표시형식"], ["__general","일반"], ["#,##0","1,234 (천단위)"], ["#,##0.00","1,234.00 (소수2)"],
     ["₩#,##0","₩ 통화"], ["$#,##0.00","$ 통화"], ["0%","백분율 0%"], ["0.00%","백분율 0.00%"],
     ["0.00","소수 2자리"], ["yyyy-mm-dd","날짜 2026-07-05"], ["yyyy-mm-dd hh:mm","날짜+시각"], ["@","텍스트"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; numSel.appendChild(o); });
    numSel.addEventListener("change", () => {
      if (!numSel.value) return;
      setNumberFormat(numSel.value === "__general" ? "" : numSel.value);
      numSel.value = "";
    });

    // ----- 채우기 · 테두리 -----
    const fillWrap = document.createElement("label"); fillWrap.className = "xlsx-frozen"; fillWrap.title = "선택 셀 채우기 색";
    const fillColor = document.createElement("input"); fillColor.type = "color"; fillColor.className = "xlsx-fmt-color"; fillColor.value = "#fde68a";
    fillWrap.append(document.createTextNode("채우기 "), fillColor);
    const fillBtn = document.createElement("button"); fillBtn.type = "button"; fillBtn.textContent = "채우기 적용"; fillBtn.title = "선택 셀에 채우기 색 적용";
    fillBtn.onclick = () => setSelectionFill(fillColor.value);

    const borderWrap = document.createElement("label"); borderWrap.className = "xlsx-frozen"; borderWrap.title = "선택 셀 테두리 색";
    const borderColor = document.createElement("input"); borderColor.type = "color"; borderColor.className = "xlsx-fmt-color"; borderColor.value = "#475569";
    borderWrap.append(document.createTextNode("테두리 "), borderColor);
    const borderStyleSel = document.createElement("select"); borderStyleSel.className = "xlsx-sortcol"; borderStyleSel.title = "테두리 굵기·모양";
    [["thin","얇게"], ["medium","중간"], ["thick","굵게"], ["dashed","점선"], ["double","이중선"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; borderStyleSel.appendChild(o); });
    const borderWhereSel = document.createElement("select"); borderWhereSel.className = "xlsx-sortcol"; borderWhereSel.title = "테두리 위치";
    [["all","전체"], ["outline","바깥쪽"], ["inside","내부"], ["inside-h","안쪽 가로"], ["inside-v","안쪽 세로"], ["bottom","아래"], ["top","위"], ["left","왼쪽"], ["right","오른쪽"], ["none","지우기"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; borderWhereSel.appendChild(o); });
    const borderBtn = document.createElement("button"); borderBtn.type = "button"; borderBtn.textContent = "테두리 적용"; borderBtn.title = "선택 셀에 테두리 적용";
    borderBtn.onclick = () => setSelectionBorder(borderColor.value, borderStyleSel.value, borderWhereSel.value);
    const clearFmtBtn = document.createElement("button"); clearFmtBtn.type = "button"; clearFmtBtn.textContent = "서식 지우기"; clearFmtBtn.title = "선택 셀의 글꼴·정렬·표시형식·채우기·테두리 모두 제거";
    clearFmtBtn.onclick = () => clearSelectionFormat();

    // ----- 서식 복사 붓 -----
    const copyFmtBtn = document.createElement("button"); copyFmtBtn.type = "button"; copyFmtBtn.textContent = "🖌 서식 복사"; copyFmtBtn.title = "선택 셀의 서식을 복사";
    copyFmtBtn.onclick = () => copyCellFormat();
    const pasteFmtBtn = document.createElement("button"); pasteFmtBtn.type = "button"; pasteFmtBtn.textContent = "서식 붙이기"; pasteFmtBtn.title = "복사한 서식을 선택 셀에 적용";
    pasteFmtBtn.onclick = () => pasteCellFormat();

    // ----- 찾기·바꿈 -----
    const findInput = document.createElement("input"); findInput.type = "search"; findInput.className = "xlsx-sortcol xlsx-find-input"; findInput.placeholder = "찾을 내용";
    const replInput = document.createElement("input"); replInput.type = "search"; replInput.className = "xlsx-sortcol xlsx-find-input"; replInput.placeholder = "바꿀 내용";
    const replaceBtn = document.createElement("button"); replaceBtn.type = "button"; replaceBtn.textContent = "모두 바꾸기"; replaceBtn.title = "현재 시트(선택이 있으면 선택 범위)에서 모두 바꾸기 · 대소문자 무시";
    replaceBtn.onclick = () => replaceAllInSheet(findInput.value, replInput.value);
    replInput.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); replaceAllInSheet(findInput.value, replInput.value); } e.stopPropagation(); });
    findInput.addEventListener("keydown", (e) => e.stopPropagation());

    // ----- 조건부 강조 -----
    const condSel = document.createElement("select"); condSel.className = "xlsx-sortcol"; condSel.title = "조건";
    [["ge","≥ 이상"], ["gt","> 초과"], ["le","≤ 이하"], ["lt","< 미만"], ["eq","= 같음"], ["ne","≠ 다름"], ["contains","포함(텍스트)"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; condSel.appendChild(o); });
    const condVal = document.createElement("input"); condVal.type = "text"; condVal.className = "xlsx-sortcol xlsx-cond-val"; condVal.placeholder = "값"; condVal.title = "기준 값(예: 60)";
    const condColor = document.createElement("input"); condColor.type = "color"; condColor.className = "xlsx-fmt-color"; condColor.value = "#fecaca";
    const condBtn = document.createElement("button"); condBtn.type = "button"; condBtn.textContent = "강조"; condBtn.title = "선택 범위에서 조건에 맞는 셀만 채우기 색 적용";
    condBtn.onclick = () => highlightByCondition(condSel.value, condVal.value, condColor.value);
    condVal.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); highlightByCondition(condSel.value, condVal.value, condColor.value); } e.stopPropagation(); });

    const xlsxBtn = document.createElement("button"); xlsxBtn.type = "button"; xlsxBtn.textContent = "XLSX 저장"; xlsxBtn.title = "서식(번호서식·색·글꼴·병합)을 유지해 XLSX 다운로드";
    xlsxBtn.onclick = async () => {
      xlsxBtn.disabled = true;
      try {
        const out = await exportExBytes();
        if (!out){ toast("저장 준비에 실패했어요.", 2400, { type: "error" }); return; }
        downloadSpreadsheetFile(out, base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        toast("서식을 유지해 XLSX로 저장했어요.", 2000, { type: "success" });
      } catch(e){ console.error(e); toast("저장하지 못했어요.", 2400, { type: "error" }); }
      finally { xlsxBtn.disabled = false; }
    };
    const csvBtn2 = document.createElement("button"); csvBtn2.type = "button"; csvBtn2.textContent = "CSV 저장"; csvBtn2.title = "현재 시트를 CSV로 저장(서식 없음)";
    csvBtn2.onclick = () => {
      const csv = "﻿" + modelToCsv(exModels[currentSheet] || []);
      downloadSpreadsheetFile(csv, base + "_" + sanitizeFilePart(currentSheet) + ".csv", "text/csv;charset=utf-8");
      toast("현재 시트를 CSV로 저장했어요.", 1800, { type: "success" });
    };

    const makeGroup = (name, className, ...nodes) => {
      const group = document.createElement("div");
      group.className = "xlsx-editgroup " + className;
      if (name){
        const label = document.createElement("span"); label.className = "xlsx-editgroup-label"; label.textContent = name;
        group.append(label);
      }
      group.append(...nodes);
      return group;
    };
    const makeMenu = (label, className, ...nodes) => {
      const details = document.createElement("details");
      details.className = "xlsx-tool-menu " + className;
      const summary = document.createElement("summary");
      summary.textContent = label;
      summary.title = label + " 메뉴";
      const panel = document.createElement("div");
      panel.className = "xlsx-tool-menu-panel";
      panel.append(...nodes);
      details.append(summary, panel);
      details.addEventListener("toggle", () => {
        if (details.open){ closeEditToolMenus(details); attachEditToolClosers(); }
        else if (!editToolMenus.some(menu => menu.open)) detachEditToolClosers();
      });
      panel.addEventListener("click", (event) => {
        if (event.target.closest("button") && !event.target.closest("button").disabled) details.open = false;
      });
      editToolMenus.push(details);
      return { details, panel, summary };
    };
    const historyGroup = makeGroup("", "xlsx-editgroup-history", undoBtn, redoBtn);
    const dataGroup = makeGroup("", "xlsx-editgroup-data", filterInput, sortSel, ascBtn, descBtn);
    const structureMenu = makeMenu("행·열", "xlsx-tool-menu-structure", addRowBtn, addColBtn, delRowBtn, delColBtn, mergeBtn, unmergeBtn);
    const fontGroup = makeGroup("", "xlsx-editgroup-font", fontSel, sizeSel, boldBtn, italicBtn, underlineBtn, fontColorWrap);
    const alignGroup = makeGroup("", "xlsx-editgroup-align", alignLeftBtn, alignCenterBtn, alignRightBtn, vAlignSel, wrapBtn, numSel);
    const formatMenu = makeMenu("채우기·테두리", "xlsx-tool-menu-format", fillWrap, fillBtn, borderWrap, borderStyleSel, borderWhereSel, borderBtn, clearFmtBtn, copyFmtBtn, pasteFmtBtn);
    const findMenu = makeMenu("찾기·바꿈", "xlsx-tool-menu-find", findInput, replInput, replaceBtn);
    const condMenu = makeMenu("조건부 강조", "xlsx-tool-menu-cond", condSel, condVal, condColor, condBtn);
    const chartBtn = document.createElement("button"); chartBtn.type = "button"; chartBtn.textContent = "📊 차트"; chartBtn.title = "선택 범위(라벨 열 + 값 열)로 막대·선·원 차트 만들기";
    chartBtn.onclick = () => insertChart();
    const selImgBtn = document.createElement("button"); selImgBtn.type = "button"; selImgBtn.textContent = "📷 선택→메모"; selImgBtn.title = "선택한 셀 범위를 이미지로 만들어 메모에 저장";
    selImgBtn.onclick = () => saveSelectionToMemo();
    const formulaHint = document.createElement("span"); formulaHint.className = "xlsx-formula-hint";
    formulaHint.textContent = "🧮 =SUM(A1:A3), =Sheet2!A1 · 위 입력줄에서도 편집 · 핸들 드래그로 수식 채우기";
    formulaHint.title = "함수: SUM·AVERAGE·IF·COUNTIF·SUMIF·VLOOKUP·HLOOKUP·INDEX·MATCH·DATE·YEAR·TEXT·SUBSTITUTE 등 · 시트 간 참조·자동 재계산·참조 자동 조정 · 선택 후 '차트'로 시각화";
    const moreMenu = makeMenu("더보기", "xlsx-tool-menu-more", chartBtn, selImgBtn, formulaHint);
    const saveMenu = makeMenu("저장", "xlsx-tool-menu-save xlsx-editgroup-save", xlsxBtn, csvBtn2);
    const mainRow = document.createElement("div"); mainRow.className = "xlsx-editbar-row xlsx-editbar-main";
    mainRow.append(historyGroup, dataGroup, structureMenu.details, frozen, findMenu.details, moreMenu.details, saveMenu.details);
    const fmtRow = document.createElement("div"); fmtRow.className = "xlsx-editbar-row xlsx-editbar-fmt";
    fmtRow.append(fontGroup, alignGroup, formatMenu.details, condMenu.details);
    editBar.append(mainRow, fmtRow);
    editContextActions = [
      { label:"선택 셀 내용 지우기", action:() => clearSelectionContents() },
      { separator:true },
      { label:"선택 행 위에 삽입", action:() => addRowBtn.click() },
      { label:"선택 행 삭제", action:() => delRowBtn.click() },
      { label:"선택 열 왼쪽에 삽입", action:() => addColBtn.click() },
      { label:"선택 열 삭제", action:() => delColBtn.click() },
      { separator:true },
      { label:"오름차순 정렬", action:() => { if (editContextColumn >= 0) sortSel.value = String(editContextColumn); doSort(1); } },
      { label:"내림차순 정렬", action:() => { if (editContextColumn >= 0) sortSel.value = String(editContextColumn); doSort(-1); } },
      { label:"셀 병합", action:() => mergeSelection() },
      { label:"병합 해제", action:() => unmergeSelection() },
      { separator:true },
      { label:"서식 복사", action:() => copyCellFormat() },
      { label:"서식 붙이기", action:() => pasteCellFormat() },
      { label:"서식 지우기", action:() => clearSelectionFormat() },
      { separator:true },
      { label:"선택 범위로 차트 만들기", action:() => insertChart() },
      { label:"선택 범위를 이미지 메모로 저장", action:() => saveSelectionToMemo() }
    ];
    updateUndoButtons();

    // 제자리 저장(exe 로컬 서버가 있을 때만): 서식 보존 XLSX 바이트를 원래 경로에 덮어쓴다.
    saveFileBackendAvailable().then((ok) => {
      if (!ok || !editMode || editBar.querySelector(".xlsx-save-inplace")) return;
      const saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = "xlsx-save-inplace"; saveBtn.textContent = "제자리 저장";
      saveBtn.title = "편집 내용을 원본 파일에 저장(서식 유지)";
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const out = await exportExBytes();
          if (!out){ toast("저장 준비 실패(다운로드를 이용하세요).", 2600); return; }
          const rel = String((doc && (doc.relPath || doc.workspacePath || doc.name)) || file.name)
            .replace(/\\/g, "/").replace(/^\/+/, "");
          const res = await fetch("/save-file", {
            method: "POST",
            headers: { "X-Save-Path": encodeURIComponent(rel) },
            body: new Blob([out], { type: "application/octet-stream" })
          });
          const savedPath = res.ok ? ((await res.text()).trim() || rel) : null;
          if (savedPath){ try { window.__mnLastSaveRel = rel; } catch(_){} }   // 헤더 '저장 폴더'가 직전 저장 파일 폴더를 열 수 있게 기록
          toast(savedPath ? ("저장했어요: " + savedPath) : "제자리 저장 실패(다운로드를 이용하세요).", savedPath ? 2600 : 2800);
        } catch(e){ console.error(e); toast("저장하지 못했어요(다운로드를 이용하세요).", 2600); }
        finally { saveBtn.disabled = false; }
      };
      saveMenu.panel.append(saveBtn);
    });
  };

  const rerender = async () => {
    expBtns.hidden = editMode;   // 읽기 전용에서는 항상 표시 — 편집분·CSV 변환본은 exportSheetOf 가 모델 값으로 내보냄
    editBar.hidden = !editMode;
    if (editMode){
      sheet.textContent = "편집기를 준비하는 중…";
      const model = await exModelFor(currentSheet);
      if (!model){
        toast("서식 보존 편집 라이브러리(ExcelJS)를 불러오지 못했어요. 보기 모드로 전환합니다.", 3400);
        editMode = false; syncEditToggle(); expBtns.hidden = false; editBar.hidden = true;
        renderReadonly(currentSheet); return;
      }
      if (!editMode){ editBar.hidden = true; renderReadonly(currentSheet); return; }
      // 시트 간 참조(Sheet2!A1) 해석을 위해 다중 시트 워크북은 모든 모델을 미리 만든다(첫 편집 1회).
      if ((wb.SheetNames || []).length > 1){ await ensureAllModelsBuilt(); if (!editMode) return; }
      buildEditBar();
      renderEditable(currentSheet);
    } else {
      renderReadonly(currentSheet);
    }
  };

  const show = (name, btn) => {
    currentSheet = name;
    [...tabs.children].forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    rerender();
  };
  wb.SheetNames.forEach((name, i) => {
    const b = document.createElement("button");
    b.className = "xlsx-tab"; b.textContent = name;
    b.onclick = () => show(name, b);
    tabs.appendChild(b);
    if (i === 0) show(name, b);
  });
  if (wb.SheetNames.length === 1) tabs.style.display = "none";
}

if (typeof module === "object" && module.exports){
  module.exports = {
    adjustSpreadsheetMergesAfterColumnInsert,
    adjustSpreadsheetMergesAfterColumnDelete,
    adjustSpreadsheetMergesAfterRowDelete,
    adjustSpreadsheetMergesAfterRowInsert,
    spreadsheetRangesOverlap,
    parseClipboardTable,
    pxToExcelColWidth,
    pxToExcelRowHeight,
    parseFormula,
    evaluateFormula,
    isFormulaError,
    remapFormulaRefs,
    buildSpreadsheetChartSvg,
    cloneSpreadsheetValue,
    spreadsheetVirtualWindow,
    spreadsheetCellValueSnapshot,
    writeStructuredSpreadsheetModel
  };
}
