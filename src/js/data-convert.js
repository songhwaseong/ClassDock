"use strict";

/* 데이터 형식 변환 공용 모듈 — MNDataConvert. (설계: docs/형식변환-설계.md)

   포맷 N개를 서로 변환하면 N×(N-1)개 변환기가 필요하다. 대신 중간 표현(IR)을 두고
   포맷마다 parse/serialize 한 쌍만 두면 2N개로 끝나고, 새 포맷 추가 비용이 2개로 고정된다.

     JSON/JSONL ─ parse ─→ Value  ⇄  Table ─ serialize ─→ CSV/TSV/마크다운 표
                          (flatten / unflatten)

   손실은 오직 flatten/unflatten 경계를 넘을 때만 생긴다. 나머지 어댑터는 무손실이다.
   그래서 이 파일에서 어려운 코드는 사실상 그 두 함수뿐이다.

   이 파일은 순수하다(DOM·전역 앱 함수를 쓰지 않는다). 모달·버튼 배선은 별도 파일이 맡는다.
   node --test 로 jsdom 없이 검증할 수 있어야 하므로 이 경계를 깨지 않는다. */
const MNDataConvert = (() => {
  const MAX_LOSS = 200;                       // 리포트가 수천 줄이 되면 아무도 안 읽는다 — 같은 코드는 묶고 상한을 둔다

  // ── 손실 코드 ────────────────────────────────────────
  // 구조적 손실(변환기가 직접 아는 것)과 값 손실(왕복 비교로 발견하는 것) 두 갈래다.
  const LOSS = {
    NESTED_FLATTENED:"nested-flattened",
    ARRAY_JOINED:"array-joined",
    ARRAY_EXPLODED:"array-exploded",
    ROOT_WRAPPED:"root-wrapped",
    SCALAR_WRAPPED:"scalar-wrapped",
    NULL_AMBIGUOUS:"null-ambiguous",
    HEADER_SYNTHESIZED:"header-synthesized",
    DUPLICATE_KEY:"duplicate-key",
    COLUMNS_CHANGED:"columns-changed",
    TYPE_LOST:"type-lost",
    PRECISION:"precision",
    NUMBER_REFORMATTED:"number-reformatted",
    LEADING_ZERO:"leading-zero",
    DATE_COERCED:"date-coerced",
    TEXT_FLATTENED:"text-flattened",
    COMMENT_DROPPED:"comment-dropped",
    SINGLE_ELEMENT_ARRAY:"single-element-array",
    NAME_SANITIZED:"name-sanitized",
    MERGED_CELLS:"merged-cells",
    MARKUP_DROPPED:"markup-dropped",
    MIXED_CONTENT:"mixed-content",
    MULTI_DOCUMENT:"multi-document",
    PATH_COLLISION:"path-collision",
    ROUNDTRIP_FAILED:"roundtrip-failed"
  };

  const HINT = {
    [LOSS.NESTED_FLATTENED]:"중첩 구조가 컬럼으로 펴졌어요. 컬럼 이름으로 되돌릴 수 있어요.",
    [LOSS.ARRAY_JOINED]:"배열을 한 칸에 합쳤어요. 되돌릴 수 없어요.",
    [LOSS.ARRAY_EXPLODED]:"배열 원소마다 행을 복제했어요. 되돌리면 원본과 달라져요.",
    [LOSS.ROOT_WRAPPED]:"객체 하나가 1행짜리 표가 됐어요. 되돌리면 객체 1개짜리 배열이 돼요.",
    [LOSS.SCALAR_WRAPPED]:"값 목록이 value 컬럼 하나로 담겼어요. 되돌리면 객체 배열이 돼요.",
    [LOSS.NULL_AMBIGUOUS]:"null(또는 없는 키)과 빈 값이 같은 빈 칸이 돼요. 되돌릴 때 구분할 수 없어요.",
    [LOSS.HEADER_SYNTHESIZED]:"헤더가 없어 컬럼 이름을 임의로 지었어요.",
    [LOSS.DUPLICATE_KEY]:"같은 컬럼 이름이 겹쳐 뒤엣것이 앞엣것을 덮어써요.",
    [LOSS.COLUMNS_CHANGED]:"되돌렸을 때 컬럼 구성이 달라졌어요.",
    [LOSS.TYPE_LOST]:"타입이 바뀌었어요(예: 숫자 → 문자열).",
    [LOSS.PRECISION]:"안전 정수 범위를 넘는 숫자예요. 정밀도가 깨질 수 있어요.",
    [LOSS.NUMBER_REFORMATTED]:"숫자 표기가 바뀌었어요(예: 1.10 → 1.1).",
    [LOSS.LEADING_ZERO]:"앞자리 0이 사라질 수 있어요. 사번·우편번호라면 타입 추론을 꺼 주세요.",
    [LOSS.DATE_COERCED]:"엑셀에서 날짜로 바뀌어 읽힐 수 있는 값이에요.",
    [LOSS.TEXT_FLATTENED]:"칸 안의 줄바꿈·탭을 공백으로 눕혔어요.",
    [LOSS.COMMENT_DROPPED]:"주석은 옮기지 않아요.",
    [LOSS.SINGLE_ELEMENT_ARRAY]:"원소가 하나뿐이라 배열인지 값 하나인지 XML 만 보고는 알 수 없어요.",
    [LOSS.NAME_SANITIZED]:"XML 요소 이름으로 쓸 수 없는 글자가 있어 바꿨어요.",
    [LOSS.MERGED_CELLS]:"병합된 칸(colspan·rowspan)은 펴지지 않고 한 칸으로만 읽혀요.",
    [LOSS.MARKUP_DROPPED]:"칸 안의 태그는 글자만 남기고 지웠어요.",
    [LOSS.MIXED_CONTENT]:"글자와 자식 요소가 섞인 순서는 중간 표현에서 보존할 수 없어요.",
    [LOSS.MULTI_DOCUMENT]:"--- 로 나뉜 여러 문서를 배열 하나로 합쳤어요.",
    [LOSS.PATH_COLLISION]:"컬럼 경로가 서로 겹쳐 한 값을 다른 값이 덮어썼어요.",
    [LOSS.ROUNDTRIP_FAILED]:"변환 결과를 다시 읽지 못했어요. 손실 검사를 끝내지 못했어요."
  };

  // ── 포맷 메타 ────────────────────────────────────────
  // shape:"tree" 는 계층을 그대로 담고, shape:"table" 은 평면이라 flatten 을 거쳐야 한다.
  const FORMATS = {
    json:  { label:"JSON",        ext:["json"],            shape:"tree"  },
    jsonl: { label:"JSONL",       ext:["jsonl","ndjson"],  shape:"tree"  },
    yaml:  { label:"YAML",        ext:["yaml","yml"],      shape:"tree", needs:"yaml" },
    xml:   { label:"XML",         ext:["xml"],             shape:"tree"  },
    csv:   { label:"CSV",         ext:["csv"],             shape:"table" },
    tsv:   { label:"TSV",         ext:["tsv","tab"],       shape:"table" },
    md:    { label:"마크다운 표",  ext:["md","markdown"],   shape:"table" },
    html:  { label:"HTML 표",     ext:["html","htm"],      shape:"table" }
  };

  const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const safeObject = () => Object.create(null);
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const assignOwn = (value, key, item) => {
    if (key === "__proto__") Object.defineProperty(value, key, { value:item, enumerable:true, configurable:true, writable:true });
    else value[key] = item;
  };
  const stripBom = (text) => String(text == null ? "" : text).replace(/^\uFEFF/, "");

  function note(loss, code, path, before, after){
    if (!Array.isArray(loss)) return;
    const key = code + "\u0000" + (path || "");
    const found = loss.find(item => item.key === key);
    if (found){ found.count++; return; }
    if (loss.length >= MAX_LOSS) return;
    loss.push({
      key, code,
      path: path || "",
      before: before == null ? "" : String(before),
      after: after == null ? "" : String(after),
      hint: HINT[code] || "",
      count: 1
    });
  }

  const merge = (target, items) => { for (const item of items || []) note(target, item.code, item.path, item.before, item.after); };

  // ── 셀 ──────────────────────────────────────────────
  // { v, raw } 두 필드가 이 모듈의 핵심이다. 타입 추론을 켠 채로도 원문을 잃지 않으려면
  // 추론값(v)과 원문(raw)을 함께 들고 다녀야 한다. "00123" 이 123 이 되어도 raw 로 되살린다.
  function canonical(value){
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try { return JSON.stringify(value); } catch(_){ return String(value); }
  }

  const cellOf = (value, raw) => ({ v:value, raw: raw == null ? canonical(value) : String(raw) });
  const MISSING = () => ({ v:undefined, raw:"" });      // 그 행에 아예 없던 키 — null 과 구분해 둔다

  // JSON 숫자 문법만 숫자로 본다. "00123"·"+1"·"1." 은 문법에서 벗어나므로 자연히 문자열로 남는다.
  const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

  function inferCell(raw, infer){
    const text = String(raw == null ? "" : raw);
    if (!infer) return { v:text, raw:text };
    if (text === "") return { v:"", raw:text };
    if (text === "null") return { v:null, raw:text };
    if (text === "true") return { v:true, raw:text };
    if (text === "false") return { v:false, raw:text };
    if (NUMBER_RE.test(text)) return { v:Number(text), raw:text };
    return { v:text, raw:text };
  }

  // ── 경로 문법: 주소.시 · 태그[0] · ["a.b"].c ──────────
  const NEEDS_BRACKET = /[.[\]"\\]/;

  function joinPath(prefix, key){
    const text = String(key);
    const segment = NEEDS_BRACKET.test(text) ? '["' + text.replace(/([\\"])/g, "\\$1") + '"]' : text;
    if (!prefix) return segment;
    return segment.charAt(0) === "[" ? prefix + segment : prefix + "." + segment;
  }

  function parsePath(path){
    const text = String(path == null ? "" : path);
    const segments = [];
    let buffer = "", i = 0;
    const flush = () => { if (buffer){ segments.push({ key:buffer }); buffer = ""; } };
    while (i < text.length){
      const ch = text.charAt(i);
      if (ch === "."){ flush(); i++; continue; }
      if (ch === "["){
        flush(); i++;
        if (text.charAt(i) === '"'){
          i++;
          let key = "";
          while (i < text.length && text.charAt(i) !== '"'){
            if (text.charAt(i) === "\\") i++;
            key += text.charAt(i++);
          }
          i++;                                          // 닫는 따옴표
          if (text.charAt(i) === "]") i++;
          segments.push({ key });
        } else {
          let digits = "";
          while (i < text.length && text.charAt(i) !== "]") digits += text.charAt(i++);
          i++;
          segments.push({ index: parseInt(digits, 10) || 0 });
        }
        continue;
      }
      buffer += ch; i++;
    }
    flush();
    return segments.length ? segments : [{ key:text }];
  }

  function setPath(root, segments, value, loss, sourcePath){
    let node = root;
    for (let i = 0; i < segments.length; i++){
      const segment = segments[i];
      const key = segment.index === undefined ? segment.key : segment.index;
      if (i === segments.length - 1){
        if (owns(node, key)) note(loss, LOSS.PATH_COLLISION, sourcePath || "", canonical(node[key]), canonical(value));
        node[key] = value;
        break;
      }
      const nextIsIndex = segments[i + 1].index !== undefined;
      const current = owns(node, key) ? node[key] : undefined;
      const wrongContainer = current == null || typeof current !== "object"
        || (nextIsIndex ? !Array.isArray(current) : Array.isArray(current));
      if (wrongContainer){
        if (owns(node, key)) note(loss, LOSS.PATH_COLLISION, sourcePath || "", canonical(current), nextIsIndex ? "배열" : "객체");
        node[key] = nextIsIndex ? [] : safeObject();
      }
      node = node[key];
    }
    return root;
  }

  // ── 계층 → 평면 ──────────────────────────────────────
  const joinArray = (items) => items.map(canonical).join(", ");

  // explode: 배열 값을 가진 키들의 조합마다 행을 복제한다(카테시안 곱).
  function explodeRecord(record, loss){
    if (!isPlainObject(record)) return [record];
    const arrayKeys = Object.keys(record).filter(key => Array.isArray(record[key]) && record[key].length);
    if (!arrayKeys.length) return [record];
    let out = [record];
    for (const key of arrayKeys){
      note(loss, LOSS.ARRAY_EXPLODED, key, record[key].length + "개 원소", "행 복제");
      const next = [];
      for (const base of out) for (const item of record[key]) next.push(Object.assign({}, base, { [key]:item }));
      out = next;
    }
    return out;
  }

  function walkRecord(prefix, node, map, mode, loss){
    if (Array.isArray(node)){
      if (mode === "join"){
        const joined = joinArray(node);
        note(loss, LOSS.ARRAY_JOINED, prefix, canonical(node), joined);
        map.set(prefix, cellOf(joined));
        return;
      }
      note(loss, LOSS.NESTED_FLATTENED, prefix, canonical(node), prefix + "[0]…");
      if (!node.length){ map.set(prefix, cellOf("", "")); return; }
      node.forEach((item, index) => walkRecord(prefix + "[" + index + "]", item, map, mode, loss));
      return;
    }
    if (isPlainObject(node)){
      const keys = Object.keys(node);
      if (prefix) note(loss, LOSS.NESTED_FLATTENED, prefix, canonical(node), prefix + ".…");
      if (!keys.length){ map.set(prefix, cellOf("", "")); return; }
      for (const key of keys) walkRecord(joinPath(prefix, key), node[key], map, mode, loss);
      return;
    }
    if (map.has(prefix)) note(loss, LOSS.DUPLICATE_KEY, prefix, canonical(map.get(prefix).v), canonical(node));
    map.set(prefix, cellOf(node));
  }

  /* Value → Table. opts.flatten 은 "path"(기본, 왕복 가능) · "join" · "explode".
     기본값이 왕복 가능한 "path" 인 것이 중요하다 — 되돌릴 수 있어야 사용자가 안심하고 쓴다. */
  function flatten(value, opts){
    const options = opts || {};
    const mode = options.flatten || "path";
    const loss = [];
    const rootObject = !Array.isArray(value);
    const records = Array.isArray(value) ? value : [value];

    if (!records.length) return { table:{ header:true, columns:[], rows:[], rootObject }, loss };

    // 중첩 배열은 이미 격자다 — 헤더 없이 그대로 눕힌다.
    if (records.every(Array.isArray)){
      const rows = records.map(row => row.map(item => cellOf(
        (isPlainObject(item) || Array.isArray(item)) ? canonical(item) : item
      )));
      return { table:{ header:false, columns:[], rows, rootObject:false }, loss };
    }

    // 스칼라만 있는 배열은 단일 컬럼으로 담는다.
    if (records.every(item => !isPlainObject(item) && !Array.isArray(item))){
      note(loss, LOSS.SCALAR_WRAPPED, "", "값 " + records.length + "개", "value 컬럼");
      return {
        table:{ header:true, columns:["value"], rows:records.map(item => [cellOf(item)]), rootObject },
        loss
      };
    }

    if (rootObject) note(loss, LOSS.ROOT_WRAPPED, "", "객체", "1행 표");

    const expanded = mode === "explode" ? records.reduce((all, record) => all.concat(explodeRecord(record, loss)), []) : records;
    const columns = [];
    const seen = new Set();
    const maps = expanded.map(record => {
      const map = new Map();
      walkRecord("", isPlainObject(record) ? record : { value:record }, map, mode, loss);
      for (const key of map.keys()) if (!seen.has(key)){ seen.add(key); columns.push(key); }
      return map;
    });
    const rows = maps.map(map => columns.map(column => (map.has(column) ? map.get(column) : MISSING())));
    return { table:{ header:true, columns, rows, rootObject }, loss };
  }

  /* Table → Value. 컬럼 이름을 경로로 파싱해 트리를 되세운다.

     빈 칸을 어떻게 볼지가 이 함수의 유일한 재량이다(opts.emptyAs).
       "omit"(기본) — 키를 아예 만들지 않는다. 경로 평탄화의 왕복이 정확히 맞아떨어진다.
       "string"     — 빈 문자열로 둔다. 원본이 진짜 빈 문자열이었을 때를 살린다.
       "null"       — null 로 둔다.
     기본이 "omit" 인 이유는, 행마다 길이가 다른 데이터에서 빈 칸을 값으로 채우면
     원본에 없던 키·배열 원소가 생겨 되돌린 결과가 원본과 달라지기 때문이다.
     어느 쪽을 골라도 "빈 칸은 원래 무엇이었는지 알 수 없다"는 사실 자체는 남으므로,
     표로 내보낼 때 null-ambiguous 로 이미 알린다. */
  function unflatten(table, opts){
    const options = opts || {};
    const emptyAs = options.emptyAs || "omit";
    const loss = [];
    if (!table || !Array.isArray(table.rows)) return { value:[], loss };
    if (!table.header) return { value: table.rows.map(row => row.map(cell => cell.v)), loss };
    const paths = (table.columns || []).map(parsePath);
    const value = table.rows.map((row, rowIndex) => {
      const record = safeObject();
      paths.forEach((segments, index) => {
        const cell = row[index];
        if (!cell || cell.v === undefined) return;      // 그 행에 없던 키는 만들지 않는다
        const empty = cell.v === "" && cell.raw === "";
        const column = (table.columns || [])[index] || String(index);
        const rowPath = column + " · " + (rowIndex + 1) + "행";
        if (empty && emptyAs === "omit"){
          note(loss, LOSS.NULL_AMBIGUOUS, rowPath, "(빈 칸)", "(키 없음)");
          return;
        }
        if (!empty && typeof cell.v === "number" && cell.raw !== canonical(cell.v)){
          note(loss, LOSS.NUMBER_REFORMATTED, rowPath, cell.raw, canonical(cell.v));
        }
        setPath(record, segments, empty && emptyAs === "null" ? null : cell.v, loss, rowPath);
      });
      return record;
    });
    return { value, loss };
  }

  // ── 구분자 포맷(CSV·TSV) ─────────────────────────────
  function parseDelimited(text, delimiter){
    const source = stripBom(text);
    const rows = [];
    let row = [], field = "", quoted = false, i = 0;
    while (i < source.length){
      const ch = source.charAt(i);
      if (quoted){
        if (ch === '"'){
          if (source.charAt(i + 1) === '"'){ field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === ""){ quoted = true; i++; continue; }
      if (ch === delimiter){ row.push(field); field = ""; i++; continue; }
      if (ch === "\r"){ i++; continue; }
      if (ch === "\n"){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || row.length){ row.push(field); rows.push(row); }
    return rows;
  }

  // RFC 4180: 구분자·따옴표·줄바꿈이 든 칸만 인용하고, 안의 따옴표는 두 번 쓴다.
  function delimitedCell(text, delimiter){
    const value = String(text == null ? "" : text);
    const risky = value.indexOf(delimiter) >= 0 || /["\r\n]/.test(value);
    return risky ? '"' + value.replace(/"/g, '""') + '"' : value;
  }

  const DATE_LIKE = /^\d{1,2}[-/]\d{1,2}$/;             // 엑셀이 날짜로 삼켜 버리는 대표 형태

  function rawForCell(cell, loss, path, flatText){
    if (!cell || cell.v === undefined || cell.v === null){
      note(loss, LOSS.NULL_AMBIGUOUS, path, cell && cell.v === null ? "null" : "(없는 키)", "(빈 칸)");
      return "";
    }
    let text = cell.raw;
    if (DATE_LIKE.test(text)) note(loss, LOSS.DATE_COERCED, path, text, "날짜");
    if (flatText && /[\t\r\n]/.test(text)){
      note(loss, LOSS.TEXT_FLATTENED, path, text, text.replace(/[\t\r\n]+/g, " "));
      text = text.replace(/[\t\r\n]+/g, " ");
    }
    return text;
  }

  function tableToDelimited(table, delimiter, loss){
    const flatText = delimiter === "\t";                // TSV 는 칸 안 줄바꿈을 담을 수 없다
    const lines = [];
    const columns = table.columns || [];
    if (table.header) lines.push(columns.map(column => delimitedCell(column, delimiter)).join(delimiter));
    for (const row of table.rows){
      lines.push(row.map((cell, index) =>
        delimitedCell(rawForCell(cell, loss, columns[index] || String(index), flatText), delimiter)
      ).join(delimiter));
    }
    return lines.join("\r\n");
  }

  function tableFromRows(grid, opts, loss){
    const options = opts || {};
    const infer = options.inferTypes !== false;
    const rows = grid.filter(Array.isArray).map(row => row.slice());
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    for (const row of rows) while (row.length < width) row.push("");
    if (!rows.length) return { header:options.header !== false, columns:[], rows:[], rootObject:false };
    if (options.header === false){
      return { header:false, columns:[], rows:rows.map(row => row.map(cell => inferCell(cell, infer))), rootObject:false };
    }
    const seen = new Set();
    const columns = rows[0].map((name, index) => {
      let column = String(name === "" ? "열" + (index + 1) : name);
      if (seen.has(column)){
        note(loss, LOSS.DUPLICATE_KEY, column, column, column + "_" + (index + 1));
        column = column + "_" + (index + 1);
      }
      seen.add(column);
      return column;
    });
    return { header:true, columns, rows:rows.slice(1).map(row => row.map(cell => inferCell(cell, infer))), rootObject:false };
  }

  // ── 마크다운 표 ──────────────────────────────────────
  const mdEscape = (text) => String(text == null ? "" : text).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const mdUnescape = (text) => String(text == null ? "" : text).replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");

  function tableToMarkdown(table, loss){
    const width = Math.max((table.columns || []).length, table.rows.reduce((max, row) => Math.max(max, row.length), 0));
    if (!width) return "";
    let columns = table.columns || [];
    if (!table.header || !columns.length){
      note(loss, LOSS.HEADER_SYNTHESIZED, "", "헤더 없음", "열1…열" + width);
      columns = Array.from({ length:width }, (_, index) => "열" + (index + 1));
    }
    const line = (cells) => "| " + cells.join(" | ") + " |";
    const out = [
      line(columns.map(mdEscape)),
      line(columns.map(() => "---"))
    ];
    for (const row of table.rows){                      // 헤더 행은 파싱 때 이미 분리돼 rows 에 없다
      out.push(line(columns.map((column, index) =>
        mdEscape(rawForCell(row[index], loss, column, false))
      )));
    }
    return out.join("\n");
  }

  function parseMarkdownTable(text){
    const lines = String(text == null ? "" : text).split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.indexOf("|") >= 0);
    const isSeparator = (line) => /^\|?[\s:|-]+\|?$/.test(line) && line.indexOf("-") >= 0;
    const splitRow = (line) => {
      const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
      return trimmed.split(/(?<!\\)\|/).map(cell => mdUnescape(cell.trim()));
    };
    return lines.filter(line => !isSeparator(line)).map(splitRow);
  }

  // ── YAML ────────────────────────────────────────────
  /* YAML 만은 자체 구현을 하지 않는다. 앵커·블록 스칼라·들여쓰기 규칙까지 직접 짜면
     조용히 틀리는 파서가 되기 쉽고, 그건 손실 리포트로도 잡히지 않는 종류의 오류다.
     대신 검증된 js-yaml(MIT)을 쓰되, 이 모듈이 라이브러리를 "찾아 나서지" 않게 한다 —
     밖에서 넣어 주거나(setYaml) 전역에 이미 있을 때만 쓴다. 그래야 순수 모듈로 남고,
     브라우저에서는 MNLazy 가 필요한 순간에만 39KB 를 싣는 구조가 유지된다. */
  let injectedYaml = null;
  const setYaml = (lib) => { injectedYaml = (lib && typeof lib.load === "function") ? lib : null; };

  function yamlLib(){
    if (injectedYaml) return injectedYaml;
    if (typeof jsyaml !== "undefined" && jsyaml && typeof jsyaml.load === "function") return jsyaml;
    if (typeof globalThis !== "undefined" && globalThis.jsyaml && typeof globalThis.jsyaml.load === "function") return globalThis.jsyaml;
    throw new Error("YAML 라이브러리를 아직 불러오지 못했어요.");
  }

  const yamlReady = () => {
    try { yamlLib(); return true; } catch(_){ return false; }
  };

  function yamlToValue(text){
    const docs = yamlLib().loadAll(stripBom(text));
    if (!docs.length) return { value:null, multi:false };
    // 여러 문서(--- 로 나뉜)는 배열로 합친다 — 표로 옮길 때 그게 자연스럽고, 되돌릴 때도 --- 로 갈린다.
    return docs.length === 1 ? { value:docs[0], multi:false } : { value:docs, multi:true };
  }

  const valueToYaml = (value) => yamlLib().dump(value, { indent:2, lineWidth:-1, noRefs:true, sortKeys:false });

  // YAML 주석은 값 IR에 들어가지 않으므로 따로 찾는다. 따옴표와 블록 스칼라 안의 #은 글자다.
  function yamlHasComment(source){
    const lines = stripBom(source).split(/\r?\n/);
    let blockBase = null;
    for (const line of lines){
      const indent = (line.match(/^\s*/) || [""])[0].length;
      if (blockBase !== null){
        if (!line.trim() || indent > blockBase) continue;
        blockBase = null;
      }
      let single = false, double = false, escaped = false, commentAt = -1;
      for (let i = 0; i < line.length; i++){
        const ch = line.charAt(i);
        if (double){
          if (escaped){ escaped = false; continue; }
          if (ch === "\\"){ escaped = true; continue; }
          if (ch === '"') double = false;
          continue;
        }
        if (single){
          if (ch === "'" && line.charAt(i + 1) === "'"){ i++; continue; }
          if (ch === "'") single = false;
          continue;
        }
        if (ch === '"'){ double = true; continue; }
        if (ch === "'"){ single = true; continue; }
        if (ch === "#" && (i === 0 || /\s/.test(line.charAt(i - 1)))){ commentAt = i; break; }
      }
      const content = (commentAt >= 0 ? line.slice(0, commentAt) : line).trimEnd();
      if (/(?:^|:\s*|-\s+)[|>](?:[+-]?[1-9]?|[1-9]?[+-]?)\s*$/.test(content)) blockBase = indent;
      if (commentAt >= 0) return true;
    }
    return false;
  }

  // ── 마크업 토크나이저 (XML·HTML 표 공용) ──────────────
  /* 브라우저 내장 DOMParser 대신 직접 읽는다.
     이 모듈의 계약이 "문자열 in / 문자열 out 순수 함수"라서, DOMParser 를 쓰면 node --test 로는
     XML 경로를 검증할 수 없고(브라우저에만 있음) 결국 이 파일 절반만 테스트되는 모듈이 된다.
     대신 다루는 범위를 좁게 못박는다 — 요소·속성·텍스트·CDATA·주석·엔티티까지.
     네임스페이스·DTD·처리 명령은 읽고 버린다(설계 0장 비목표). */
  const ENTITIES = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" " };

  function decodeEntities(text){
    return String(text).replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
      if (body.charAt(0) === "#"){
        const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
        const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
    });
  }

  const encodeText = (text) => String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const encodeAttr = (text) => encodeText(text).replace(/"/g, "&quot;");

  function readTag(source, start){
    let i = start + 1;
    let name = "";
    while (i < source.length && !/[\s/>]/.test(source.charAt(i))) name += source.charAt(i++);
    const attrs = {};
    let selfClosing = false;
    while (i < source.length){
      while (i < source.length && /\s/.test(source.charAt(i))) i++;
      const ch = source.charAt(i);
      if (!ch) break;
      if (ch === ">"){ i++; break; }
      if (ch === "/"){ selfClosing = true; i++; continue; }
      let key = "";
      while (i < source.length && !/[\s=/>]/.test(source.charAt(i))) key += source.charAt(i++);
      while (i < source.length && /\s/.test(source.charAt(i))) i++;
      let value = key;
      if (source.charAt(i) === "="){
        i++;
        while (i < source.length && /\s/.test(source.charAt(i))) i++;
        const quote = source.charAt(i);
        if (quote === '"' || quote === "'"){
          i++;
          const end = source.indexOf(quote, i);
          value = source.slice(i, end < 0 ? source.length : end);
          i = end < 0 ? source.length : end + 1;
        } else {
          value = "";
          while (i < source.length && !/[\s>]/.test(source.charAt(i))) value += source.charAt(i++);
        }
      }
      if (key) assignOwn(attrs, key, decodeEntities(value));
    }
    return { name, attrs, selfClosing, end:i };
  }

  /* HTML 은 </td> 를 생략해도 되므로, 다음 칸이 열리면 앞 칸을 닫아 준다.
     값은 "이 태그가 열릴 때 닫아야 하는 태그" 목록이다. 스택을 위에서 아래로 훑어
     처음 만나는 것까지 잘라내므로, td 목록에 tr 을 넣으면 부모 행까지 닫혀 버린다. */
  const HTML_AUTO_CLOSE = {
    td:["td", "th"], th:["td", "th"], tr:["tr"],
    thead:["thead", "tbody", "tfoot"], tbody:["thead", "tbody", "tfoot"], tfoot:["thead", "tbody", "tfoot"]
  };
  const HTML_VOID = { br:1, img:1, hr:1, input:1, meta:1, link:1, col:1 };

  function parseMarkup(source, opts){
    const options = opts || {};
    const html = !!options.html;
    const text = String(source);
    const root = { name:"#root", attrs:{}, children:[] };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    const addText = (value) => { if (value) top().children.push(value); };
    let comments = 0;
    let i = 0;
    while (i < text.length){
      const lt = text.indexOf("<", i);
      if (lt < 0){ addText(decodeEntities(text.slice(i))); break; }
      if (lt > i) addText(decodeEntities(text.slice(i, lt)));
      if (text.startsWith("<!--", lt)){
        const end = text.indexOf("-->", lt);
        comments++;
        i = end < 0 ? text.length : end + 3;
        continue;
      }
      if (text.startsWith("<![CDATA[", lt)){
        const end = text.indexOf("]]>", lt);
        addText(text.slice(lt + 9, end < 0 ? text.length : end));
        i = end < 0 ? text.length : end + 3;
        continue;
      }
      if (text.startsWith("<?", lt) || text.startsWith("<!", lt)){
        const end = text.indexOf(">", lt);
        i = end < 0 ? text.length : end + 1;
        continue;
      }
      if (text.charAt(lt + 1) === "/"){
        const end = text.indexOf(">", lt);
        const raw = text.slice(lt + 2, end < 0 ? text.length : end).trim();
        const name = html ? raw.toLowerCase() : raw;
        if (!html){
          if (stack.length <= 1 || top().name !== name) throw new Error("XML 닫는 태그가 맞지 않아요: </" + name + ">");
          stack.pop();
        } else {
          for (let depth = stack.length - 1; depth >= 1; depth--){
            if (stack[depth].name === name){ stack.length = depth; break; }
          }
        }
        i = end < 0 ? text.length : end + 1;
        continue;
      }
      const tag = readTag(text, lt);
      const name = html ? tag.name.toLowerCase() : tag.name;
      if (!name) throw new Error(html ? "HTML 태그 이름이 비어 있어요." : "XML 태그 이름이 비어 있어요.");
      if (html){
        const closes = HTML_AUTO_CLOSE[name];
        if (closes){
          for (let depth = stack.length - 1; depth >= 1; depth--){
            if (closes.indexOf(stack[depth].name) >= 0){ stack.length = depth; break; }
          }
        }
      }
      const node = { name, attrs:tag.attrs, children:[] };
      top().children.push(node);
      if (!tag.selfClosing && !(html && HTML_VOID[name])) stack.push(node);
      i = tag.end;
    }
    if (!html && stack.length > 1) throw new Error("XML 태그가 닫히지 않았어요: <" + top().name + ">");
    return { root, comments };
  }

  const elementsOf = (node) => node.children.filter(child => typeof child !== "string");
  const textOf = (node) => node.children.filter(child => typeof child === "string").join("");

  // 칸 안의 태그는 글자만 남긴다. <br> 만 줄바꿈으로 살린다.
  function deepText(node){
    let out = "";
    for (const child of node.children){
      if (typeof child === "string"){ out += child; continue; }
      if (child.name === "br"){ out += "\n"; continue; }
      out += deepText(child);
    }
    return out;
  }

  // ── XML ─────────────────────────────────────────────
  // 규약: 속성은 "@이름", 섞여 있는 글자는 "#text". 접두사를 붙여 두면 자식 요소와 겹치지 않아
  // XML → JSON → XML 왕복에서 속성이 그대로 살아난다(그래서 속성 자체는 손실 항목이 아니다).
  function xmlNodeToValue(node, infer, loss, path){
    const elements = elementsOf(node);
    const text = textOf(node).trim();
    const attrKeys = Object.keys(node.attrs);
    if (!elements.length){
      if (!attrKeys.length) return inferCell(text, infer).v;
      const out = safeObject();
      for (const key of attrKeys) out["@" + key] = inferCell(node.attrs[key], infer).v;
      if (text) out["#text"] = inferCell(text, infer).v;
      return out;
    }
    const out = safeObject();
    if (text) note(loss, LOSS.MIXED_CONTENT, path || node.name, "글자와 자식 요소가 섞임", "글자를 앞으로 모음");
    for (const key of attrKeys) out["@" + key] = inferCell(node.attrs[key], infer).v;
    if (text) out["#text"] = text;
    const groups = new Map();
    for (const child of elements){
      if (!groups.has(child.name)) groups.set(child.name, []);
      groups.get(child.name).push(child);
    }
    for (const [name, items] of groups){
      const childPath = joinPath(path || "", name);
      const values = items.map(item => xmlNodeToValue(item, infer, loss, childPath));
      out[name] = values.length > 1 ? values : values[0];
    }
    return out;
  }

  /* 문서 전체 → Value.
     <직원들><직원>…</직원><직원>…</직원></직원들> 처럼 같은 이름의 자식이 2개 이상이면
     그 목록을 곧바로 배열로 꺼낸다(안 그러면 표로 바꿀 때 1행짜리 거대한 표가 된다).
     자식이 하나뿐이면 배열인지 값 하나인지 알 수 없으므로 꺼내지 않고 그 사실만 알린다. */
  function xmlToValue(text, opts, loss){
    const options = opts || {};
    const infer = options.inferTypes !== false;
    const parsed = parseMarkup(text, { html:false });
    if (parsed.comments) note(loss, LOSS.COMMENT_DROPPED, "", parsed.comments + "개 주석", "");
    const roots = elementsOf(parsed.root);
    if (!roots.length) return { value:null, meta:{} };
    if (roots.length !== 1) throw new Error("XML 문서에는 바깥 요소가 하나만 있어야 해요.");
    const outsideText = parsed.root.children.filter(child => typeof child === "string").join("").trim();
    if (outsideText) throw new Error("XML 바깥 요소 밖에 글자가 있어요.");
    const doc = roots[0];
    const kids = elementsOf(doc);
    const names = new Set(kids.map(kid => kid.name));
    if (kids.length >= 2 && names.size === 1 && !Object.keys(doc.attrs).length){
      return {
        value: kids.map((kid, index) => xmlNodeToValue(kid, infer, loss, kid.name + "[" + index + "]")),
        meta: { xmlRoot:doc.name, xmlItem:kids[0].name }
      };
    }
    if (kids.length === 1 && !Object.keys(doc.attrs).length){
      note(loss, LOSS.SINGLE_ELEMENT_ARRAY, kids[0].name, "<" + kids[0].name + "> 1개", "배열/단일 값 구분 불가");
    }
    return { value: xmlNodeToValue(doc, infer, loss, doc.name), meta:{ xmlRoot:doc.name } };
  }

  const XML_NAME_BAD = /[^A-Za-z0-9_.\-À-￿]/g;

  function xmlName(raw, loss){
    const text = String(raw == null ? "" : raw);
    let name = text.replace(XML_NAME_BAD, "_");
    if (!name || /^[\d.\-]/.test(name)) name = "_" + name;
    if (name !== text) note(loss, LOSS.NAME_SANITIZED, text, text, name);
    return name;
  }

  function valueToXml(value, opts, loss, meta){
    const options = opts || {};
    const info = meta || {};
    const rootName = xmlName(options.xmlRoot || info.xmlRoot || "rows", loss);
    const itemName = xmlName(options.xmlItem || info.xmlItem || "row", loss);
    const lines = [];
    const pad = (depth) => "  ".repeat(depth);

    function write(name, node, depth){
      if (Array.isArray(node)){
        for (const item of node) write(name, item, depth);
        return;
      }
      if (isPlainObject(node)){
        const keys = Object.keys(node);
        const attrs = keys.filter(key => key.charAt(0) === "@");
        const children = keys.filter(key => key.charAt(0) !== "@" && key !== "#text");
        const head = name + attrs.map(key => " " + xmlName(key.slice(1), loss) + '="' + encodeAttr(canonical(node[key])) + '"').join("");
        const text = node["#text"];
        if (!children.length){
          if (text == null || text === ""){ lines.push(pad(depth) + "<" + head + "/>"); return; }
          lines.push(pad(depth) + "<" + head + ">" + encodeText(canonical(text)) + "</" + name + ">");
          return;
        }
        lines.push(pad(depth) + "<" + head + ">");
        if (text != null && text !== "") lines.push(pad(depth + 1) + encodeText(canonical(text)));
        for (const key of children) write(xmlName(key, loss), node[key], depth + 1);
        lines.push(pad(depth) + "</" + name + ">");
        return;
      }
      if (node == null){
        note(loss, LOSS.NULL_AMBIGUOUS, name, "null", "<" + name + "/>");
        lines.push(pad(depth) + "<" + name + "/>");
        return;
      }
      lines.push(pad(depth) + "<" + name + ">" + encodeText(canonical(node)) + "</" + name + ">");
    }

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    if (Array.isArray(value)){
      if (value.length === 1){
        note(loss, LOSS.SINGLE_ELEMENT_ARRAY, "", "원소 1개짜리 배열", "<" + rootName + "><" + itemName + ">");
      }
      lines.push("<" + rootName + ">");
      for (const item of value) write(itemName, item, 1);
      lines.push("</" + rootName + ">");
    } else {
      write(rootName, value, 0);
    }
    return lines.join("\n");
  }

  // ── HTML 표 ─────────────────────────────────────────
  function htmlToGrid(text, loss){
    const parsed = parseMarkup(text, { html:true });
    if (parsed.comments) note(loss, LOSS.COMMENT_DROPPED, "", parsed.comments + "개 주석", "");
    let table = null;
    (function find(node){
      if (table) return;
      for (const child of node.children){
        if (typeof child === "string") continue;
        if (child.name === "table"){ table = child; return; }
        find(child);
        if (table) return;
      }
    })(parsed.root);
    if (!table) return { grid:[], headerRow:false };

    const rows = [];
    let headerRow = false;
    let markup = 0;
    (function walk(node){
      for (const child of node.children){
        if (typeof child === "string") continue;
        if (child.name === "tr"){
          const cells = [];
          let allHeader = true;
          for (const cell of elementsOf(child)){
            if (cell.name !== "td" && cell.name !== "th") continue;
            if (cell.name !== "th") allHeader = false;
            if (cell.attrs.colspan || cell.attrs.rowspan){
              note(loss, LOSS.MERGED_CELLS, "", (cell.attrs.colspan || "1") + "×" + (cell.attrs.rowspan || "1"), "한 칸");
            }
            if (elementsOf(cell).some(inner => inner.name !== "br")) markup++;
            cells.push(deepText(cell).trim());
          }
          if (cells.length){
            if (!rows.length && allHeader) headerRow = true;
            rows.push(cells);
          }
          continue;
        }
        walk(child);
      }
    })(table);
    if (markup) note(loss, LOSS.MARKUP_DROPPED, "", markup + "개 칸", "글자만 남김");
    return { grid:rows, headerRow };
  }

  function tableToHtml(table, loss){
    const lines = ["<table>"];
    const columns = table.columns || [];
    if (table.header && columns.length){
      lines.push("  <thead>");
      lines.push("    <tr>" + columns.map(column => "<th>" + encodeText(column) + "</th>").join("") + "</tr>");
      lines.push("  </thead>");
    }
    lines.push("  <tbody>");
    for (const row of table.rows){
      const cells = row.map((cell, index) => {
        const raw = rawForCell(cell, loss, columns[index] || String(index), false);
        return "<td>" + encodeText(raw).replace(/\r?\n/g, "<br>") + "</td>";
      });
      lines.push("    <tr>" + cells.join("") + "</tr>");
    }
    lines.push("  </tbody>", "</table>");
    return lines.join("\n");
  }

  // ── 포맷 판별 ────────────────────────────────────────
  function detectFormat(text, name){
    const ext = String(name == null ? "" : name).toLowerCase().split(".").pop();
    for (const key of Object.keys(FORMATS)) if (FORMATS[key].ext.indexOf(ext) >= 0) return key;
    const body = stripBom(text).trim();
    if (!body) return "json";
    if (body.charAt(0) === "{" || body.charAt(0) === "["){
      // 줄마다 독립 JSON 이면 JSONL 이다.
      const lines = body.split(/\r?\n/).filter(line => line.trim());
      if (lines.length > 1 && lines.every(line => /^[{[]/.test(line.trim()) && /[}\]]$/.test(line.trim()))){
        try { JSON.parse(body); return "json"; } catch(_){ return "jsonl"; }
      }
      return "json";
    }
    if (body.charAt(0) === "<") return /<table[\s>]/i.test(body) ? "html" : "xml";
    // YAML 은 내용만으로 확실히 가려내기 어렵다("메모: 오늘 할 일" 같은 평범한 글도 문법상 YAML 이다).
    // 확장자와 문서 구분선(---)만 믿고, 나머지는 표 계열로 넘긴다 — 틀린 추측이 조용히 성공하는 것보다
    // 눈에 띄게 어긋나 보이는 편이 사용자가 형식을 직접 고르기 쉽다.
    if (/^---\s*(\r?\n|$)/.test(body)) return "yaml";
    if (/^\|/m.test(body) && /^\|?[\s:|-]*-[\s:|-]*\|?$/m.test(body)) return "md";
    if (body.indexOf("\t") >= 0 && body.indexOf(",") < 0) return "tsv";
    return "csv";
  }

  // ── parse / serialize ────────────────────────────────
  function parse(text, format, opts){
    const options = opts || {};
    const fmt = FORMATS[format] ? format : detectFormat(text, options.name);
    const loss = [];
    if (fmt === "json"){
      return { format:fmt, value:JSON.parse(stripBom(text) || "null"), table:null, loss, meta:{} };
    }
    if (fmt === "jsonl"){
      const value = stripBom(text).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
      return { format:fmt, value, table:null, loss, meta:{} };
    }
    if (fmt === "yaml"){
      const out = yamlToValue(text);
      // 주석은 js-yaml 도 값에 담지 않는다 — 원문에 있었다면 사라지므로 미리 알린다.
      if (yamlHasComment(text)) note(loss, LOSS.COMMENT_DROPPED, "", "YAML 주석", "");
      if (out.multi) note(loss, LOSS.MULTI_DOCUMENT, "", "여러 문서(---)", "배열 1개");
      return { format:fmt, value:out.value, table:null, loss, meta:{} };
    }
    if (fmt === "xml"){
      const out = xmlToValue(text, options, loss);
      return { format:fmt, value:out.value, table:null, loss, meta:out.meta };
    }
    let grid, headerHint = null;
    if (fmt === "md") grid = parseMarkdownTable(text);
    else if (fmt === "html"){
      const out = htmlToGrid(text, loss);
      grid = out.grid;
      headerHint = out.headerRow;                       // <th> 로 적힌 첫 줄이 있으면 그게 헤더다
    }
    else grid = parseDelimited(text, fmt === "tsv" ? "\t" : (options.delimiter || ","));
    const tableOptions = headerHint === null ? options : Object.assign({}, options, { header:headerHint || options.header !== false });
    const table = tableFromRows(grid, tableOptions, loss);
    const rebuilt = unflatten(table, options);
    return { format:fmt, value:rebuilt.value, valueLoss:rebuilt.loss, table, loss, meta:{} };
  }

  function tableOf(ir, opts, loss){
    if (ir.table) return ir.table;
    const built = flatten(ir.value, opts);
    merge(loss, built.loss);
    return built.table;
  }

  function valueOf(ir, opts, loss){
    if (ir.value !== undefined){
      merge(loss, ir.valueLoss);
      return ir.value;
    }
    const built = unflatten(ir.table, opts);
    merge(loss, built.loss);
    return built.value;
  }

  function serialize(ir, format, opts){
    const options = opts || {};
    const fmt = FORMATS[format] ? format : "json";
    const loss = [];
    if (fmt === "json"){
      const indent = options.indent === undefined ? 2 : options.indent;
      return { text:JSON.stringify(valueOf(ir, options, loss), null, indent), loss };
    }
    if (fmt === "jsonl"){
      const value = valueOf(ir, options, loss);
      const items = Array.isArray(value) ? value : [value];
      return { text:items.map(item => JSON.stringify(item)).join("\n"), loss };
    }
    if (fmt === "yaml") return { text:valueToYaml(valueOf(ir, options, loss)), loss };
    if (fmt === "xml") return { text:valueToXml(valueOf(ir, options, loss), options, loss, ir.meta), loss };
    const table = tableOf(ir, options, loss);
    if (fmt === "md") return { text:tableToMarkdown(table, loss), loss };
    if (fmt === "html") return { text:tableToHtml(table, loss), loss };
    const delimiter = fmt === "tsv" ? "\t" : (options.delimiter || ",");
    const body = tableToDelimited(table, delimiter, loss);
    const bom = fmt !== "tsv" && options.bom !== false ? "\uFEFF" : "";
    return { text:bom + body, loss };
  }

  // ── 손실 검사 ────────────────────────────────────────
  // 변환 결과를 다시 읽어 원본과 비교한다. 손실 규칙표를 손으로 관리하지 않아도 되는 게 장점이다.
  function scanNumbers(value, path, loss){
    if (Array.isArray(value)){ value.forEach((item, index) => scanNumbers(item, path + "[" + index + "]", loss)); return; }
    if (isPlainObject(value)){ for (const key of Object.keys(value)) scanNumbers(value[key], joinPath(path, key), loss); return; }
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER){
      note(loss, LOSS.PRECISION, path, String(value), String(value));
    }
  }

  function compareCell(before, after, path, loss){
    const hadValue = before && before.v !== undefined && before.v !== null;
    const hasValue = after && after.v !== undefined && after.v !== null;
    if (!hadValue && !hasValue) return;
    if (!hadValue || !hasValue){
      note(loss, LOSS.NULL_AMBIGUOUS, path, before ? canonical(before.v) : "", after ? canonical(after.v) : "");
      return;
    }
    if (typeof before.v !== typeof after.v){
      note(loss, LOSS.TYPE_LOST, path, typeof before.v + " " + canonical(before.v), typeof after.v + " " + canonical(after.v));
      return;
    }
    if (before.raw !== after.raw){
      const code = /^-?0\d/.test(before.raw) ? LOSS.LEADING_ZERO
        : (typeof before.v === "number" ? LOSS.NUMBER_REFORMATTED : LOSS.TYPE_LOST);
      note(loss, code, path, before.raw, after.raw);
      return;
    }
    if (before.v !== after.v) note(loss, LOSS.TYPE_LOST, path, canonical(before.v), canonical(after.v));
  }

  function diffTables(before, after, loss){
    if (!before || !after) return;
    const beforeColumns = (before.columns || []).join("\u0000");
    const afterColumns = (after.columns || []).join("\u0000");
    if (beforeColumns !== afterColumns){
      note(loss, LOSS.COLUMNS_CHANGED, "", (before.columns || []).join(", "), (after.columns || []).join(", "));
    }
    const rows = Math.max(before.rows.length, after.rows.length);
    for (let r = 0; r < rows; r++){
      const beforeRow = before.rows[r] || [], afterRow = after.rows[r] || [];
      const width = Math.max(beforeRow.length, afterRow.length);
      for (let c = 0; c < width; c++){
        const column = (before.columns || [])[c] || String(c);
        compareCell(beforeRow[c], afterRow[c], column + " · " + (r + 1) + "행", loss);
      }
    }
  }

  function diffValues(before, after, path, loss){
    if (Array.isArray(before) || Array.isArray(after)){
      const a = Array.isArray(before) ? before : [], b = Array.isArray(after) ? after : [];
      if (!Array.isArray(before) || !Array.isArray(after)){
        note(loss, LOSS.TYPE_LOST, path, canonical(before), canonical(after));
        return;
      }
      for (let i = 0; i < Math.max(a.length, b.length); i++) diffValues(a[i], b[i], path + "[" + i + "]", loss);
      return;
    }
    if (isPlainObject(before) || isPlainObject(after)){
      if (!isPlainObject(before) || !isPlainObject(after)){
        note(loss, LOSS.TYPE_LOST, path, canonical(before), canonical(after));
        return;
      }
      const keys = new Set(Object.keys(before).concat(Object.keys(after)));
      for (const key of keys) diffValues(before[key], after[key], joinPath(path, key), loss);
      return;
    }
    compareCell(cellOf(before), cellOf(after), path || "(루트)", loss);
  }

  /* 변환 한 번의 전부: 텍스트 in, 텍스트 + 손실 리포트 out. */
  function convert(text, opts){
    const options = opts || {};
    const from = FORMATS[options.from] ? options.from : detectFormat(text, options.name);
    const to = FORMATS[options.to] ? options.to : "json";
    const loss = [];
    const parsed = parse(text, from, options);
    merge(loss, parsed.loss);

    const out = serialize(parsed, to, options);
    merge(loss, out.loss);

    scanNumbers(parsed.value, "", loss);

    try {
      const back = parse(out.text, to, options);
      if (FORMATS[to].shape === "table") diffTables(tableOf(parsed, options, []), back.table, loss);
      else diffValues(parsed.value, back.value, "", loss);
    } catch(error){
      note(loss, LOSS.ROUNDTRIP_FAILED, "", "", String((error && error.message) || error));
    }

    return { text:out.text, from, to, value:parsed.value, table:parsed.table, loss };
  }

  // MNTableExport 의 표 블록({ rows:[["셀",…],…], header })과 오가는 다리.
  const fromRows = (rows, header, opts) => tableFromRows(rows || [], Object.assign({ header:header !== false }, opts || {}), []);
  const toRows = (table) => {
    if (!table) return [];
    const body = table.rows.map(row => row.map(cell => (cell && cell.v !== undefined && cell.v !== null) ? cell.raw : ""));
    return table.header ? [ (table.columns || []).slice() ].concat(body) : body;
  };

  return {
    LOSS, HINT, FORMATS,
    detectFormat, parse, serialize, convert,
    flatten, unflatten, fromRows, toRows,
    joinPath, parsePath, inferCell, parseMarkup, decodeEntities,
    setYaml, yamlReady
  };
})();

if (typeof module !== "undefined" && module.exports){
  module.exports = MNDataConvert;
}
