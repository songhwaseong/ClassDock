"use strict";

/* CSV·엑셀 → 테이블 적재 — 파일의 행을 한 테이블에 넣는다.
   (지금까지 `가져오기` 는 .sql 텍스트를 편집기에 붙이는 것뿐이었다. 표를 그대로 넣는 길이 없었다.)

   편집기에 INSERT 문을 만들어 붙이지 않는다. 그러면 값을 SQL 에 이어 붙이게 되고,
   따옴표·NULL·숫자·날짜 구분을 프런트가 떠맡는 순간 `O'Brien` 한 줄에 무너진다.
   여기서는 (값, NULL 여부) 만 실어 보내고 INSERT 문장은 워커가 자리표시자로 짓는다 —
   셀 편집(/db-apply)과 같은 규약이다.

   수천 행짜리 일이라 시작만 시키고 결과는 폴링으로 받는다(덤프와 같은 방식).
   하나라도 실패하면 워커가 전부 되돌리고 몇 번째 행 때문인지 짚어 준다. */

const MNDbImport = (() => {
  const POLL_MS = 300;

  // 한도는 워커(MAX_IMPORT_ROWS·MAX_IMPORT_CELLS)와 런처의 것과 같은 값이다.
  // 넘는 파일은 앞부분만 조용히 넣지 않고 나눠 달라고 말한다.
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  // 파일에서 고른 열만 보내므로 파일 한도와 요청 한도는 다르다. 런처의 MaxDbImportBytes와 맞춘다.
  const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
  const MAX_ROWS = 10000;
  const MAX_CELLS = 100000;
  const MAX_COLUMNS = 512;
  const MAX_VALUE_CHARS = 65535;
  const PREVIEW_ROWS = 100;

  /* 같은 키가 있을 때 무엇을 할지. REPLACE 는 넣지 않는다 — 그것은 DELETE + INSERT 라
     외래키 ON DELETE CASCADE 가 딸린 자식 행을 말없이 지운다. 적재 창이 낼 수 있는 결과가 아니다. */
  const MODES = [
    { value:"insert", label:"실패 시 전체 취소 (기본)", note:"같은 키가 있으면 아무것도 넣지 않고 그 행을 알려 줍니다." },
    { value:"ignore", label:"같은 키인 행은 건너뛰기", note:"자료형이 틀린 행까지 조용히 빠집니다 — 건너뛴 까닭은 알 수 없습니다." },
    { value:"update", label:"같은 키인 행은 덮어쓰기", note:"기존 행의 값이 파일의 값으로 바뀝니다. 되돌릴 수 없습니다." }
  ];

  const DELIMITERS = [
    { value:"auto", label:"자동" }, { value:",", label:"쉼표 ," }, { value:";", label:"세미콜론 ;" },
    { value:"\t", label:"탭" }, { value:"|", label:"세로줄 |" }
  ];

  const ENCODINGS = [
    { value:"auto", label:"자동 판정" }, { value:"utf-8", label:"UTF-8" },
    { value:"cp949", label:"CP949 (한글 윈도우)" }, { value:"utf-16le", label:"UTF-16 LE" }
  ];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const button = (label, className, title) => {
    const node = el("button", className || "db-btn", label);
    node.type = "button";
    if (title) node.title = title;
    return node;
  };

  const select = (items, value, label) => {
    const node = document.createElement("select");
    node.className = "db-import-select";
    items.forEach(item => node.append(new Option(item.label, item.value)));
    if (value != null) node.value = value;
    if (label) node.setAttribute("aria-label", label);
    return node;
  };

  const notify = (message, ms) => { if (typeof toast === "function") toast(message, ms || 3000); };

  const messageFor = (info) => (typeof MNDbClient !== "undefined" && MNDbClient.messageFor)
    ? MNDbClient.messageFor(info) : "적재하지 못했습니다.";

  const countText = (value) => Number(value || 0).toLocaleString();
  const sizeText = (bytes) => {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + "MB";
    if (value >= 1024) return Math.round(value / 1024) + "KB";
    return value + "B";
  };

  /* ── 순수 계산 ──────────────────────────────────────────────────────────
     화면을 모르는 셈만 모아 둔다. 값이 어떻게 해석되는지가 이 기능의 전부라
     테스트는 전부 여기에 붙는다. */

  // 첫 몇 줄에서 가장 많이 나온 구분자를 고른다. 따옴표 안까지 세지만, 후보들 사이의
  // 상대적인 수만 보면 되므로 그 정도 오차로 뒤집히지 않는다.
  const guessDelimiter = (text) => {
    const head = String(text || "").split(/\r?\n/).slice(0, 20).join("\n");
    let best = ",", top = 0;
    [",", "\t", ";", "|"].forEach((candidate) => {
      const count = head.split(candidate).length - 1;
      if (count > top){ top = count; best = candidate; }
    });
    return top ? best : ",";
  };

  // 이름 맞대기용으로 눌러 놓은 꼴. 대소문자·공백·밑줄만 다른 머리글을 같은 것으로 본다.
  const normalizeName = (value) => String(value == null ? "" : value)
    .replace(/[\s_\-]/g, "").toLowerCase();

  /* 파일 머리글과 테이블 컬럼을 이름으로 맞댄다. 맞대지 못한 컬럼은 -1(넣지 않음)로 둔다 —
     자리 순서로 넘겨짚지 않는다. 열 순서가 우연히 맞는 파일보다 어긋난 파일이 훨씬 많고,
     엉뚱한 열이 들어가면 되돌릴 수 없다. */
  const autoMapping = (columns, header) => {
    const taken = new Set();
    const heads = (header || []).map(normalizeName);
    return (columns || []).map((column) => {
      const wanted = normalizeName(column && column.name);
      if (!wanted) return -1;
      const at = heads.findIndex((name, index) => name === wanted && !taken.has(index));
      if (at < 0) return -1;
      taken.add(at);
      return at;
    });
  };

  // 값을 꼭 적어야 하는 컬럼(NOT NULL · 기본값 없음 · 자동 아님). 행 추가 창과 같은 판정이다.
  const isRequired = (column) => {
    const extra = String((column && column.extra) || "").toUpperCase();
    const auto = extra.indexOf("AUTO_INCREMENT") >= 0 || extra.indexOf("GENERATED") >= 0;
    return !column.nullable && column.default == null && !auto;
  };

  const isGenerated = (column) => {
    const extra = String((column && column.extra) || "").toUpperCase();
    return extra.indexOf("AUTO_INCREMENT") >= 0 || extra.indexOf("GENERATED") >= 0;
  };

  /* 파일의 글자 하나를 (값, NULL 여부) 로 옮긴다. 여기가 적재의 값 규칙 전부다.

     빈 칸의 기본은 NULL 이다 — 붙여넣기(빈 문자열)와 정반대인데, 적재는 새 행을 만드는
     일이라 "값이 없다"가 자연스럽고 CSV 도구 대부분이 그렇게 한다. 창에서 바꿀 수 있다.
     숫자·날짜는 손대지 않고 글자 그대로 보낸다. 서버가 컬럼 자료형으로 바꾸다 실패하면
     몇 번째 행인지 알려 준다 — 앱이 값을 추측해 고치면 어디가 틀어졌는지 아무도 모른다. */
  const cellFor = (raw, options) => {
    const opts = options || {};
    const text = raw == null ? "" : String(raw);
    const token = String(opts.nullToken == null ? "" : opts.nullToken);
    if (token && text === token) return { value:"", isNull:true };
    if (text === "") return { value:"", isNull:opts.nullOnEmpty !== false };
    return { value:text, isNull:false };
  };

  /* 파일 격자 + 매핑 + 값 규칙 → 보낼 것. 무엇이 나가는지와 무엇이 막는지를 한 번에 낸다.
       grid    : 파일에서 읽은 격자(머리글 포함)
       columns : 테이블 컬럼 정의 [{ name, type, nullable, default, extra }]
       mapping : 테이블 컬럼마다 파일 열 번호(-1 = 넣지 않음 → 서버 기본값)
       options : { header, skip, nullOnEmpty, nullToken } */
  const importPlan = (grid, columns, mapping, options) => {
    const opts = options || {};
    const lines = Array.isArray(grid) ? grid : [];
    const start = Math.max(0, Number(opts.skip) || 0) + (opts.header === false ? 0 : 1);
    const picked = [];
    (columns || []).forEach((column, index) => {
      const from = Number((mapping || [])[index]);
      if (Number.isInteger(from) && from >= 0) picked.push({ column, from });
    });

    const rows = [], sourceLines = [];
    let blank = 0, tooLong = 0, nullIntoNotNull = 0;
    for (let index = start; index < lines.length; index++){
      const line = lines[index] || [];
      // 파일 끝의 빈 줄로 빈 행을 넣지 않는다. 몇 줄을 건너뛰었는지는 요약에 적는다.
      if (!line.some(value => String(value == null ? "" : value).trim() !== "")){ blank++; continue; }
      const row = picked.map((item) => {
        const cell = cellFor(line[item.from], opts);
        if (cell.isNull && !item.column.nullable) nullIntoNotNull++;
        else if (cell.value.length > MAX_VALUE_CHARS) tooLong++;
        return cell;
      });
      rows.push(row);
      sourceLines.push(index + 1);            // 사용자가 파일에서 찾을 줄 번호(1부터)
    }

    // 막는 것과 알리기만 하는 것을 나눈다. 막는 것은 보내 봐야 서버가 전부 되돌릴 일들이다.
    const blocking = [], warnings = [];
    if (!picked.length) blocking.push("넣을 컬럼을 하나 이상 골라 주세요.");
    if (picked.length > MAX_COLUMNS) blocking.push("한 번에 넣을 수 있는 컬럼은 " + MAX_COLUMNS + "개까지입니다.");
    if (!rows.length) blocking.push("넣을 행이 없습니다. 머리글 설정과 건너뛸 줄 수를 확인해 주세요.");
    if (rows.length > MAX_ROWS)
      blocking.push("한 번에 넣을 수 있는 행은 " + countText(MAX_ROWS) + "행까지입니다(파일 "
        + countText(rows.length) + "행). 파일을 나누거나, 전체를 옮기는 것이라면 .sql 덤프를 쓰세요.");
    if (rows.length * picked.length > MAX_CELLS)
      blocking.push("한 번에 넣을 수 있는 칸은 " + countText(MAX_CELLS) + "개까지입니다(지금 "
        + countText(rows.length * picked.length) + "개).");
    if (nullIntoNotNull)
      blocking.push("NULL 을 받지 않는 컬럼에 빈 칸이 " + countText(nullIntoNotNull)
        + "개 있습니다. 빈 칸 처리를 바꾸거나, 그 컬럼을 ‘넣지 않음’으로 두어 서버 기본값에 맡기세요.");
    if (tooLong)
      blocking.push("한 칸에 넣을 수 있는 글자 수(" + countText(MAX_VALUE_CHARS) + "자)를 넘는 값이 "
        + countText(tooLong) + "개 있습니다.");

    (columns || []).forEach((column, index) => {
      const from = Number((mapping || [])[index]);
      if (Number.isInteger(from) && from >= 0) return;
      if (isRequired(column))
        blocking.push(column.name + " 은 값을 꼭 넣어야 하는 컬럼입니다(NOT NULL · 기본값 없음). 파일 열을 골라 주세요.");
    });

    if (blank) warnings.push("빈 줄 " + countText(blank) + "개는 건너뜁니다.");
    const unmapped = (columns || []).length - picked.length;
    if (unmapped > 0) warnings.push("고르지 않은 컬럼 " + countText(unmapped) + "개는 서버 기본값이 채웁니다.");

    return { columns:picked.map(item => item.column.name), rows, sourceLines, blank, blocking, warnings };
  };

  /* 요청 값의 순서는 런처의 StartDbImport 가 읽는 순서와 한 자리도 어긋나면 안 된다.
     어긋나도 오류가 나지 않고 값이 옆 컬럼으로 들어간다. 그래서 창에서 떼어 내 따로 만들고,
     테스트가 런처와 나란히 놓고 본다(/db-apply · /db-dump 와 같은 이유다). */
  const requestValues = (request) => {
    const columns = (request && request.columns) || [];
    const rows = (request && request.rows) || [];
    const values = [
      String((request && request.database) || ""),
      String((request && request.table) || ""),
      String((request && request.mode) || "insert"),
      String(columns.length)
    ];
    columns.forEach(name => values.push(String(name)));
    values.push(String(rows.length));
    rows.forEach((row) => {
      row.forEach((cell) => {
        const isNull = !!(cell && cell.isNull);
        values.push(isNull || !cell || cell.value == null ? "" : String(cell.value), isNull ? "1" : "0");
      });
    });
    return values;
  };

  /* ── 파일 읽기 ──────────────────────────────────────────────────────────
     구분자 파서는 MNDataConvert 의 것을 그대로 쓴다(앱 안에 CSV 파서를 하나 더 만들지 않는다).
     인코딩 판정기도 .sql 가져오기가 쓰는 코어의 것을 그대로 쓴다 — 한글 CSV 는 CP949 가 흔하다. */

  const decodeText = (bytes, wanted) => {
    const info = typeof detectTextEncoding === "function" ? detectTextEncoding(bytes) : null;
    const encoding = wanted && wanted !== "auto" ? wanted : ((info && info.encoding) || "utf-8");
    let text;
    try { text = new TextDecoder(encoding).decode(bytes); }
    catch(_){ text = new TextDecoder("utf-8").decode(bytes); }
    return { text:String(text || "").replace(/^﻿/, ""), encoding };
  };

  const readDelimited = async (file, opts) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeText(bytes, opts && opts.encoding);
    const wanted = opts && opts.delimiter;
    const delimiter = wanted && wanted !== "auto" ? wanted : guessDelimiter(decoded.text);
    const convert = typeof MNDataConvert !== "undefined" ? MNDataConvert : null;
    if (!convert) throw new Error("형식 변환 모듈을 불러오지 못했습니다.");
    const grid = convert.parseDelimited(decoded.text, delimiter)
      .map(row => row.map(value => String(value == null ? "" : value)));
    return { grid, encoding:decoded.encoding, delimiter, sheets:[] };
  };

  /* 엑셀의 날짜는 숫자다. cellDates 로 Date 를 받아 여기서 한 번만 글자로 굳힌다 —
     그러지 않으면 `45231` 이 그대로 들어간다. 시각이 0시면 날짜만 적어 DATE 컬럼에 맞춘다. */
  const dateText = (value) => {
    const pad = (number) => String(number).padStart(2, "0");
    const date = value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate());
    const time = pad(value.getHours()) + ":" + pad(value.getMinutes()) + ":" + pad(value.getSeconds());
    return time === "00:00:00" ? date : date + " " + time;
  };

  const sheetCellText = (value) => {
    if (value == null) return "";
    if (value instanceof Date) return dateText(value);
    if (typeof value === "boolean") return value ? "1" : "0";
    return String(value);
  };

  const readWorkbook = async (file, opts) => {
    if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("xlsx");
    if (typeof XLSX === "undefined") throw new Error("Excel 라이브러리를 불러오지 못했습니다.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const book = XLSX.read(bytes, { type:"array", cellDates:true });
    const sheets = book.SheetNames || [];
    if (!sheets.length) throw new Error("시트가 없는 파일입니다.");
    const wanted = opts && opts.sheet && sheets.indexOf(opts.sheet) >= 0 ? opts.sheet : sheets[0];
    const rows = XLSX.utils.sheet_to_json(book.Sheets[wanted],
      { header:1, raw:true, blankrows:false, defval:"" });
    return { grid:rows.map(row => row.map(sheetCellText)), sheets, sheet:wanted, encoding:"", delimiter:"" };
  };

  const isWorkbook = (name) => /\.(xlsx|xlsm|xls)$/i.test(String(name || ""));

  const readFileGrid = (file, opts) => isWorkbook(file.name) ? readWorkbook(file, opts) : readDelimited(file, opts);

  /* ── 창 ────────────────────────────────────────────────────────────────── */

  const open = (context) => {
    const sessionId = context && context.sessionId;
    if (!sessionId) return null;
    if (document.querySelector(".db-import-modal")) return null;

    const database = String((context && context.database) || "");
    const tables = ((context && context.tables) || []).map(String);
    let table = String((context && context.table) || tables[0] || "");
    if (!table) return null;

    const modal = el("div", "modal db-table-modal db-import-modal");
    const card = el("div", "modal-card db-table-card db-import-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "CSV·엑셀 데이터 적재");

    const head = el("div", "db-table-modal-head");
    const headIcon = el("span", "db-table-modal-icon");
    if (typeof uiIcon === "function") headIcon.innerHTML = uiIcon("table");
    const heading = el("div", "db-table-modal-heading");
    const headTitle = el("h3", null, "데이터 적재");
    const headSub = el("p", "sub", "");
    heading.append(headTitle, headSub);
    const closeButton = button("", "db-table-modal-close", "닫기");
    closeButton.setAttribute("aria-label", "닫기");
    if (typeof uiIcon === "function") closeButton.innerHTML = uiIcon("close");
    head.append(headIcon, heading, closeButton);

    const body = el("div", "db-table-modal-body db-import-body");
    const columnsWrap = el("div", "db-import-columns");

    /* 왼쪽 — 파일과 미리보기 ------------------------------------------- */

    const left = el("section", "db-import-pane");
    left.append(el("h4", "db-import-heading", "파일"));

    const fileRow = el("div", "db-import-file-row");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".csv,.tsv,.txt,.xlsx,.xlsm,.xls";
    fileInput.hidden = true;
    fileInput.setAttribute("aria-hidden", "true");
    const pickButton = button("파일 고르기", "db-btn db-btn-quiet", "CSV·TSV·엑셀 파일을 고릅니다");
    const fileName = el("span", "db-import-file-name", "고른 파일이 없습니다");
    fileRow.append(pickButton, fileName, fileInput);

    const readOptions = el("div", "db-import-read-options");
    const sheetSelect = select([], "", "시트");
    const sheetField = el("label", "db-import-field");
    sheetField.append(el("span", null, "시트"), sheetSelect);
    sheetField.hidden = true;
    const encodingSelect = select(ENCODINGS, "auto", "인코딩");
    const encodingField = el("label", "db-import-field");
    encodingField.append(el("span", null, "인코딩"), encodingSelect);
    const delimiterSelect = select(DELIMITERS, "auto", "구분자");
    const delimiterField = el("label", "db-import-field");
    delimiterField.append(el("span", null, "구분자"), delimiterSelect);
    const skipInput = document.createElement("input");
    skipInput.type = "number";
    skipInput.min = "0";
    skipInput.value = "0";
    skipInput.setAttribute("aria-label", "건너뛸 앞줄 수");
    const skipField = el("label", "db-import-field");
    skipField.append(el("span", null, "앞에서 건너뛸 줄"), skipInput);
    readOptions.append(sheetField, encodingField, delimiterField, skipField);

    const headerBox = document.createElement("input");
    headerBox.type = "checkbox";
    headerBox.checked = true;
    const headerLabel = el("label", "db-import-check");
    headerLabel.append(headerBox, el("span", null, "첫 줄은 머리글(컬럼 이름)"));

    const preview = el("div", "db-import-preview");
    const previewNote = el("p", "db-import-note", "파일을 고르면 앞 " + PREVIEW_ROWS + "행을 여기에 보여 줍니다.");
    left.append(fileRow, readOptions, headerLabel, previewNote, preview);

    /* 오른쪽 — 대상·매핑·값 규칙 --------------------------------------- */

    const right = el("section", "db-import-pane db-import-settings");
    right.append(el("h4", "db-import-heading", "넣을 곳"));
    const tableSelect = select(tables.map(name => ({ value:name, label:name })), table, "적재할 테이블");
    const tableField = el("label", "db-import-field");
    tableField.append(el("span", null, "테이블"), tableSelect);
    if (tables.length < 2) tableField.hidden = true;
    right.append(tableField);

    right.append(el("h4", "db-import-heading", "컬럼 맞대기"));
    const mapList = el("div", "db-import-map");
    right.append(mapList);

    right.append(el("h4", "db-import-heading", "값 규칙"));
    const emptySelect = select([
      { value:"null", label:"NULL 로 (기본)" }, { value:"text", label:"빈 문자열로" }
    ], "null", "빈 칸 처리");
    const emptyField = el("label", "db-import-field");
    emptyField.append(el("span", null, "빈 칸"), emptySelect);
    const tokenInput = document.createElement("input");
    tokenInput.type = "text";
    tokenInput.placeholder = "예: \\N";
    tokenInput.setAttribute("aria-label", "NULL 로 볼 표기");
    const tokenField = el("label", "db-import-field");
    tokenField.append(el("span", null, "NULL 표기"), tokenInput);
    const valueOptions = el("div", "db-import-read-options");
    valueOptions.append(emptyField, tokenField);
    right.append(valueOptions,
      el("p", "db-import-note", "숫자·날짜는 글자 그대로 보냅니다. 서버가 컬럼 자료형으로 바꾸다 실패하면 그 행을 알려 줍니다."));

    right.append(el("h4", "db-import-heading", "같은 키가 있을 때"));
    const modeSelect = select(MODES, "insert", "중복키 처리");
    const modeField = el("label", "db-import-field");
    modeField.append(el("span", null, "처리"), modeSelect);
    const modeNote = el("p", "db-import-note", MODES[0].note);
    right.append(modeField, modeNote);

    columnsWrap.append(left, right);
    body.append(columnsWrap);

    /* 아래쪽 — 요약·진행·단추 ------------------------------------------ */

    const foot = el("div", "db-dump-foot");
    const summary = el("p", "db-dump-summary", "파일을 고르면 넣을 행 수를 보여 줍니다.");
    const progress = el("p", "db-dump-progress");
    progress.hidden = true;
    const startButton = button("적재", "db-btn db-btn-primary", "파일의 행을 이 테이블에 넣습니다");
    startButton.disabled = true;
    const cancelButton = button("중단", "db-btn db-btn-quiet");
    cancelButton.hidden = true;
    const closeFoot = button("닫기", "db-btn db-btn-quiet");
    const actions = el("div", "db-dump-actions");
    actions.append(cancelButton, closeFoot, startButton);
    const status = el("div", "db-dump-status");
    status.append(summary, progress);
    foot.append(status, actions);

    card.append(head, body, foot);
    modal.append(card);
    document.body.append(modal);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

    /* ── 상태 ────────────────────────────────────────────────────────────── */

    let file = null;              // 고른 파일
    let source = null;            // { grid, sheets, sheet, encoding, delimiter }
    let tableColumns = [];        // 테이블 컬럼 정의
    let mapping = [];             // 테이블 컬럼 → 파일 열
    let plan = null;              // importPlan 결과
    let running = false;
    let job = "";
    let closed = false;
    let tableLoadGeneration = 0; // 늦게 온 이전 테이블 정의가 현재 매핑을 덮지 못하게 한다
    let fileReadGeneration = 0;  // 시트·인코딩을 빠르게 바꿔도 마지막 선택만 남긴다

    const readOptionsOf = () => ({
      encoding:encodingSelect.value, delimiter:delimiterSelect.value, sheet:sheetSelect.value
    });

    const valueOptionsOf = () => ({
      header:headerBox.checked,
      skip:Math.max(0, Number(skipInput.value) || 0),
      nullOnEmpty:emptySelect.value !== "text",
      nullToken:tokenInput.value
    });

    const headerRow = () => {
      if (!source || !headerBox.checked) return [];
      const at = Math.max(0, Number(skipInput.value) || 0);
      return source.grid[at] || [];
    };

    const columnWidth = () => (source ? source.grid.reduce((max, row) => Math.max(max, row.length), 0) : 0);

    const fileColumnLabel = (index) => {
      const head = headerRow()[index];
      const name = String(head == null ? "" : head).trim();
      return name ? (index + 1) + ". " + name : (index + 1) + "번째 열";
    };

    const setRunning = (on) => {
      running = on;
      startButton.textContent = on ? "넣는 중…" : "적재";
      cancelButton.hidden = !on;
      progress.hidden = !on;
      [pickButton, tableSelect, sheetSelect, encodingSelect, delimiterSelect, skipInput,
        headerBox, emptySelect, tokenInput, modeSelect].forEach(node => { node.disabled = on; });
      mapList.querySelectorAll("select").forEach(node => { node.disabled = on; });
      if (!on) refreshPlan();
      else startButton.disabled = true;
    };

    /* 매핑 줄. 왼쪽이 테이블 컬럼(정의는 서버가 준 것), 오른쪽이 파일 열이다.
       자동 이름 맞대기로 채워 두고 사람이 고칠 수 있게 둔다. */
    const renderMapping = () => {
      mapList.innerHTML = "";
      if (!tableColumns.length){
        mapList.append(el("p", "db-import-note", "테이블 정의를 읽는 중…"));
        return;
      }
      const width = columnWidth();
      const choices = [{ value:"-1", label:"넣지 않음 (기본값)" }];
      for (let index = 0; index < width; index++) choices.push({ value:String(index), label:fileColumnLabel(index) });
      tableColumns.forEach((column, index) => {
        const row = el("div", "db-import-map-row");
        const label = el("div", "db-import-map-name");
        label.append(el("strong", null, column.name));
        const flags = [String(column.type || "")];
        if (!column.nullable) flags.push("NOT NULL");
        if (isGenerated(column)) flags.push("자동");
        else if (column.default != null) flags.push("기본값 " + column.default);
        label.append(el("span", "db-import-map-type", flags.join(" · ")));
        const pick = select(choices, String(mapping[index] == null ? -1 : mapping[index]), column.name + " 에 넣을 파일 열");
        pick.addEventListener("change", () => {
          mapping[index] = Number(pick.value);
          refreshPlan();
        });
        if (isGenerated(column)){
          // AUTO_INCREMENT·생성 컬럼에 값을 넣으면 서버가 거절하거나 뜻이 달라진다. 기본값에 맡긴다.
          pick.value = "-1";
          pick.disabled = true;
          pick.title = "자동으로 채워지는 컬럼이라 값을 넣지 않습니다.";
          mapping[index] = -1;
        }
        row.append(label, pick);
        mapList.append(row);
      });
    };

    const renderPreview = () => {
      preview.innerHTML = "";
      if (!source || !source.grid.length){
        previewNote.textContent = "파일을 고르면 앞 " + PREVIEW_ROWS + "행을 여기에 보여 줍니다.";
        return;
      }
      const width = columnWidth();
      const opts = valueOptionsOf();
      const start = opts.skip + (opts.header ? 1 : 0);
      const shown = source.grid.slice(start, start + PREVIEW_ROWS);
      const table = el("table", "db-import-preview-table");
      const thead = el("thead");
      const headTr = el("tr");
      headTr.append(el("th", "db-import-preview-index", ""));
      for (let index = 0; index < width; index++) headTr.append(el("th", null, fileColumnLabel(index)));
      thead.append(headTr);
      const tbody = el("tbody");
      shown.forEach((row, at) => {
        const tr = el("tr");
        tr.append(el("td", "db-import-preview-index", String(start + at + 1)));
        for (let index = 0; index < width; index++){
          const cell = cellFor(row[index], opts);
          const td = el("td", cell.isNull ? "db-null" : null, cell.isNull ? "NULL" : cell.value);
          tr.append(td);
        }
        tbody.append(tr);
      });
      table.append(thead, tbody);
      preview.append(table);
      previewNote.textContent = "파일 " + countText(source.grid.length) + "줄 · 앞 "
        + countText(shown.length) + "행 미리보기"
        + (source.encoding ? " · " + source.encoding : "")
        + (source.delimiter ? " · 구분자 " + (source.delimiter === "\t" ? "탭" : source.delimiter) : "");
    };

    const refreshPlan = () => {
      headSub.textContent = (database ? database + "." : "") + table
        + " · 파일의 행을 그대로 넣습니다(값은 SQL 문장에 붙지 않습니다)";
      if (!source || !tableColumns.length){
        plan = null;
        summary.textContent = source ? "테이블 정의를 읽는 중…" : "파일을 고르면 넣을 행 수를 보여 줍니다.";
        startButton.disabled = true;
        return;
      }
      plan = importPlan(source.grid, tableColumns, mapping, valueOptionsOf());
      const parts = [];
      if (plan.blocking.length) parts.push(plan.blocking[0]);
      else parts.push(countText(plan.rows.length) + "행 × " + plan.columns.length + "컬럼을 넣습니다");
      plan.warnings.forEach(note => parts.push(note));
      summary.textContent = parts.join(" · ");
      summary.classList.toggle("db-import-blocked", plan.blocking.length > 0);
      startButton.disabled = running || plan.blocking.length > 0;
    };

    const loadTableColumns = async () => {
      const generation = ++tableLoadGeneration;
      const requestedTable = table;
      tableColumns = [];
      mapping = [];
      renderMapping();
      refreshPlan();
      try {
        const url = "/db-table?id=" + encodeURIComponent(sessionId) + "&mode=info"
          + "&name=" + encodeURIComponent(requestedTable)
          + "&database=" + encodeURIComponent(database);
        const response = await fetch(url, { cache:"no-store" });
        if (!response.ok) throw new Error((await response.text()) || ("HTTP " + response.status));
        const data = await response.json();
        if (closed || generation !== tableLoadGeneration || table !== requestedTable) return;
        if (!data.ok){ notify(messageFor(data.info), 3600); return; }
        tableColumns = (data.info.columns || []).map(column => ({
          name:String(column.name || ""), type:String(column.type || ""),
          nullable:!!column.nullable, default:column.default, extra:String(column.extra || "")
        }));
        mapping = autoMapping(tableColumns, headerRow());
        tableColumns.forEach((column, index) => { if (isGenerated(column)) mapping[index] = -1; });
      } catch(error){
        if (closed || generation !== tableLoadGeneration || table !== requestedTable) return;
        notify("테이블 정의를 읽지 못했습니다. " + String((error && error.message) || ""), 3600);
      }
      if (closed || generation !== tableLoadGeneration || table !== requestedTable) return;
      renderMapping();
      refreshPlan();
    };

    const loadFile = async (picked) => {
      if (!picked) return;
      const generation = ++fileReadGeneration;
      if (picked.size > MAX_FILE_BYTES){
        notify(picked.name + " 은 " + sizeText(picked.size) + " 입니다. "
          + sizeText(MAX_FILE_BYTES) + " 이하의 파일만 열 수 있습니다.", 4200);
        return;
      }
      file = picked;
      fileName.textContent = picked.name + " · " + sizeText(picked.size);
      summary.textContent = "파일을 읽는 중…";
      try {
        const loaded = await readFileGrid(picked, readOptionsOf());
        if (closed || generation !== fileReadGeneration || file !== picked) return;
        source = loaded;
      } catch(error){
        if (closed || generation !== fileReadGeneration || file !== picked) return;
        source = null;
        notify("파일을 읽지 못했습니다. " + String((error && error.message) || ""), 4000);
        refreshPlan();
        return;
      }
      const workbook = isWorkbook(picked.name);
      sheetField.hidden = !workbook;
      encodingField.hidden = workbook;
      delimiterField.hidden = workbook;
      if (workbook){
        sheetSelect.innerHTML = "";
        (source.sheets || []).forEach(name => sheetSelect.append(new Option(name, name)));
        sheetSelect.value = source.sheet || "";
      } else {
        encodingSelect.value = readOptionsOf().encoding === "auto" ? "auto" : encodingSelect.value;
        if (delimiterSelect.value === "auto")
          delimiterSelect.title = "자동 판정: " + (source.delimiter === "\t" ? "탭" : source.delimiter);
      }
      renderPreview();
      // 머리글이 새로 생겼으니 이름 맞대기를 다시 한다(사람이 고친 매핑은 파일이 바뀌면 뜻이 없다).
      mapping = autoMapping(tableColumns, headerRow());
      tableColumns.forEach((column, index) => { if (isGenerated(column)) mapping[index] = -1; });
      renderMapping();
      refreshPlan();
    };

    const reread = async () => {
      if (!file) return;
      const picked = file;
      const generation = ++fileReadGeneration;
      let loaded;
      try { loaded = await readFileGrid(picked, readOptionsOf()); }
      catch(error){
        if (!closed && generation === fileReadGeneration && file === picked)
          notify("파일을 다시 읽지 못했습니다.", 3000);
        return;
      }
      if (closed || generation !== fileReadGeneration || file !== picked) return;
      source = loaded;
      renderPreview();
      mapping = autoMapping(tableColumns, headerRow());
      tableColumns.forEach((column, index) => { if (isGenerated(column)) mapping[index] = -1; });
      renderMapping();
      refreshPlan();
    };

    /* ── 실행 ────────────────────────────────────────────────────────────── */

    const showProgress = (info) => {
      if (!info || !info.total){ progress.textContent = "넣는 중…"; return; }
      progress.textContent = countText(info.done) + " / " + countText(info.total) + "행";
    };

    const finish = (response) => {
      setRunning(false);
      job = "";
      const info = (response && response.info) || {};
      progress.hidden = false;
      if (!response || !response.ok){
        const code = String(info.code || "");
        if (code === "cancelled"){
          progress.textContent = "중단했습니다. 한 행도 넣지 않았습니다.";
          notify("적재를 중단했습니다. 넣던 행은 전부 되돌렸습니다.", 3600);
          return;
        }
        // 몇 번째 행인지 알려 주면 파일에서 그 줄을 바로 찾을 수 있다.
        let text = messageFor(info);
        if (Number.isInteger(info.row) && plan){
          const line = plan.sourceLines[info.row];
          text = (info.row + 1) + "번째 행에서 멈췄습니다"
            + (line ? "(파일 " + countText(line) + "줄)" : "") + ": " + text;
        }
        progress.textContent = text + " — 아무것도 반영되지 않았습니다.";
        notify(text, 5000);
        return;
      }
      const rows = Number(info.rows) || 0;
      const affected = Number(info.affected) || 0;
      const bits = [countText(rows) + "행을 보냈습니다"];
      if (info.mode === "ignore") bits.push("서버가 넣은 행 " + countText(affected)
        + (rows > affected ? " · 건너뛴 행 " + countText(rows - affected) : ""));
      else if (info.mode === "update") bits.push("서버 보고 " + countText(affected) + "건(넣기 1 · 덮어쓰기 2로 셉니다)");
      if (info.ms != null) bits.push((Number(info.ms) / 1000).toFixed(1) + "초");
      if (info.autoCommit === false) bits.push("커밋해야 확정됩니다");
      progress.textContent = bits.join(" · ");
      notify(countText(rows) + "행을 " + table + " 에 넣었어요.", 3600);
      if (typeof context.onImported === "function") context.onImported(table, info);
    };

    const poll = () => {
      if (closed && !running) return;
      setTimeout(async () => {
        if (!job) return;
        try {
          const response = await fetch("/db-query-poll?job=" + encodeURIComponent(job), { cache:"no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const data = await response.json();
          if (!data.done){ showProgress(data.progress); poll(); return; }
          finish(data);
        } catch(_){
          setRunning(false);
          job = "";
          progress.hidden = false;
          progress.textContent = "진행 상황을 확인하지 못했습니다.";
        }
      }, POLL_MS);
    };

    const start = async () => {
      if (running || !plan || plan.blocking.length) return;
      const values = requestValues({
        database, table, mode:modeSelect.value, columns:plan.columns, rows:plan.rows
      });
      const payload = MNDbClient.encodeStrings(values);
      if (payload.byteLength > MAX_REQUEST_BYTES){
        const text = "적재 요청이 " + sizeText(payload.byteLength) + "라 한 번에 보낼 수 있는 "
          + sizeText(MAX_REQUEST_BYTES) + "를 넘습니다. 파일을 나누거나 넣을 컬럼 수를 줄여 주세요.";
        progress.hidden = false;
        progress.textContent = text;
        notify(text, 5000);
        return;
      }
      if (typeof confirmDialog === "function"){
        const mode = MODES.find(item => item.value === modeSelect.value) || MODES[0];
        const ok = await confirmDialog(
          (database ? database + "." : "") + table + " 에 " + countText(plan.rows.length) + "행을 넣습니다.\n\n"
            + "· 컬럼 " + plan.columns.join(", ") + "\n"
            + "· 같은 키가 있을 때: " + mode.label + "\n\n"
            + "하나라도 실패하면 전부 되돌립니다.", "적재", "취소");
        if (!ok) return;
      }
      setRunning(true);
      showProgress(null);
      try {
        const response = await fetch("/db-import?id=" + encodeURIComponent(sessionId), {
          method:"POST", body:payload
        });
        if (!response.ok) throw new Error((await response.text()) || ("HTTP " + response.status));
        const started = await response.json();
        job = String(started.job || "");
        if (!job) throw new Error("no-job");
        poll();
      } catch(error){
        setRunning(false);
        progress.hidden = false;
        progress.textContent = "적재를 시작하지 못했습니다. " + String((error && error.message) || "");
      }
    };

    /* ── 붙이기 ──────────────────────────────────────────────────────────── */

    const close = () => {
      if (running) notify("적재는 계속 진행됩니다. 끝나면 알려 드립니다.", 3000);
      closed = true;
      window.removeEventListener("keydown", onKey, true);
      modal.remove();
    };

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    closeButton.addEventListener("click", close);
    closeFoot.addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

    pickButton.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
    fileInput.addEventListener("change", () => {
      loadFile(fileInput.files && fileInput.files[0]).catch(() => notify("파일을 읽지 못했습니다.", 3000));
    });
    [encodingSelect, delimiterSelect, sheetSelect].forEach(node =>
      node.addEventListener("change", () => { reread(); }));
    [headerBox, skipInput].forEach(node => node.addEventListener("change", () => {
      renderPreview();
      mapping = autoMapping(tableColumns, headerRow());
      tableColumns.forEach((column, index) => { if (isGenerated(column)) mapping[index] = -1; });
      renderMapping();
      refreshPlan();
    }));
    [emptySelect, tokenInput].forEach(node => node.addEventListener("input", () => {
      renderPreview();
      refreshPlan();
    }));
    modeSelect.addEventListener("change", () => {
      modeNote.textContent = (MODES.find(item => item.value === modeSelect.value) || MODES[0]).note;
    });
    tableSelect.addEventListener("change", () => {
      table = tableSelect.value;
      loadTableColumns();
    });
    startButton.addEventListener("click", start);
    cancelButton.addEventListener("click", async () => {
      if (!job) return;
      cancelButton.disabled = true;
      progress.textContent = "중단하는 중…";
      try { await fetch("/db-query-cancel?job=" + encodeURIComponent(job), { method:"POST" }); }
      catch(_){ /* 실패는 적재 자신의 결과로 드러난다 */ }
      cancelButton.disabled = false;
    });

    refreshPlan();
    loadTableColumns();
    pickButton.focus();

    return { close, modal };
  };

  return { open, MODES, DELIMITERS, ENCODINGS, guessDelimiter, normalizeName, autoMapping,
    isRequired, isGenerated, cellFor, importPlan, requestValues, dateText, sheetCellText,
    MAX_ROWS, MAX_CELLS, MAX_COLUMNS, MAX_FILE_BYTES, MAX_REQUEST_BYTES, MAX_VALUE_CHARS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNDbImport;
