"use strict";

/* MySQL 클라이언트 — .dbconn 접속 문서.
 *
 * 접속 정보를 파일 하나(.dbconn)로 두고 SQLite 뷰어처럼 콘텐츠 영역 전체에 연다.
 * 탭·작업공간·백업·최근 파일이 전부 기존 문서 구조를 그대로 따라온다.
 *
 * 비밀번호는 이 파일에도, localStorage 에도, 앱 상태에도 저장하지 않는다.
 * 연결할 때 입력한 값이 런처의 /db-session-open 본문으로 한 번 건너갈 뿐이다.
 *
 * 쿼리는 시작만 시키고 결과는 폴링으로 받는다(pip 설치와 같은 규약).
 * 60초짜리 fetch 에 화면이 매달리지 않고, 실행 중에도 취소를 보낼 수 있다.
 */
const MNDbClient = (() => {
  const encoder = new TextEncoder();
  const POLL_MS = 300;
  const DEFAULT_TIMEOUT = 60;

  // 런처의 ReadBundleString 과 짝을 이루는 길이 접두 인코딩. 비밀번호를 URL 이 아닌
  // 본문으로 보내기 위해 원격 터미널과 같은 형식을 쓴다.
  const encodeStrings = (values) => {
    const chunks = [];
    let size = 0;
    values.forEach((value) => {
      const bytes = encoder.encode(String(value == null ? "" : value));
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, bytes.length, true);
      chunks.push(head, bytes);
      size += head.length + bytes.length;
    });
    const result = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => { result.set(chunk, offset); offset += chunk.length; });
    return result;
  };

  const isExe = () => (location.protocol === "http:" || location.protocol === "https:")
    && (location.hostname === "127.0.0.1" || location.hostname === "localhost");

  const jsonOf = async (response) => {
    if (!response.ok) throw new Error((await response.text()) || ("HTTP " + response.status));
    return response.json();
  };

  // 워커가 분류한 코드를 화면 문구로 옮긴다. 드라이버 예외 문자열을 그대로 띄우지 않는
  // 이유는 접속 정보가 섞여 나오는 경우가 있어서다. SQL 오류만은 원문이 곧 학습 정보라 함께 보인다.
  const messageFor = (info) => {
    const code = String((info && info.code) || "");
    const detail = String((info && info.detail) || "");
    switch (code){
      case "driver-missing":    return "MySQL 드라이버(pymysql)가 설치되어 있지 않습니다.";
      case "auth-failed":       return "계정 또는 비밀번호가 맞지 않습니다.";
      case "auth-plugin":       return "이 계정은 ClassDock 이 지원하지 않는 인증 방식을 씁니다(Windows 인증 등). 비밀번호로 로그인하는 MySQL 계정을 써 주세요.";
      case "auth-crypto":       return "이 서버의 인증 방식(caching_sha2_password)에는 cryptography 패키지가 더 필요합니다.";
      case "unknown-host":      return "호스트를 찾지 못했습니다. 주소를 확인해 주세요.";
      case "refused":           return "서버가 연결을 거부했습니다. 포트 번호와 서버 상태를 확인해 주세요.";
      case "timeout":           return "서버가 응답하지 않습니다. 방화벽이나 네트워크를 확인해 주세요.";
      case "unknown-database":  return "그 이름의 데이터베이스가 없습니다.";
      case "denied":            return "이 계정에는 권한이 없습니다.";
      case "connection-lost":   return "서버와의 연결이 끊어졌습니다. 다시 연결해 주세요.";
      case "cancelled":         return "쿼리를 취소했습니다.";
      case "read-only":         return "읽기 전용 접속이라 쓰기 문장을 실행할 수 없습니다.";
      case "read-only-blocked": return "읽기 전용 접속입니다. " + detail + " 문장을 실행하려면 접속을 끊고 '쓰기 허용'을 켜서 다시 연결해 주세요.";
      case "not-connected":     return "접속이 끊어졌습니다. 다시 연결해 주세요.";
      case "tx-pending":        return "커밋하지 않은 변경이 있습니다. 먼저 커밋하거나 롤백해 주세요.";
      case "tx-auto-commit":    return "자동 커밋 상태라 확정할 변경이 없습니다.";
      case "job-not-found":     return "실행 기록을 찾지 못했습니다. 다시 실행해 주세요.";
      case "sql-error":         return detail || "SQL 오류입니다.";
      default:                  return detail || "알 수 없는 오류입니다.";
    }
  };

  // 런처가 문자열로 돌려주는 실패(HTTP 500 본문)를 사람 말로 옮긴다.
  const launcherMessage = (error) => {
    const raw = String((error && error.message) || error || "");
    if (raw.indexOf("no-python") >= 0) return "Python 이 설치되어 있지 않습니다. 데이터베이스 기능은 Python 이 필요합니다.";
    if (raw.indexOf("db-too-many-sessions") >= 0) return "동시에 열 수 있는 접속은 4개까지입니다. 쓰지 않는 접속 문서를 닫아 주세요.";
    if (raw.indexOf("db-session-not-found") >= 0) return "접속이 끊어졌습니다. 다시 연결해 주세요.";
    if (raw.indexOf("db-timeout") >= 0) return "제한 시간 안에 응답이 오지 않아 실행을 중단했습니다.";
    if (raw.indexOf("db-bad-host") >= 0) return "호스트 주소에 쓸 수 없는 문자가 있습니다.";
    if (raw.indexOf("db-bad-port") >= 0) return "포트는 1~65535 사이의 숫자여야 합니다.";
    if (raw.indexOf("db-missing-host") >= 0) return "호스트를 입력해 주세요.";
    if (raw.indexOf("db-missing-user") >= 0) return "계정을 입력해 주세요.";
    if (raw.indexOf("db-empty-sql") >= 0) return "실행할 SQL 을 입력해 주세요.";
    if (raw.indexOf("db-session-stopped") >= 0) return "접속 프로세스가 종료되었습니다. 다시 연결해 주세요.";
    return raw || "요청을 처리하지 못했습니다.";
  };

  /* ── .dbconn 파일 ────────────────────────────────────────────────────────── */

  // 접속마다 고를 수 있는 표시색. 운영 DB 를 빨강으로 두는 식으로 실수 실행을 막는다.
  const COLORS = ["", "red", "amber", "green", "blue", "violet"];
  const COLOR_LABELS = { "":"없음", red:"빨강", amber:"주황", green:"초록", blue:"파랑", violet:"보라" };

  const emptyProfile = () => ({
    classdock:"dbconn", version:1, driver:"mysql",
    host:"127.0.0.1", port:3306, database:"", user:"", readOnly:true, autoCommit:true, color:"", sql:""
  });

  const parseProfile = (text) => {
    const raw = JSON.parse(String(text || "").trim() || "{}");
    const profile = emptyProfile();
    if (raw && typeof raw === "object"){
      if (typeof raw.host === "string") profile.host = raw.host;
      if (Number.isFinite(Number(raw.port))) profile.port = Math.max(1, Math.min(65535, Number(raw.port) | 0));
      if (typeof raw.database === "string") profile.database = raw.database;
      if (typeof raw.user === "string") profile.user = raw.user;
      if (raw.readOnly === false) profile.readOnly = false;
      if (raw.autoCommit === false) profile.autoCommit = false;
      if (COLORS.includes(raw.color)) profile.color = raw.color;
      if (typeof raw.sql === "string") profile.sql = raw.sql;
    }
    return profile;
  };

  // 비밀번호는 어떤 경로로도 이 직렬화에 들어오지 않는다(입력값을 프로필에 담지 않는다).
  const serializeProfile = (profile) => JSON.stringify({
    classdock:"dbconn", version:1, driver:"mysql",
    host:profile.host, port:profile.port, database:profile.database,
    user:profile.user, readOnly:!!profile.readOnly, autoCommit:profile.autoCommit !== false,
    color:profile.color || "", sql:profile.sql || ""
  }, null, 2);

  /* 스키마 패널 너비. 화면 설정이라 .dbconn 파일이 아니라 브라우저에 둔다 —
     파일에 넣으면 접속 정보에 화면 설정이 섞이고, 폭을 만질 때마다 문서가 "저장 안 됨"이 된다.
     앱 사이드바(sbWidth)·원격 터미널 도킹 폭과 같은 기조다. */
  const SIDEBAR_KEY = "classdockDbSidebarV1";
  const SIDEBAR_MIN = 150, SIDEBAR_DEFAULT = 240, SIDEBAR_KEEP_MAIN = 320;

  const readSidebarWidth = () => {
    try {
      const value = Number(localStorage.getItem(SIDEBAR_KEY));
      return Number.isFinite(value) && value >= SIDEBAR_MIN ? value : 0;
    } catch(_){ return 0; }
  };

  const storeSidebarWidth = (width) => {
    try { localStorage.setItem(SIDEBAR_KEY, String(Math.round(width))); } catch(_){}
  };

  const EDITOR_KEY = "classdockDbEditorHeightV1";
  const EDITOR_MIN = 90, EDITOR_DEFAULT = 180, EDITOR_KEEP_RESULT = 240;

  const readEditorHeight = () => {
    try {
      const value = Number(localStorage.getItem(EDITOR_KEY));
      return Number.isFinite(value) && value >= EDITOR_MIN ? value : 0;
    } catch(_){ return 0; }
  };

  const storeEditorHeight = (height) => {
    try { localStorage.setItem(EDITOR_KEY, String(Math.round(height))); } catch(_){}
  };

  /* ── SQL 문장 나누기(확인 창 판단용) ──────────────────────────────────────
     실제 실행 단위는 워커(db_worker.py)가 다시 나눈다. 여기서 나누는 이유는
     되돌릴 수 없는 문장을 보내기 전에 화면에서 먼저 확인받기 위해서다. */

  // 원문에서의 위치(start·end)까지 함께 돌려준다. 커서가 놓인 문장 하나만 실행하려면
  // 잘라 낸 문자열만으로는 부족하고 어디서 어디까지인지를 알아야 한다.
  const statementRanges = (sql) => {
    const text = String(sql || ""), length = text.length;
    const bounds = [];                       // 세미콜론으로 끊은 구간 [시작, 끝) — 세미콜론 자신은 뺀다
    let segmentStart = 0, index = 0;
    while (index < length){
      const char = text[index];
      if (char === "'" || char === '"' || char === "`"){
        const quote = char;
        index++;
        while (index < length){
          const current = text[index];
          if (current === "\\" && quote !== "`"){ index += 2; continue; }
          if (current === quote){
            if (text[index + 1] === quote){ index += 2; continue; }   // '' 나 "" 로 쓴 이스케이프
            index++; break;
          }
          index++;
        }
        continue;
      }
      if (char === "-" && text.startsWith("--", index) && (index + 2 >= length || " \t\r\n".includes(text[index + 2]))){
        const stop = text.indexOf("\n", index);
        index = stop < 0 ? length : stop; continue;
      }
      if (char === "#"){
        const stop = text.indexOf("\n", index);
        index = stop < 0 ? length : stop; continue;
      }
      if (char === "/" && text.startsWith("/*", index)){
        const stop = text.indexOf("*/", index + 2);
        index = stop < 0 ? length : stop + 2; continue;
      }
      if (char === ";"){ bounds.push([segmentStart, index]); segmentStart = index + 1; index++; continue; }
      index++;
    }
    bounds.push([segmentStart, length]);

    const ranges = [];
    bounds.forEach((pair) => {
      const raw = text.slice(pair[0], pair[1]);
      const trimmed = raw.trim();
      if (!trimmed) return;
      // 앞은 전부 공백이므로 trimmed 의 첫 등장 위치가 곧 문장 시작이다.
      const start = pair[0] + raw.indexOf(trimmed);
      ranges.push({ start, end:start + trimmed.length, text:trimmed });
    });
    return ranges;
  };

  const splitStatements = (sql) => statementRanges(sql).map(item => item.text);

  /* 커서가 놓인 문장 하나를 고른다. 문장 안이면 그 문장, 문장 사이의 빈 곳이면 바로 앞 문장,
     첫 문장보다 앞이면 첫 문장. DBeaver·Workbench·DataGrip 이 쓰는 규칙과 같다. */
  const statementAt = (sql, cursor) => {
    const ranges = statementRanges(sql);
    if (!ranges.length) return null;
    const at = Math.max(0, Math.min(Number(cursor) || 0, String(sql || "").length));
    for (const range of ranges) if (at >= range.start && at <= range.end) return range;
    let previous = null;
    for (const range of ranges) if (range.end < at) previous = range;
    return previous || ranges[0];
  };

  // 앞에 붙은 주석과 여는 괄호를 지나 첫 낱말을 읽는다.
  const firstKeyword = (statement) => {
    const text = String(statement || "");
    let index = 0;
    while (index < text.length){
      const char = text[index];
      if (/\s/.test(char) || char === "("){ index++; continue; }
      if (text.startsWith("--", index) || char === "#"){
        const stop = text.indexOf("\n", index);
        if (stop < 0) return "";
        index = stop + 1; continue;
      }
      if (text.startsWith("/*", index)){
        const stop = text.indexOf("*/", index + 2);
        if (stop < 0) return "";
        index = stop + 2; continue;
      }
      break;
    }
    const match = /^[A-Za-z_]+/.exec(text.slice(index));
    return match ? match[0].toLowerCase() : "";
  };

  /* ── ORDER BY 고쳐 쓰기(헤더 클릭 정렬) ──────────────────────────────────
     받아온 행만 다시 늘어놓으면 "전체에서 가장 큰 값"처럼 보이는 거짓말이 된다.
     결과는 1000행에서 잘려 있기 때문이다. 그래서 클라이언트에서 정렬하지 않고
     문장의 ORDER BY 를 고쳐 서버에 다시 묻는다. */

  const ORDER_TAIL = /^(?:limit|procedure|into|for|lock)$/i;

  // 괄호 밖(top level)에서 ORDER BY 가 차지한 구간. 없으면 넣을 자리를 start===end 로 가리킨다.
  const orderBySpot = (sql) => {
    const text = String(sql || ""), length = text.length;
    let index = 0, depth = 0, orderStart = -1, tailStart = -1;
    while (index < length){
      const char = text[index];
      if (char === "'" || char === '"' || char === "`"){
        const quote = char;
        index++;
        while (index < length){
          if (text[index] === "\\" && quote !== "`"){ index += 2; continue; }
          if (text[index] === quote){
            if (text[index + 1] === quote){ index += 2; continue; }
            index++; break;
          }
          index++;
        }
        continue;
      }
      if (char === "-" && text.startsWith("--", index)){
        const stop = text.indexOf("\n", index); index = stop < 0 ? length : stop; continue;
      }
      if (char === "#"){
        const stop = text.indexOf("\n", index); index = stop < 0 ? length : stop; continue;
      }
      if (char === "/" && text.startsWith("/*", index)){
        const stop = text.indexOf("*/", index + 2); index = stop < 0 ? length : stop + 2; continue;
      }
      if (char === "("){ depth++; index++; continue; }
      if (char === ")"){ depth--; index++; continue; }
      const word = /^[A-Za-z_]+/.exec(text.slice(index));
      if (!word){ index++; continue; }
      if (depth === 0){
        const upper = word[0].toUpperCase();
        if (upper === "ORDER" && /^\s+by\b/i.test(text.slice(index + word[0].length))){
          orderStart = index;
          tailStart = -1;                       // UNION 처럼 뒤쪽에 다시 나오면 그쪽이 전체 정렬이다
        } else if (tailStart < 0 && ORDER_TAIL.test(upper)) tailStart = index;
      }
      index += word[0].length;
    }
    const end = tailStart >= 0 ? tailStart : length;
    if (orderStart >= 0) return { start:orderStart, end:Math.max(orderStart, end) };
    return { start:end, end };
  };

  // clause 가 빈 문자열이면 ORDER BY 를 뺀다. LIMIT 등 뒤쪽 절은 자리를 지킨다.
  const applyOrderBy = (sql, clause) => {
    const text = String(sql || "");
    const spot = orderBySpot(text);
    const head = text.slice(0, spot.start).replace(/\s+$/, "");
    const tail = text.slice(spot.end).replace(/^\s+/, "");
    const middle = clause ? "ORDER BY " + clause : "";
    const joiner = /\n/.test(text) ? "\n" : " ";
    return [head, middle, tail].filter(Boolean).join(joiner);
  };

  // 실행된 문장에서 첫 정렬 키를 읽는다. 화살표 표시는 이 값에서만 나오므로 거짓말하지 않는다.
  const orderByState = (sql) => {
    const text = String(sql || "");
    const spot = orderBySpot(text);
    if (spot.start === spot.end) return null;
    const clause = text.slice(spot.start, spot.end).replace(/^order\s+by\s*/i, "").trim();
    const match = /^(?:`((?:[^`]|``)+)`|([A-Za-z_][\w$]*))\s*(asc|desc)?\b/i.exec(clause);
    if (!match) return null;
    return {
      column: (match[1] ? match[1].replace(/``/g, "`") : match[2]),
      direction: (match[3] || "asc").toLowerCase()
    };
  };

  /* 별칭 되돌리기 — `FROM 주문 o` 처럼 붙인 별칭을 테이블 이름으로 옮긴다.
     편집기 위젯의 자동완성이 `o.` 뒤에 그 테이블의 컬럼을 주도록 하는 데 쓴다. */
  const ALIAS_STOPWORDS = /^(?:on|where|set|values|group|order|limit|join|inner|left|right|outer|cross|using|having|select|as|and|or)$/i;
  const aliasMap = (sql) => {
    const map = new Map();
    const pattern = /\b(?:from|join|update|into)\s+`?([A-Za-z_글-힣][\w$글-힣]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][\w$]*)`?)?/gi;
    let match;
    while ((match = pattern.exec(String(sql || "")))){
      map.set(match[1].toLowerCase(), match[1]);
      if (match[2] && !ALIAS_STOPWORDS.test(match[2])) map.set(match[2].toLowerCase(), match[1]);
    }
    return map;
  };

  // 이름을 편집기에 넣을 때 그대로 써도 되는지 본다. 평범한 식별자가 아니면 역따옴표로 감싼다
  // (공백·예약어·한글 이름을 그대로 넣으면 곧바로 문법 오류가 된다).
  const identifierFor = (name) => {
    const text = String(name == null ? "" : name);
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(text) ? text : "`" + text.replace(/`/g, "``") + "`";
  };

  // 구조 편집 SQL 은 평범한 이름도 항상 감싼다. 예약어·공백·한글을 같은 규칙으로 다루고,
  // 데이터베이스와 테이블 이름을 문자열로 이어 붙이는 실수를 피한다.
  const ddlIdentifier = (name) => "`" + String(name == null ? "" : name).replace(/`/g, "``") + "`";
  const ddlString = (value) => "'" + String(value == null ? "" : value)
    .replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";

  const defaultDraft = (value) => {
    if (value == null) return { mode:"none", value:"" };
    const text = String(value);
    if (/^(?:CURRENT_(?:TIMESTAMP|DATE|TIME)|LOCALTIME|LOCALTIMESTAMP|NOW\(\))(?:\(\d+\))?$/i.test(text)
      || /^\([\s\S]*\)$/.test(text)) return { mode:"expression", value:text };
    return { mode:"value", value:text };
  };

  const columnDraft = (column, index) => {
    const source = column || {};
    const def = defaultDraft(source.default);
    const extra = String(source.extra || "");
    const unsupportedExtra = extra
      .replace(/\bauto_increment\b/ig, "")
      .replace(/\bdefault_generated\b/ig, "")
      .replace(/\bon update\s+[^\s]+(?:\(\d+\))?/ig, "")
      .replace(/\b(?:virtual|stored) generated\b/ig, "").trim();
    const draft = {
      id:"column-" + index + "-" + String(source.name || ""),
      originalName:String(source.name || ""), name:String(source.name || ""),
      type:String(source.type || "varchar(255)"), nullable:source.nullable !== false,
      defaultMode:def.mode, defaultValue:def.value,
      autoIncrement:/\bauto_increment\b/i.test(extra),
      extra, unsupportedExtra, comment:String(source.comment || ""), key:String(source.key || ""),
      characterSet:String(source.characterSet || ""), collation:String(source.collation || ""),
      generationExpression:String(source.generationExpression || ""), deleted:false, isNew:false
    };
    draft.original = {
      name:draft.name, type:draft.type, nullable:draft.nullable, defaultMode:draft.defaultMode,
      defaultValue:draft.defaultValue, autoIncrement:draft.autoIncrement, comment:draft.comment
    };
    return draft;
  };

  const comparableColumn = (column) => ({
    name:String(column.name || ""), type:String(column.type || "").trim(), nullable:!!column.nullable,
    defaultMode:String(column.defaultMode || "none"), defaultValue:String(column.defaultValue || ""),
    autoIncrement:!!column.autoIncrement, comment:String(column.comment || "")
  });

  const sameColumn = (column) => !column.isNew && JSON.stringify(comparableColumn(column)) === JSON.stringify(column.original || {});

  const columnDefinitionSql = (column) => {
    let sql = ddlIdentifier(column.name) + " " + String(column.type || "").trim();
    if (column.characterSet) sql += " CHARACTER SET " + ddlIdentifier(column.characterSet);
    if (column.collation) sql += " COLLATE " + ddlIdentifier(column.collation);
    sql += column.nullable ? " NULL" : " NOT NULL";
    if (column.defaultMode === "null") sql += " DEFAULT NULL";
    else if (column.defaultMode === "value") sql += " DEFAULT " + ddlString(column.defaultValue);
    else if (column.defaultMode === "expression") sql += " DEFAULT " + String(column.defaultValue || "").trim();
    if (column.autoIncrement) sql += " AUTO_INCREMENT";
    const onUpdate = String(column.extra || "").match(/\bon update\s+([^\s]+(?:\(\d+\))?)\s*$/i);
    if (onUpdate) sql += " ON UPDATE " + onUpdate[1];
    if (column.comment) sql += " COMMENT " + ddlString(column.comment);
    return sql;
  };

  const indexDraft = (index, position) => {
    const source = index || {};
    const draft = {
      id:"index-" + position + "-" + String(source.name || ""),
      originalName:String(source.name || ""), name:String(source.name || ""),
      unique:source.unique !== false, type:String(source.type || "BTREE").toUpperCase(),
      columns:(source.columns || []).map(column => ({
        name:String(column.name || ""), prefix:column.prefix == null ? "" : String(column.prefix),
        order:String(column.order || "ASC").toUpperCase(), unsupported:!!column.unsupported
      })),
      deleted:false, isNew:false
    };
    draft.original = {
      name:draft.name, unique:draft.unique, type:draft.type,
      columns:draft.columns.map(column => ({ name:column.name, prefix:column.prefix, order:column.order }))
    };
    return draft;
  };

  const comparableIndex = (index) => ({
    name:String(index.name || ""), unique:!!index.unique, type:String(index.type || "BTREE").toUpperCase(),
    columns:(index.columns || []).map(column => ({
      name:String(column.name || ""), prefix:String(column.prefix == null ? "" : column.prefix),
      order:String(column.order || "ASC").toUpperCase()
    }))
  });
  const sameIndex = (index) => !index.isNew
    && JSON.stringify(comparableIndex(index)) === JSON.stringify(index.original || {});

  const foreignKeyDraft = (foreignKey, position) => {
    const source = foreignKey || {};
    const draft = {
      id:"foreign-" + position + "-" + String(source.name || ""),
      originalName:String(source.name || ""), name:String(source.name || ""),
      referencedDatabase:String(source.referencedDatabase || ""), referencedTable:String(source.referencedTable || ""),
      updateRule:String(source.updateRule || "RESTRICT").toUpperCase(),
      deleteRule:String(source.deleteRule || "RESTRICT").toUpperCase(),
      columns:(source.columns || []).map(column => ({ local:String(column.local || ""), referenced:String(column.referenced || "") })),
      deleted:false, isNew:false
    };
    draft.original = {
      name:draft.name, referencedDatabase:draft.referencedDatabase, referencedTable:draft.referencedTable,
      updateRule:draft.updateRule, deleteRule:draft.deleteRule,
      columns:draft.columns.map(column => ({ local:column.local, referenced:column.referenced }))
    };
    return draft;
  };

  const comparableForeignKey = (foreignKey) => ({
    name:String(foreignKey.name || ""), referencedDatabase:String(foreignKey.referencedDatabase || ""),
    referencedTable:String(foreignKey.referencedTable || ""), updateRule:String(foreignKey.updateRule || "RESTRICT").toUpperCase(),
    deleteRule:String(foreignKey.deleteRule || "RESTRICT").toUpperCase(),
    columns:(foreignKey.columns || []).map(column => ({ local:String(column.local || ""), referenced:String(column.referenced || "") }))
  });
  const sameForeignKey = (foreignKey) => !foreignKey.isNew
    && JSON.stringify(comparableForeignKey(foreignKey)) === JSON.stringify(foreignKey.original || {});

  const indexColumnsSql = (index, resolveColumn) => (index.columns || []).map(column => {
    const resolved = resolveColumn(column.name) || column.name;
    const prefix = String(column.prefix || "").trim();
    return ddlIdentifier(resolved) + (prefix ? "(" + prefix + ")" : "")
      + (String(column.order || "ASC").toUpperCase() === "DESC" ? " DESC" : "");
  }).join(", ");

  const addIndexSql = (index, resolveColumn) => {
    const columns = indexColumnsSql(index, resolveColumn);
    if (String(index.name).toUpperCase() === "PRIMARY") return "ADD PRIMARY KEY (" + columns + ")";
    const type = String(index.type || "BTREE").toUpperCase();
    if (type === "FULLTEXT" || type === "SPATIAL")
      return "ADD " + type + " INDEX " + ddlIdentifier(index.name) + " (" + columns + ")";
    return "ADD " + (index.unique ? "UNIQUE " : "") + "INDEX " + ddlIdentifier(index.name)
      + " (" + columns + ")" + (type !== "BTREE" ? " USING " + type : "");
  };

  const addForeignKeySql = (foreignKey, resolveColumn) => {
    const local = foreignKey.columns.map(column => ddlIdentifier(resolveColumn(column.local) || column.local)).join(", ");
    const referenced = foreignKey.columns.map(column => ddlIdentifier(column.referenced)).join(", ");
    return "ADD CONSTRAINT " + ddlIdentifier(foreignKey.name) + " FOREIGN KEY (" + local + ") REFERENCES "
      + ddlIdentifier(foreignKey.referencedDatabase) + "." + ddlIdentifier(foreignKey.referencedTable)
      + " (" + referenced + ") ON DELETE " + foreignKey.deleteRule + " ON UPDATE " + foreignKey.updateRule;
  };

  const tableAlterPlan = (base, draft) => {
    const errors = [], warnings = [];
    const columns = (draft.columns || []).filter(column => !column.deleted);
    const dropped = (draft.columns || []).filter(column => column.deleted && !column.isNew);
    const validName = (name, label) => {
      const text = String(name || "");
      if (!text.trim()) errors.push(label + " 이름을 입력해 주세요.");
      else if (Array.from(text).length > 64) errors.push(label + " 이름은 64자까지 사용할 수 있습니다.");
      else if (/[\u0000-\u001f]/.test(text)) errors.push(label + " 이름에는 제어 문자를 사용할 수 없습니다.");
    };
    validName(draft.name, "테이블");
    if (!columns.length) errors.push("테이블에는 컬럼이 하나 이상 있어야 합니다.");
    const names = new Set();
    columns.forEach((column, index) => {
      validName(column.name, "" + (index + 1) + "번째 컬럼");
      const folded = String(column.name || "").toLowerCase();
      if (folded && names.has(folded)) errors.push("컬럼 이름 ‘" + column.name + "’이(가) 겹칩니다.");
      names.add(folded);
      const type = String(column.type || "").trim();
      if (!type) errors.push("‘" + column.name + "’ 컬럼의 자료형을 입력해 주세요.");
      else if (type.length > 200 || /[;`\u0000\r\n]|--|\/\*|\*\//.test(type))
        errors.push("‘" + column.name + "’ 컬럼의 자료형에 사용할 수 없는 문자가 있습니다.");
      if (column.defaultMode === "expression"){
        const expression = String(column.defaultValue || "").trim();
        if (!expression || expression.length > 300 || /[;`\u0000\r\n]|--|\/\*|\*\//.test(expression))
          errors.push("‘" + column.name + "’ 컬럼의 기본값 표현식을 확인해 주세요.");
      }
      if (String(column.comment || "").length > 1024) errors.push("컬럼 설명은 1,024자까지 사용할 수 있습니다.");
    });
    if (String(draft.comment || "").length > 2048) errors.push("테이블 설명은 2,048자까지 사용할 수 있습니다.");
    if (columns.filter(column => column.autoIncrement).length > 1) errors.push("자동 증가는 컬럼 하나에만 지정할 수 있습니다.");

    const resolveColumn = (name) => {
      const folded = String(name || "").toLowerCase();
      const found = columns.find(column => String(column.name || "").toLowerCase() === folded
        || (!column.isNew && String(column.originalName || "").toLowerCase() === folded));
      return found ? found.name : "";
    };

    const indexes = draft.indexes || [];
    const activeIndexes = indexes.filter(index => !index.deleted);
    const indexNames = new Set();
    activeIndexes.forEach((index) => {
      const changed = !sameIndex(index);
      validName(index.name, "인덱스");
      const folded = String(index.name || "").toLowerCase();
      if (folded && indexNames.has(folded)) errors.push("인덱스 이름 ‘" + index.name + "’이(가) 겹칩니다.");
      indexNames.add(folded);
      const type = String(index.type || "BTREE").toUpperCase();
      if (changed && !["BTREE", "HASH", "FULLTEXT", "SPATIAL"].includes(type))
        errors.push("‘" + index.name + "’ 인덱스 종류를 확인해 주세요.");
      if (String(index.name).toUpperCase() === "PRIMARY" && !index.unique) errors.push("기본키는 고유 인덱스여야 합니다.");
      if (changed && (type === "FULLTEXT" || type === "SPATIAL") && index.unique)
        errors.push(type + " 인덱스에는 고유 옵션을 사용할 수 없습니다.");
      if (!(index.columns || []).length) errors.push("‘" + index.name + "’ 인덱스에 컬럼을 하나 이상 넣어 주세요.");
      (index.columns || []).forEach(column => {
        if (column.unsupported){
          if (changed) errors.push("함수식 인덱스 ‘" + index.name + "’은 이 편집창에서 수정할 수 없습니다.");
          return;
        }
        if (!resolveColumn(column.name)) errors.push("‘" + index.name + "’ 인덱스의 컬럼 ‘" + column.name + "’을(를) 찾을 수 없습니다.");
        const prefix = String(column.prefix || "").trim();
        if (prefix && (!/^\d+$/.test(prefix) || Number(prefix) < 1)) errors.push("인덱스 접두 길이는 1 이상의 숫자여야 합니다.");
      });
    });

    const foreignKeys = draft.foreignKeys || [];
    const activeForeignKeys = foreignKeys.filter(foreignKey => !foreignKey.deleted);
    const foreignNames = new Set();
    const rules = ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION"];
    activeForeignKeys.forEach((foreignKey) => {
      validName(foreignKey.name, "외래키");
      const folded = String(foreignKey.name || "").toLowerCase();
      if (folded && foreignNames.has(folded)) errors.push("외래키 이름 ‘" + foreignKey.name + "’이(가) 겹칩니다.");
      foreignNames.add(folded);
      validName(foreignKey.referencedDatabase, "참조 데이터베이스");
      validName(foreignKey.referencedTable, "참조 테이블");
      if (!rules.includes(String(foreignKey.deleteRule).toUpperCase()) || !rules.includes(String(foreignKey.updateRule).toUpperCase()))
        errors.push("‘" + foreignKey.name + "’ 외래키의 갱신·삭제 규칙을 확인해 주세요.");
      if (!(foreignKey.columns || []).length) errors.push("‘" + foreignKey.name + "’ 외래키에 컬럼 짝을 하나 이상 넣어 주세요.");
      (foreignKey.columns || []).forEach(pair => {
        const resolved = resolveColumn(pair.local);
        if (!resolved) errors.push("‘" + foreignKey.name + "’ 외래키의 로컬 컬럼 ‘" + pair.local + "’을(를) 찾을 수 없습니다.");
        else if ((foreignKey.deleteRule === "SET NULL" || foreignKey.updateRule === "SET NULL")
          && !columns.find(column => column.name === resolved).nullable)
          errors.push("‘" + foreignKey.name + "’ 외래키에서 SET NULL을 쓰려면 ‘" + resolved + "’ 컬럼이 NULL을 허용해야 합니다.");
        validName(pair.referenced, "참조 컬럼");
      });
    });

    const originalOrder = (base.columns || []).map(column => column.originalName);
    const survivingOriginalOrder = originalOrder.filter(name => columns.some(column => !column.isNew && column.originalName === name));
    const currentOriginalOrder = columns.filter(column => !column.isNew).map(column => column.originalName);
    const orderChanged = JSON.stringify(survivingOriginalOrder) !== JSON.stringify(currentOriginalOrder);
    if (orderChanged && columns.some(column => column.generationExpression))
      errors.push("생성 컬럼이 있는 테이블은 1차 편집창에서 컬럼 순서를 바꿀 수 없습니다.");

    const columnChanges = [];
    columns.forEach((column, index) => {
      const previous = index ? columns[index - 1] : null;
      const position = index ? " AFTER " + ddlIdentifier(previous.name) : " FIRST";
      if (column.isNew){
        columnChanges.push("ADD COLUMN " + columnDefinitionSql(column) + position);
        warnings.push("컬럼 ‘" + column.name + "’을(를) 추가합니다.");
        return;
      }
      const changed = !sameColumn(column);
      if (!changed && !orderChanged) return;
      if (column.generationExpression || column.unsupportedExtra){
        errors.push("고급 속성이 있는 컬럼 ‘" + column.name + "’은 이 편집창에서 수정할 수 없습니다.");
        return;
      }
      const renamed = column.name !== column.originalName;
      columnChanges.push((renamed ? "CHANGE COLUMN " + ddlIdentifier(column.originalName) + " " : "MODIFY COLUMN ")
        + columnDefinitionSql(column) + (orderChanged ? position : ""));
      if (renamed) warnings.push("컬럼 ‘" + column.originalName + "’의 이름을 ‘" + column.name + "’(으)로 바꿉니다.");
      if (String(column.type).trim().toLowerCase() !== String(column.original.type).trim().toLowerCase())
        warnings.push("‘" + column.name + "’ 컬럼의 자료형이 바뀝니다.");
      if (column.original.nullable && !column.nullable)
        warnings.push("‘" + column.name + "’ 컬럼을 NOT NULL로 바꿉니다.");
    });
    dropped.forEach((column) => {
      columnChanges.push("DROP COLUMN " + ddlIdentifier(column.originalName));
      warnings.push("컬럼 ‘" + column.originalName + "’과 그 데이터가 삭제됩니다.");
    });
    const foreignDrops = [], foreignAdds = [], indexDrops = [], indexAdds = [];
    indexes.forEach((index) => {
      const changed = !index.deleted && !sameIndex(index);
      if ((index.deleted || changed) && !index.isNew){
        indexDrops.push(String(index.originalName).toUpperCase() === "PRIMARY"
          ? "DROP PRIMARY KEY" : "DROP INDEX " + ddlIdentifier(index.originalName));
      }
      if (changed || (!index.deleted && index.isNew)) indexAdds.push(addIndexSql(index, resolveColumn));
      if (index.deleted && !index.isNew) warnings.push("인덱스 ‘" + index.originalName + "’을(를) 삭제합니다.");
      else if (changed) warnings.push("인덱스 ‘" + (index.originalName || index.name) + "’ 구성을 바꿉니다.");
    });
    foreignKeys.forEach((foreignKey) => {
      const changed = !foreignKey.deleted && !sameForeignKey(foreignKey);
      if ((foreignKey.deleted || changed) && !foreignKey.isNew)
        foreignDrops.push("DROP FOREIGN KEY " + ddlIdentifier(foreignKey.originalName));
      if (changed || (!foreignKey.deleted && foreignKey.isNew)) foreignAdds.push(addForeignKeySql(foreignKey, resolveColumn));
      if (foreignKey.deleted && !foreignKey.isNew) warnings.push("외래키 ‘" + foreignKey.originalName + "’을(를) 삭제합니다.");
      else if (changed) warnings.push("외래키 ‘" + (foreignKey.originalName || foreignKey.name) + "’ 구성을 바꿉니다.");
    });

    const tableChanges = [];
    if (String(draft.comment || "") !== String(base.comment || "")) tableChanges.push("COMMENT = " + ddlString(draft.comment));
    if (String(draft.name || "") !== String(base.name || "")){
      tableChanges.push("RENAME TO " + ddlIdentifier(base.database) + "." + ddlIdentifier(draft.name));
      warnings.push("테이블 이름을 ‘" + draft.name + "’(으)로 바꿉니다. 기존 SQL이 영향을 받을 수 있습니다.");
    }
    const changes = [...foreignDrops, ...indexDrops, ...columnChanges, ...indexAdds, ...foreignAdds, ...tableChanges];
    const target = ddlIdentifier(base.database) + "." + ddlIdentifier(base.name);
    return {
      errors, warnings, destructive:dropped.length > 0,
      sql:changes.length && !errors.length ? "ALTER TABLE " + target + "\n  " + changes.join(",\n  ") + ";" : ""
    };
  };

  const ERD_MAX_COLUMNS = 24;
  const erdLayout = (tables, relationships) => {
    const cardWidth = 260, headerHeight = 39, rowHeight = 23, footerHeight = 25;
    const gapX = 90, gapY = 34, padding = 42;
    const items = (tables || []).map(table => ({ ...table, name:String(table.name || "") }))
      .filter(table => table.name).sort((left, right) => left.name.localeCompare(right.name));
    const known = new Set(items.map(table => table.name));
    const parents = new Map(items.map(table => [table.name, []]));
    (relationships || []).forEach((relationship) => {
      if (known.has(relationship.sourceTable) && known.has(relationship.targetTable)
        && relationship.sourceTable !== relationship.targetTable)
        parents.get(relationship.sourceTable).push(relationship.targetTable);
    });
    const memo = new Map(), visiting = new Set();
    const depthOf = (name) => {
      if (memo.has(name)) return memo.get(name);
      if (visiting.has(name)) return 0;
      visiting.add(name);
      let depth = 0;
      (parents.get(name) || []).forEach(parent => { depth = Math.max(depth, depthOf(parent) + 1); });
      visiting.delete(name);
      memo.set(name, depth);
      return depth;
    };
    const layers = new Map();
    items.forEach((table) => {
      const depth = depthOf(table.name);
      if (!layers.has(depth)) layers.set(depth, []);
      layers.get(depth).push(table);
    });
    const nodes = [], layerDepths = [...layers.keys()].sort((left, right) => left - right);
    let worldHeight = 0;
    layerDepths.forEach((depth) => {
      let y = padding;
      layers.get(depth).forEach((table) => {
        const visibleColumns = Math.min((table.columns || []).length, ERD_MAX_COLUMNS);
        const height = headerHeight + visibleColumns * rowHeight
          + ((table.columns || []).length > ERD_MAX_COLUMNS ? footerHeight : 0);
        nodes.push({ table, x:padding + depth * (cardWidth + gapX), y, width:cardWidth, height });
        y += height + gapY;
      });
      worldHeight = Math.max(worldHeight, y);
    });
    const maxDepth = layerDepths.length ? Math.max(...layerDepths) : 0;
    return {
      nodes,
      width:Math.max(520, padding * 2 + (maxDepth + 1) * cardWidth + maxDepth * gapX),
      height:Math.max(360, worldHeight + padding - gapY),
      maxColumns:ERD_MAX_COLUMNS
    };
  };

  // 되돌릴 수 없는 문장을 골라 낸다. 차단이 아니라 "이게 그 문장이다"라고 알려 주는 장치다.
  const riskyStatements = (sql) => splitStatements(sql).map((statement) => {
    const keyword = firstKeyword(statement);
    const hasWhere = /\bwhere\b/i.test(statement);
    if (keyword === "drop") return { statement, reason:"DROP — 테이블이나 데이터베이스가 사라집니다." };
    if (keyword === "truncate") return { statement, reason:"TRUNCATE — 테이블의 모든 행이 사라집니다." };
    if (keyword === "alter") return { statement, reason:"ALTER — 테이블 구조와 저장된 데이터가 바뀔 수 있습니다." };
    if (keyword === "delete" && !hasWhere) return { statement, reason:"WHERE 없는 DELETE — 모든 행이 지워집니다." };
    if (keyword === "update" && !hasWhere) return { statement, reason:"WHERE 없는 UPDATE — 모든 행이 바뀝니다." };
    return null;
  }).filter(Boolean);

  /* ── 작은 DOM 도우미 ─────────────────────────────────────────────────────── */

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

  const field = (labelText, inputEl) => {
    const wrap = el("label", "db-field");
    wrap.append(el("span", "db-field-label", labelText), inputEl);
    return wrap;
  };

  const input = (type, value, placeholder) => {
    const node = document.createElement("input");
    node.type = type;
    node.value = value == null ? "" : String(value);
    if (placeholder) node.placeholder = placeholder;
    if (type === "password") node.autocomplete = "off";
    return node;
  };

  const notice = (host, title, detail, kind) => {
    const wrap = el("div", "db-message" + (kind ? " " + kind : ""));
    wrap.append(el("strong", null, title));
    if (detail) wrap.append(el("p", null, detail));
    host.append(wrap);
    return wrap;
  };

  /* ── 접속 문서 하나 ──────────────────────────────────────────────────────── */

  const mount = (doc) => {
    const profile = doc.dbProfile;
    const root = el("section", "db-host");
    doc.el.innerHTML = "";
    doc.el.append(root);

    let sessionId = "";
    let readOnly = !!profile.readOnly;
    // 자동 커밋이 꺼져 있으면 쓰기 문장이 트랜잭션에 쌓이고 커밋·롤백으로만 확정된다.
    // pendingTx 는 워커가 알려 주는 "아직 확정하지 않은 변경이 있다"는 표시다.
    let autoCommit = profile.autoCommit !== false;
    let pendingTx = false;
    let currentDatabase = profile.database || "";
    let schemaObjects = [];
    const tableChildrenCache = new Map();   // 테이블 이름 -> 컬럼·인덱스·외래키·트리거
    let schemaColumns = [];                 // 현재 DB 의 전체 컬럼(자동완성 후보)
    let runningJob = "", runningLabel = "", runningSql = "", runningQuiet = false, runningComplete = null;
    let pollTimer = 0;
    let closed = false;

    const markDirty = () => {
      if (typeof markDocumentDirty === "function") markDocumentDirty(doc, serializeProfile(profile) !== doc.savedText);
    };

    /* 접속 화면 ------------------------------------------------------------ */

    const form = el("div", "db-connect");
    const hostInput = input("text", profile.host, "127.0.0.1");
    const portInput = input("number", profile.port, "3306");
    const databaseInput = input("text", profile.database, "(선택) 기본 데이터베이스");
    const userInput = input("text", profile.user, "root");
    const passwordInput = input("password", "", "연결할 때만 쓰고 저장하지 않습니다");
    const writeToggle = input("checkbox", "");
    writeToggle.checked = !profile.readOnly;
    const connectButton = button("연결", "db-btn db-btn-primary");
    const statusLine = el("div", "db-connect-status");

    portInput.min = "1";
    portInput.max = "65535";

    const formGrid = el("div", "db-connect-grid");
    formGrid.append(
      field("호스트", hostInput), field("포트", portInput),
      field("데이터베이스", databaseInput), field("계정", userInput),
      field("비밀번호", passwordInput)
    );

    const writeRow = el("label", "db-write-toggle");
    writeRow.append(writeToggle, el("span", null, "쓰기 허용 — 켜지 않으면 서버가 이 접속의 모든 쓰기를 거부합니다"));

    // 접속 표시색. 운영 DB 를 빨강으로 두면 어느 탭에서 실행하는지 한눈에 구분된다.
    const colorRow = el("div", "db-color-row");
    colorRow.append(el("span", "db-field-label", "표시색"));
    const colorButtons = COLORS.map((color) => {
      const swatch = button("", "db-swatch", COLOR_LABELS[color]);
      swatch.dataset.color = color;
      swatch.setAttribute("aria-label", "표시색 " + COLOR_LABELS[color]);
      swatch.addEventListener("click", () => {
        profile.color = color;
        applyColor();
        markDirty();
      });
      colorRow.append(swatch);
      return swatch;
    });

    const applyColor = () => {
      const color = profile.color || "";
      root.dataset.dbColor = color;
      colorButtons.forEach((swatch) => swatch.classList.toggle("active", swatch.dataset.color === color));
    };

    form.append(
      el("h2", "db-connect-title", "MySQL 접속"),
      formGrid, writeRow, colorRow,
      el("div", "db-connect-actions", null),
      statusLine
    );
    form.querySelector(".db-connect-actions").append(connectButton);

    /* 작업 화면 ------------------------------------------------------------ */

    const workspace = el("div", "db-workspace");
    workspace.hidden = true;

    const sidebar = el("nav", "db-sidebar");
    sidebar.setAttribute("aria-label", "데이터베이스 스키마");
    const databaseSelect = document.createElement("select");
    databaseSelect.className = "db-database-select";
    databaseSelect.setAttribute("aria-label", "데이터베이스 선택");
    const tableFilter = input("search", "", "테이블 찾기");
    tableFilter.className = "db-table-filter";
    const tableList = el("div", "db-table-list");
    const databaseRoot = el("div", "db-database-root");
    const databaseIcon = el("span", "db-database-icon");
    databaseIcon.innerHTML = uiIcon("database");
    const erdButton = button("", "db-database-action", "현재 데이터베이스의 ERD 다이어그램을 봅니다");
    erdButton.setAttribute("aria-label", "ERD 다이어그램");
    erdButton.innerHTML = uiIcon("graph");
    erdButton.disabled = true;
    databaseRoot.append(databaseIcon, databaseSelect, erdButton);
    sidebar.append(
      el("div", "db-sidebar-head", null),
      tableFilter, tableList
    );
    sidebar.querySelector(".db-sidebar-head").append(databaseRoot);

    const main = el("div", "db-main");
    const toolbar = el("div", "db-toolbar");
    const runButton = button("실행", "db-btn db-btn-primary", "Ctrl+Enter");
    const runAllButton = button("전체 실행", "db-btn", "Ctrl+Shift+Enter — 편집기의 모든 문장을 위에서부터 실행합니다");
    const cancelButton = button("취소", "db-btn", "실행 중인 쿼리를 중단합니다");
    const timeoutInput = input("number", DEFAULT_TIMEOUT, "60");
    timeoutInput.className = "db-timeout";
    timeoutInput.min = "5";
    timeoutInput.max = "600";
    timeoutInput.title = "쿼리 제한 시간(초)";
    const modeBadge = el("span", "db-mode-badge", "읽기 전용");
    const serverLabel = el("span", "db-server-label", "");
    const explainButton = button("실행 계획", "db-btn db-btn-quiet",
      "지금 실행할 문장 앞에 EXPLAIN 을 붙여 실행합니다 (편집기는 그대로 둡니다)");
    const historyButton = button("이력", "db-btn db-btn-quiet", "이 접속에서 최근에 실행한 쿼리");
    // .sql 파일을 편집기로 불러온다. 파일 선택은 브라우저 기본 입력을 쓴다 —
    // 워커·런처를 거치지 않으므로 서버에 파일이 올라가지 않는다.
    const importButton = button("SQL 열기", "db-btn db-btn-quiet",
      ".sql 파일을 읽어 편집기에 넣습니다 (실행하지는 않습니다)");
    const sqlFileInput = input("file", "");
    sqlFileInput.accept = ".sql,.txt,text/plain";
    sqlFileInput.hidden = true;
    sqlFileInput.setAttribute("aria-hidden", "true");
    // run-save 클래스는 app.js 의 전역 Ctrl+S(saveCurrent)가 찾아 눌러 주는 표식이다.
    // 자체 키 처리기를 두면 그 경로와 두 번 겹치므로 클래스만 맞춘다.
    const saveButton = button("저장", "db-btn db-btn-quiet run-save",
      "접속 정보와 SQL 을 .dbconn 파일에 저장합니다 (Ctrl+S · 비밀번호는 저장하지 않습니다)");
    saveButton.dataset.shortcutAction = "saveCurrent";
    saveButton.dataset.shortcutTitle = "접속 문서 저장";
    const disconnectButton = button("연결 끊기", "db-btn db-btn-quiet");
    cancelButton.disabled = true;

    /* 트랜잭션 — 자동 커밋을 끄면 커밋·롤백으로 직접 확정한다.
       읽기 전용 접속에는 확정할 것이 없으므로 통째로 감춘다. */
    const txWrap = el("span", "db-tx-wrap", null);
    const autoCommitToggle = input("checkbox", "");
    const autoCommitLabel = el("label", "db-autocommit", null);
    autoCommitLabel.title = "끄면 쓰기 문장이 바로 확정되지 않고 커밋을 눌러야 반영됩니다";
    autoCommitLabel.append(autoCommitToggle, el("span", null, "자동 커밋"));
    const txBadge = el("span", "db-tx-badge", "커밋 대기");
    txBadge.title = "아직 커밋하지 않은 변경이 있습니다. 커밋하지 않고 연결을 끊으면 모두 사라집니다.";
    txBadge.hidden = true;
    const commitButton = button("커밋", "db-btn db-btn-quiet", "지금까지의 변경을 확정합니다");
    const rollbackButton = button("롤백", "db-btn db-btn-quiet", "커밋하지 않은 변경을 되돌립니다");
    txWrap.append(autoCommitLabel, txBadge, commitButton, rollbackButton);
    txWrap.hidden = true;

    toolbar.append(runButton, runAllButton, cancelButton, explainButton, el("span", "db-timeout-wrap", null),
      modeBadge, txWrap, serverLabel, historyButton, importButton, saveButton, disconnectButton, sqlFileInput);
    toolbar.querySelector(".db-timeout-wrap").append(el("span", null, "제한"), timeoutInput, el("span", null, "초"));

    /* 편집기는 파이썬·자바스크립트 편집기와 같은 위젯을 쓴다(buildCodeEditor).
       되돌리기·줄 이동·찾기·사각 선택·줄 번호 같은 편집 기능을 여기서 다시 만들지 않기 위해서다.
       plain:true 로 파이썬 전용 지능(Jedi 질의·import 추론)을 끄고, SQL 후보만 따로 넣는다. */
    const editorWrap = el("div", "db-editor");
    // 위젯이 이 배열의 참조를 붙들고 자동완성 때마다 읽는다 → 접속 뒤 스키마가 오면 여기에 채워 넣는다.
    const completionWords = (typeof completionWordsForProfile === "function"
      ? completionWordsForProfile("sql", "sql") : []).slice();

    const editor = buildCodeEditor(profile.sql || "", "sql", {
      plain: true,
      fileExt: "sql",
      // 편집기가 고정 높이(overflow:hidden)라 자동완성 목록을 안쪽에 두면 잘린다.
      // 노트북 셀과 같은 이유로 body 로 빼서 띄운다.
      completionPortal: true,
      completionWords,
      // `별칭.` 뒤에서는 그 별칭이 가리키는 테이블의 컬럼만 준다.
      memberCandidates: (source, receiver, prefix) => sqlMemberCandidates(source, receiver, prefix)
    });
    editor.ta.setAttribute("aria-label", "SQL 편집기");
    editorWrap.append(editor.host);

    const resultBar = el("div", "db-result-bar");
    const resultStatus = el("span", "db-result-status", "");
    const selectInfo = el("span", "db-select-info", "");
    selectInfo.hidden = true;
    const exportCsvButton = button("CSV로 내보내기", "db-btn db-btn-quiet");
    const openSheetButton = button("표 편집기로 열기", "db-btn db-btn-quiet");
    resultBar.append(resultStatus, selectInfo, el("span", "db-result-spacer", null), exportCsvButton, openSheetButton);
    exportCsvButton.hidden = true;
    openSheetButton.hidden = true;

    // 여러 문장을 실행하면 결과 집합도 여러 개가 온다. 예전에는 마지막 것만 그리고 나머지를 버렸다.
    const resultTabs = el("div", "db-result-tabs");
    resultTabs.hidden = true;

    const resultHost = el("div", "db-result");

    /* 최근 실행 목록 — 클릭하면 편집기 커서 자리에 그 쿼리를 넣는다. */
    const historyPanel = el("aside", "db-history-panel");
    historyPanel.hidden = true;
    const historyList = el("div", "db-history-list");
    const historyClear = button("기록 지우기", "db-btn db-btn-quiet");
    const historyClose = button("닫기", "db-btn db-btn-quiet");
    const historyHead = el("div", "db-value-head");
    historyHead.append(el("strong", "db-value-title", "최근 실행"), el("span", "db-result-spacer", null),
      historyClear, historyClose);
    historyPanel.append(historyHead, historyList);

    // 자동완성 목록. 커서 위치에 띄우려면 좌표가 필요한데, 강조 오버레이가 편집기와
    // 글꼴·여백·줄바꿈이 같으므로 그 안에서 잰다(별도 mirror 를 만들지 않는다).
    const completionBox = el("div", "db-completion");
    completionBox.hidden = true;

    const editorDivider = el("div", "db-hdivider");
    editorDivider.title = "드래그: 편집기 높이 조절 · 더블클릭: 기본 높이로";
    editorDivider.setAttribute("aria-hidden", "true");

    main.append(toolbar, editorWrap, editorDivider, resultBar, resultTabs, resultHost,
      historyPanel, completionBox);
    const divider = el("div", "db-divider");
    divider.title = "드래그: 스키마 패널 너비 조절 · 더블클릭: 기본 너비로";
    divider.setAttribute("aria-hidden", "true");
    workspace.append(sidebar, divider, main);
    root.append(form, workspace);

    /* 스키마 패널 너비 ------------------------------------------------------ */

    const maxSidebarWidth = () => {
      const rect = workspace.getBoundingClientRect();
      // 연결 전에는 작업 영역이 화면에 없어 폭이 0 이다. 그때는 상한을 걸지 않는다.
      if (!rect.width) return Infinity;
      // 편집기 자리를 320px 은 남긴다 — 분할선을 끝까지 밀어 편집기를 없애지 못하게.
      return Math.max(SIDEBAR_MIN, rect.width - SIDEBAR_KEEP_MAIN);
    };

    const setSidebarWidth = (px, persist) => {
      const width = Math.round(Math.max(SIDEBAR_MIN, Math.min(maxSidebarWidth(), px)));
      workspace.style.setProperty("--db-sidebar-width", width + "px");
      if (persist) storeSidebarWidth(width);
      return width;
    };

    divider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { divider.setPointerCapture(event.pointerId); } catch(_){}
      divider.classList.add("dragging");
      const startX = event.clientX;
      const startWidth = sidebar.getBoundingClientRect().width;
      const move = (moveEvent) => setSidebarWidth(startWidth + (moveEvent.clientX - startX), false);
      const end = () => {
        divider.classList.remove("dragging");
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", end);
        // 터치가 끊겨도(pointercancel) 리스너를 남기지 않는다 — 원격 터미널 분할선에서 겪은 문제다.
        divider.removeEventListener("pointercancel", end);
        try { divider.releasePointerCapture(event.pointerId); } catch(_){}
        storeSidebarWidth(sidebar.getBoundingClientRect().width);
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", end);
      divider.addEventListener("pointercancel", end);
    });

    divider.addEventListener("dblclick", (event) => {
      event.preventDefault();
      setSidebarWidth(SIDEBAR_DEFAULT, true);
    });

    /* 편집기 높이 ----------------------------------------------------------- */

    const maxEditorHeight = () => {
      const rect = main.getBoundingClientRect();
      if (!rect.height) return Infinity;              // 연결 전에는 화면에 없어 높이가 0 이다
      // 결과 자리를 240px 은 남긴다 — 분할선을 끝까지 내려 결과를 없애지 못하게.
      return Math.max(EDITOR_MIN, rect.height - EDITOR_KEEP_RESULT);
    };

    const setEditorHeight = (px, persist) => {
      const height = Math.round(Math.max(EDITOR_MIN, Math.min(maxEditorHeight(), px)));
      main.style.setProperty("--db-editor-height", height + "px");
      if (persist) storeEditorHeight(height);
      return height;
    };

    editorDivider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { editorDivider.setPointerCapture(event.pointerId); } catch(_){}
      editorDivider.classList.add("dragging");
      const startY = event.clientY;
      const startHeight = editorWrap.getBoundingClientRect().height;
      const move = (moveEvent) => setEditorHeight(startHeight + (moveEvent.clientY - startY), false);
      const end = () => {
        editorDivider.classList.remove("dragging");
        editorDivider.removeEventListener("pointermove", move);
        editorDivider.removeEventListener("pointerup", end);
        editorDivider.removeEventListener("pointercancel", end);
        try { editorDivider.releasePointerCapture(event.pointerId); } catch(_){}
        storeEditorHeight(editorWrap.getBoundingClientRect().height);
      };
      editorDivider.addEventListener("pointermove", move);
      editorDivider.addEventListener("pointerup", end);
      editorDivider.addEventListener("pointercancel", end);
    });

    editorDivider.addEventListener("dblclick", (event) => {
      event.preventDefault();
      setEditorHeight(EDITOR_DEFAULT, true);
    });

    /* 무엇을 실행할지 ------------------------------------------------------
       선택이 있으면 선택한 글자 그대로, 없으면 커서가 놓인 문장 하나.
       편집기 전체는 Ctrl+Shift+Enter 또는 `전체 실행` 버튼으로만 나간다.
       DBeaver·MySQL Workbench·DataGrip 이 모두 쓰는 규칙이다. */

    const runTarget = () => {
      const value = editor.getValue();
      const from = editor.ta.selectionStart, to = editor.ta.selectionEnd;
      if (from !== to){
        const picked = value.slice(from, to).trim();
        if (picked) return { sql:picked, label:"선택 실행" };
      }
      const range = statementAt(value, from);
      return range ? { sql:range.text, label:"현재 문장 실행" } : null;
    };

    const allTarget = () => {
      const sql = editor.getValue().trim();
      return sql ? { sql, label:"전체 실행" } : null;
    };

    const previewOf = (sql, limit) => {
      const line = String(sql).split("\n").find(item => item.trim()) || "";
      const clean = line.trim();
      const max = limit || 60;
      return clean.length > max ? clean.slice(0, max) + "…" : clean;
    };

    // 버튼이 무엇을 실행할지 이름으로 밝힌다. 겉모습이 같은 버튼이 상황마다 다르게
    // 동작하는 것이 규칙 자체보다 위험하다.
    const refreshRunLabel = () => {
      if (runningJob) return;
      const target = runTarget();
      const total = statementRanges(editor.getValue()).length;
      runButton.textContent = target ? target.label : "실행";
      runButton.disabled = !target || !sessionId;
      runButton.title = target ? "Ctrl+Enter — " + previewOf(target.sql) : "실행할 SQL 을 입력해 주세요.";
      runAllButton.hidden = total < 2;
      runAllButton.disabled = !sessionId;
      runAllButton.textContent = "전체 실행 (" + total + ")";
    };

    // 위젯이 값을 바꿀 때마다(입력·되돌리기·줄 이동·자동완성 수락) input 이벤트를 낸다.
    editor.ta.addEventListener("input", () => {
      profile.sql = editor.getValue();
      refreshRunLabel();
      markDirty();
    });
    ["keyup", "mouseup", "select", "focus", "blur"].forEach((name) =>
      editor.ta.addEventListener(name, refreshRunLabel));

    /* 실행 단축키만 위젯 위에 얹는다. 편집 단축키(Ctrl+Z·Ctrl+D·Ctrl+/·Ctrl+Space·
       Alt+↑↓·Ctrl+F·Ctrl+G 등)는 위젯이 이미 갖고 있다. */
    editor.ta.addEventListener("keydown", (event) => {
      if (editor.isCompletionOpen && editor.isCompletionOpen()) return;   // 자동완성 목록이 먼저다
      if (shortcutMatches(event, "runCode")){
        event.preventDefault();
        runQuery(runTarget());
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "Enter"){
        event.preventDefault();
        runQuery(allTarget());
      }
    });

    // 편집기 커서 자리에 이름을 넣는다. 위젯이 값 변화를 알아채도록 input 이벤트를 함께 낸다.
    const insertIntoEditor = (snippet) => {
      const ta = editor.ta;
      const start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
      const caret = start + snippet.length;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
    };

    /* 자동완성 후보 --------------------------------------------------------
       위젯의 자동완성(Ctrl+Space)에 SQL 후보를 실어 준다.
       completionWords 는 위젯이 참조로 붙들고 있어 여기서 채우면 바로 반영된다. */

    const refreshCompletionWords = () => {
      const base = typeof completionWordsForProfile === "function"
        ? completionWordsForProfile("sql", "sql") : [];
      const seen = new Set();
      const words = [];
      const add = (name) => {
        const text = String(name || "");
        if (!text || seen.has(text.toLowerCase())) return;
        seen.add(text.toLowerCase());
        words.push(text);
      };
      base.forEach(add);
      schemaObjects.forEach(item => add(item.name));
      schemaColumns.forEach(column => add(column.name));
      completionWords.length = 0;
      words.forEach(word => completionWords.push(word));
    };

    const sqlMemberCandidates = (source, receiver, prefix) => {
      const statement = statementAt(String(source || ""), editor.ta.selectionStart);
      const table = aliasMap(statement ? statement.text : String(source || ""))
        .get(String(receiver || "").toLowerCase()) || String(receiver || "");
      const query = String(prefix || "").toLowerCase();
      return schemaColumns
        .filter(column => column.table.toLowerCase() === table.toLowerCase()
          && (!query || column.name.toLowerCase().startsWith(query)))
        .map(column => ({ name:column.name, type:column.type || "", signature:"" }));
    };

    /* 결과 표 -------------------------------------------------------------- */

    let lastRows = null;          // MNTableExport 로 넘길 현재 결과 집합
    let resultSets = [];          // 행을 낸 문장들(탭 하나가 하나)

    /* 셀 값 보기 — 표는 값을 한 줄로 줄여 그리므로 여러 줄 값과 긴 값은 여기서만 온전히 읽힌다.
       칸을 고르는 일(클릭)과 값을 자세히 보는 일(더블클릭)을 나눈다. 예전에는 결과 아래 패널이
       늘 자리를 차지했는데, 모달로 옮겨 결과 표를 그만큼 넓게 쓰고 큰 값도 크게 본다.
       모달 카드는 앱 공용 규칙을 그대로 받는다(끌어 옮기기·크기 조절은 app.js 가 붙여 준다). */

    let closeValueModal = null;

    const closeValuePanel = () => { if (closeValueModal) closeValueModal(); };

    const showCellValue = (columnName, value, clipped) => {
      const text = value === null ? "NULL" : String(value);
      let note;
      if (value === null) note = "빈 값(NULL)입니다.";
      else if (/^<BLOB \d+ bytes>$/.test(text)) note = "이진 데이터라 내용을 표시하지 않습니다. 크기만 가져왔습니다.";
      else if (clipped) note = "서버에서 500자까지만 가져온 값입니다. 전체가 필요하면 그 컬럼만 따로 조회해 주세요.";
      else note = text.length.toLocaleString() + "자";
      openValueModal(columnName || "값", text, note, value === null);
    };

    const openValueModal = (columnName, text, note, isNull) => {
      if (closeValueModal) closeValueModal();
      const modal = el("div", "modal db-value-modal");
      const card = el("div", "modal-card db-value-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", columnName + " 값");

      const head = el("div", "db-value-head");
      const title = el("strong", "db-value-title", columnName);
      const copy = button("값 복사", "db-btn db-btn-quiet");
      const close = button("", "db-table-modal-close", "닫기");
      close.setAttribute("aria-label", "닫기");
      close.innerHTML = uiIcon("close");
      copy.disabled = !!isNull;
      head.append(title, el("span", "db-result-spacer", null), copy, close);

      const body = el("pre", "db-value-body", text);
      body.tabIndex = 0;
      body.classList.toggle("db-value-null", !!isNull);
      card.append(head, body, el("p", "db-value-note", note));
      modal.append(card);
      document.body.append(modal);
      if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

      const forceClose = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
        closeValueModal = null;
      };
      // 위에 다른 창이 떠 있으면 그 창이 먼저 닫혀야 한다(ERD·테이블 정보 모달과 같은 규칙).
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        forceClose();
      };
      closeValueModal = forceClose;
      close.addEventListener("click", forceClose);
      modal.addEventListener("click", event => { if (event.target === modal) forceClose(); });
      window.addEventListener("keydown", onKey, true);
      copy.addEventListener("click", () => {
        if (typeof copyDocumentMenuText === "function") copyDocumentMenuText(text, "셀 값을 복사했어요.");
        else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("셀 값을 복사했어요.", 1800));
      });
      body.focus({ preventScroll:true });
    };

    let currentGrid = null;      // 지금 그려 둔 표(더 보기가 뒤에 행을 이어 붙인다)

    /* 결과 표 고르기 ---------------------------------------------------------
       칸 하나를 `행 * 열수 + 열` 정수 하나로 눌러 담는다. 흩어진 선택까지 Set 하나로
       다룰 수 있어 Ctrl 더하기·빼기가 특별한 경우가 되지 않는다(스프레드시트와 같은 셈을
       grid-selection.js 에서 함께 쓴다).

       표에는 글자 드래그 선택을 끈다(styles.css 의 user-select:none). 칸을 끄는 동작과
       글자를 긁는 동작이 같은 드래그를 두고 다투기 때문이다. 값 일부만 복사하는 일은
       셀 값 패널의 `복사` 가 맡는다. */

    const grid = typeof MNGridSelection !== "undefined" ? MNGridSelection : null;
    let gridSelection = null;    // { keys:Set<number>, anchor:{row,col} }
    let gridHeadBounds = null;   // 지금 강조해 둔 머리 범위(다시 칠할 자리를 줄이는 데 쓴다)
    let gridDrag = null;

    const gridColumnCount = () => (currentGrid && currentGrid.columns.length) || 0;
    const gridRowCount = () => (currentGrid && currentGrid.body ? currentGrid.body.children.length : 0);
    const gridCellAt = (row, col) => {
      if (!currentGrid || !currentGrid.body) return null;
      const tr = currentGrid.body.children[row];
      return tr ? tr.children[col + 1] || null : null;      // 0 번은 왼쪽 번호 칸
    };

    // 바뀐 칸만 다시 칠한다. 표 전체를 고르면 칸이 2만 개까지 가므로 매번 전부 훑으면 끌린다.
    const paintGridCells = (nextKeys) => {
      const cols = gridColumnCount();
      const previous = gridSelection ? gridSelection.keys : null;
      if (previous) previous.forEach((key) => {
        if (nextKeys.has(key)) return;
        const cell = gridCellAt(Math.floor(key / cols), key % cols);
        if (cell) cell.classList.remove("db-cell-selected");
      });
      nextKeys.forEach((key) => {
        if (previous && previous.has(key)) return;
        const cell = gridCellAt(Math.floor(key / cols), key % cols);
        if (cell) cell.classList.add("db-cell-selected");
      });
    };

    // 머리(번호 칸·컬럼명)도 고른 범위를 따라 밝힌다. 예전 범위와 새 범위를 합친 구간만 훑는다.
    const paintGridHeads = (bounds) => {
      if (!currentGrid) return;
      const inRow = (index) => !!bounds && index >= bounds.row1 && index <= bounds.row2;
      const inCol = (index) => !!bounds && index >= bounds.col1 && index <= bounds.col2;
      const span = (next, previous, pick) => {
        const values = [];
        if (next) values.push(pick(next)[0], pick(next)[1]);
        if (previous) values.push(pick(previous)[0], pick(previous)[1]);
        return values.length ? { from:Math.min(...values), to:Math.max(...values) } : null;
      };
      const rows = span(bounds, gridHeadBounds, (item) => [item.row1, item.row2]);
      if (rows) for (let index = Math.max(0, rows.from); index <= Math.min(rows.to, gridRowCount() - 1); index++){
        const tr = currentGrid.body.children[index];
        const indexCell = tr && tr.children[0];
        if (indexCell) indexCell.classList.toggle("db-head-selected", inRow(index));
      }
      const cols = span(bounds, gridHeadBounds, (item) => [item.col1, item.col2]);
      if (cols) for (let index = Math.max(0, cols.from); index <= Math.min(cols.to, gridColumnCount() - 1); index++){
        const th = currentGrid.headCells[index];
        if (th) th.classList.toggle("db-head-selected", inCol(index));
      }
      gridHeadBounds = bounds;
    };

    const refreshSelectInfo = (bounds) => {
      if (!bounds){ selectInfo.hidden = true; selectInfo.textContent = ""; return; }
      const height = bounds.row2 - bounds.row1 + 1, width = bounds.col2 - bounds.col1 + 1;
      selectInfo.hidden = false;
      selectInfo.textContent = (bounds.contiguous
        ? height.toLocaleString() + "행 × " + width + "열"
        : bounds.count.toLocaleString() + "칸") + " 선택 · Ctrl+C 로 복사";
    };

    const setGridSelection = (keys, anchor) => {
      const cols = gridColumnCount();
      paintGridCells(keys);
      gridSelection = keys.size ? { keys, anchor:anchor || (gridSelection && gridSelection.anchor) || null } : null;
      const bounds = keys.size && grid ? grid.gridSelectionBoundsFromKeys(keys, cols) : null;
      paintGridHeads(bounds);
      refreshSelectInfo(bounds);
    };

    function clearGridSelection(){
      if (gridSelection) paintGridCells(new Set());
      gridSelection = null;
      gridDrag = null;
      if (gridHeadBounds) paintGridHeads(null);
      gridHeadBounds = null;
      refreshSelectInfo(null);
    }

    // 짚은 자리가 무엇인지 돌려준다: 칸·행 머리(번호)·열 머리(컬럼명)·왼쪽 위 모서리
    const gridPointFrom = (node) => {
      if (!currentGrid || !node || !node.closest) return null;
      const cell = node.closest("td,th");
      if (!cell || !currentGrid.table.contains(cell)) return null;
      const col = cell.cellIndex - 1;
      if (cell.tagName === "TH") return col < 0 ? { kind:"all", row:0, col:0 } : { kind:"col", row:0, col };
      const row = Array.prototype.indexOf.call(currentGrid.body.children, cell.parentElement);
      if (row < 0) return null;
      return col < 0 ? { kind:"row", row, col:0 } : { kind:"cell", row, col };
    };

    const gridRangeFor = (kind, anchor, focus) => {
      const cols = Math.max(0, gridColumnCount() - 1), rows = Math.max(0, gridRowCount() - 1);
      if (kind === "all") return { row1:0, row2:rows, col1:0, col2:cols };
      if (kind === "row") return { row1:Math.min(anchor.row, focus.row), row2:Math.max(anchor.row, focus.row), col1:0, col2:cols };
      if (kind === "col") return { row1:0, row2:rows, col1:Math.min(anchor.col, focus.col), col2:Math.max(anchor.col, focus.col) };
      return grid.gridSelectionRangeBetween(anchor, focus);
    };

    const applyGridRange = (kind, anchor, focus, base, forcedMode) => {
      const cols = gridColumnCount();
      if (!cols || !grid) return;
      const range = gridRangeFor(kind, anchor, focus);
      const mode = forcedMode || (base
        ? (grid.gridSelectionRangeCovered(base, range, cols) ? "subtract" : "add")
        : "replace");
      setGridSelection(grid.gridSelectionCombineKeys(base, range, mode, cols), anchor);
      return mode;
    };

    function onDragMove(event){
      if (!gridDrag || gridDrag.pointerId !== event.pointerId || !currentGrid) return;
      // 머리에서 시작한 끌기는 포인터가 좁은 머리 띠를 벗어나도 시작 축을 지킨다.
      const hit = grid.gridSelectionDragHitPoint(gridDrag.kind, { x:event.clientX, y:event.clientY },
        currentGrid.table.getBoundingClientRect(),
        currentGrid.indexHead.getBoundingClientRect(),
        currentGrid.headRow.getBoundingClientRect());
      const point = gridPointFrom(document.elementFromPoint(hit.x, hit.y));
      if (!point || point.kind === "all") return;
      applyGridRange(gridDrag.kind, gridDrag.anchor, point, gridDrag.base, gridDrag.mode);
    }

    function endDrag(event){
      if (!gridDrag || (event && gridDrag.pointerId !== event.pointerId)) return;
      gridDrag = null;
      document.removeEventListener("pointermove", onDragMove, true);
      document.removeEventListener("pointerup", endDrag, true);
      document.removeEventListener("pointercancel", endDrag, true);
    }

    // 표가 사라져도(다시 그리기·탭 닫기) document 에 걸어 둔 끌기 리스너는 남는다.
    // attachGridSelection 은 표를 그릴 때마다 불리므로 뒷정리는 여기 한 번만 등록한다.
    (doc.cleanupFns = doc.cleanupFns || []).push(() => endDrag(null));

    const attachGridSelection = (table) => {
      table.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !grid) return;
        if (event.target.closest(".db-sort-btn")) return;      // 정렬 버튼은 정렬만 한다
        const point = gridPointFrom(event.target);
        if (!point) return;
        // 여기서 preventDefault 를 부르면 뒤따르는 마우스 이벤트(click·dblclick)까지 막힌다.
        // 글자 드래그 선택은 CSS 의 user-select:none 이 이미 막고 있으므로 부르지 않는다.
        table.focus({ preventScroll:true });
        const additive = event.ctrlKey || event.metaKey;
        const extending = event.shiftKey && gridSelection && gridSelection.anchor;
        const anchor = extending ? gridSelection.anchor : { row:point.row, col:point.col };
        const base = (additive || extending) && gridSelection ? gridSelection.keys : null;
        const mode = applyGridRange(point.kind, anchor, point, base, extending && !additive ? "replace" : null);
        if (point.kind === "all") return;                      // 모서리는 한 번에 전체를 고르고 끝난다
        /* 끌기는 document 에서 받는다. setPointerCapture 를 쓰면 포인터가 표를 벗어나도 이벤트가
           오지만, 그 대가로 뒤따르는 마우스 이벤트(click·dblclick)까지 캡처 대상(<table>)으로
           간다 — 그러면 더블클릭의 target 이 늘 <table> 이라 셀을 찾지 못한다.
           앱의 다른 끌기(모달 이동·분할선)와 같은 방식으로 맞춘다. */
        gridDrag = { kind:point.kind, anchor, base, mode, pointerId:event.pointerId };
        document.addEventListener("pointermove", onDragMove, true);
        document.addEventListener("pointerup", endDrag, true);
        document.addEventListener("pointercancel", endDrag, true);
      });

      /* 클릭은 고르는 일, 더블클릭은 자세히 보는 일 (ERD 의 테이블 카드와 같은 규칙이다).
         target 을 믿지 않고 좌표로 셀을 찾는다 — 더블클릭의 target 은 두 번의 누름·뗌이
         공유하는 조상이라 셀이 아니라 <table> 이 될 수 있다. */
      table.addEventListener("dblclick", (event) => {
        if (event.target.closest && event.target.closest(".db-sort-btn")) return;
        const node = document.elementFromPoint(event.clientX, event.clientY);
        const point = gridPointFrom(node) || gridPointFrom(event.target);
        if (!point || point.kind !== "cell" || !currentGrid) return;
        const cell = gridCellAt(point.row, point.col);
        if (!cell) return;
        showCellValue(currentGrid.columns[point.col] || "",
          cell.classList.contains("db-null") ? null : cell.textContent,
          cell.classList.contains("db-clipped"));
      });

      table.addEventListener("keydown", (event) => {
        const key = String(event.key || "").toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === "a"){
          event.preventDefault();
          applyGridRange("all", { row:0, col:0 }, { row:0, col:0 }, null, "replace");
          return;
        }
        if ((event.ctrlKey || event.metaKey) && key === "c"){
          event.preventDefault();
          copyGridSelection();
          return;
        }
        if (key === "escape" && gridSelection){
          event.preventDefault();
          clearGridSelection();
        }
      });
    };

    /* 고른 칸을 붙여 넣기 좋은 글자로 옮긴다(탭으로 열, 줄바꿈으로 행).
       NULL 은 빈칸으로 보낸다 — 붙여 넣는 곳에서 "NULL" 이라는 글자를 값으로 받으면 안 된다. */
    const copyGridSelection = () => {
      if (!gridSelection || !grid) return;
      const text = grid.gridSelectionToText(gridSelection.keys, gridColumnCount(), (row, col) => {
        const cell = gridCellAt(row, col);
        if (!cell || cell.classList.contains("db-null")) return "";
        return cell.textContent;
      });
      if (!text){ toast("복사할 칸이 없습니다.", 1800); return; }
      const done = gridSelection.keys.size.toLocaleString() + "칸을 복사했어요.";
      if (typeof copyDocumentMenuText === "function") copyDocumentMenuText(text, done);
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(done, 1800));
    };

    // 행을 tbody 에 채운다. startIndex 는 화면에 매기는 번호의 시작(더 보기로 이어 붙일 때 쓴다).
    const fillRows = (bodyEl, columns, rows, clippedCells, startIndex) => {
      const clipped = new Set((clippedCells || []).map(pair => pair[0] + "," + pair[1]));
      rows.forEach((row, rowIndex) => {
        const tr = el("tr");
        tr.append(el("td", "db-grid-index", String(startIndex + rowIndex + 1)));
        row.forEach((value, columnIndex) => {
          const td = el("td");
          const isClipped = clipped.has(rowIndex + "," + columnIndex);
          if (value === null){ td.classList.add("db-null"); td.textContent = "NULL"; }
          else td.textContent = String(value);
          if (isClipped) td.classList.add("db-clipped");
          td.title = "누르면 이 칸을 고르고 값 전체를 봅니다";
          tr.append(td);
        });
        bodyEl.append(tr);
      });
    };

    const appendRows = (columns, rows, clippedCells, startIndex) => {
      if (!currentGrid) return;
      clearGridSelection();          // 행이 늘면 고른 자리의 뜻이 달라진다
      fillRows(currentGrid.body, currentGrid.columns.length ? currentGrid.columns : columns,
        rows, clippedCells, startIndex);
      // 내보내기 대상도 화면과 같아야 한다.
      if (lastRows) rows.forEach(row => lastRows.push(row.map(value => value === null ? "" : String(value))));
    };

    const renderRows = (columns, rows, truncated, clippedCells, sortable) => {
      resultHost.innerHTML = "";
      closeValuePanel();
      lastRows = null;
      if (!columns.length){
        notice(resultHost, "결과 열이 없습니다", "", "");
        return;
      }
      const table = el("table", "db-grid");
      table.tabIndex = 0;
      table.setAttribute("aria-label", "결과 표. 칸을 끌어 고르고 Ctrl+C 로 복사합니다.");
      const head = el("thead");
      const headRow = el("tr");
      const indexHead = el("th", "db-grid-index", "#");
      indexHead.title = "누르면 표 전체를 고릅니다";
      headRow.append(indexHead);
      const sorted = sortable ? orderByState(sortable.sql) : null;
      const headCells = [];
      columns.forEach((name) => {
        const th = el("th", null, name);
        th.title = "누르면 이 열 전체를 고릅니다"
          + (sortable ? " · 정렬은 오른쪽 화살표를 누르세요" : "");
        if (sortable){
          const active = sorted && sorted.column === name;
          th.classList.add("db-sortable");
          if (active) th.classList.add("db-sorted");
          // 정렬은 열 고르기와 자리를 나눈다. 머리 전체가 정렬 버튼이면 열을 고를 자리가 없다.
          const sortButton = button(active ? (sorted.direction === "desc" ? "▼" : "▲") : "↕", "db-sort-btn",
            "이 컬럼으로 정렬합니다 — 편집기의 ORDER BY 를 고쳐 서버에 다시 묻습니다"
              + (active ? (sorted.direction === "desc" ? " (한 번 더 누르면 정렬 해제)" : " (한 번 더 누르면 내림차순)") : ""));
          sortButton.setAttribute("aria-label", name + " 컬럼으로 정렬");
          sortButton.addEventListener("click", (event) => {
            event.stopPropagation();
            sortable.onSort(name, sorted);
          });
          th.append(sortButton);
        }
        headCells.push(th);
        headRow.append(th);
      });
      head.append(headRow);
      const bodyEl = el("tbody");
      table.append(head, bodyEl);
      resultHost.append(table);
      currentGrid = { body:bodyEl, columns:columns.slice(), table, headRow, indexHead, headCells };
      attachGridSelection(table);
      fillRows(bodyEl, columns, rows, clippedCells, 0);
      if (truncated && !rows.length){
        resultHost.append(el("p", "db-truncated", "표시할 행이 없습니다."));
      }
      lastRows = [columns.slice()].concat(rows.map(row => row.map(value => value === null ? "" : String(value))));
      exportCsvButton.hidden = false;
      openSheetButton.hidden = false;
    };

    const clearResult = () => {
      resultHost.innerHTML = "";
      clearGridSelection();
      currentGrid = null;
      resultTabs.innerHTML = "";
      resultTabs.hidden = true;
      resultSets = [];
      closeValuePanel();
      lastRows = null;
      exportCsvButton.hidden = true;
      openSheetButton.hidden = true;
    };

    const showResultSet = (index) => {
      const entry = resultSets[index];
      Array.from(resultTabs.children).forEach((node, position) =>
        node.classList.toggle("active", position === index));
      if (!entry) return;
      if (entry.kind === "rows"){
        renderRows(entry.columns, entry.rows, entry.truncated, entry.clippedCells, sortableFor(entry));
        // 행이 없는 것과 "앞의 결과가 표시 예산을 다 써서 못 실었다"는 다른 사실이다.
        if (entry.budgetExhausted){
          resultHost.append(el("p", "db-truncated",
            "앞의 결과가 한 번에 보여 줄 수 있는 양을 다 써서 이 결과는 싣지 못했습니다"
              + (entry.hasMore ? " — 아래 ‘더 보기’로 불러오거나," : " —")
              + " 이 문장만 따로 실행해 주세요."));
        }
        attachMoreButton(entry);
        return;
      }
      // 표가 없는 문장(INSERT·UPDATE·오류)도 순서대로 보이게 같은 자리에 그린다.
      resultHost.innerHTML = "";
      closeValuePanel();
      currentGrid = null;
      lastRows = null;
      exportCsvButton.hidden = true;
      openSheetButton.hidden = true;
      const sql = entry.sql ? previewOf(entry.sql, 200) : "";
      if (entry.kind === "error"){
        notice(resultHost, messageFor(entry), sql, "error");
        return;
      }
      const affected = Number(entry.affected) || 0;
      const insertId = Number(entry.insertId) || 0;
      notice(resultHost, (entry.keyword || "").toUpperCase() + " — " + affected.toLocaleString() + "행 반영",
        sql + (insertId ? " · 새 자동 증가 값 " + insertId : ""), "");
    };

    /* 헤더 클릭 정렬 — 받아온 행을 다시 늘어놓는 대신 문장의 ORDER BY 를 고쳐 다시 묻는다.
       결과가 1000행에서 잘려 있으므로 클라이언트 정렬은 "전체에서 가장 큰 값"처럼 보이는 거짓말이 된다. */
    const sortableFor = (entry) => {
      // SELECT 계열이 아니거나(SHOW 는 ORDER BY 를 못 받는다) 문장이 잘려 왔으면 정렬을 걸지 않는다.
      if (!entry || !entry.sql || entry.sqlTruncated) return null;
      if (!["select", "with", "table"].includes(entry.keyword || "")) return null;
      return { sql:entry.sql, onSort:(column, current) => sortBy(entry, column, current) };
    };

    const sortBy = (entry, column, current) => {
      // 같은 컬럼을 누를 때마다 오름차순 → 내림차순 → 해제로 돈다(세 도구가 같은 규칙이다).
      let clause = identifierFor(column);
      if (current && current.column === column) clause = current.direction === "asc" ? clause + " DESC" : "";
      const next = applyOrderBy(entry.sql, clause);
      /* 편집기는 건드리지 않는다. 정렬은 결과를 보는 방식이지 사용자가 쓴 문장을 고치는 일이 아니다.
         대신 무엇이 적용됐는지 결과 줄에 적어, 편집기 내용과 지금 보는 결과가 다르다는 것을 알린다.
         quiet 로 표시해 정렬 클릭이 실행 이력을 채우지 않게 한다. */
      runQuery({
        sql:next,
        label:clause ? "정렬 · ORDER BY " + clause : "정렬 해제",
        quiet:true
      });
    };

    /* 더 보기 — 워커가 들고 있는 나머지 행을 이어 붙인다. 임의의 SQL 에 LIMIT/OFFSET 을
       덧붙이면 이미 LIMIT 이 있는 쿼리가 망가지므로, 다시 묻지 않고 보관분에서 떼어 온다. */
    const attachMoreButton = (entry) => {
      if (!entry || !entry.hasMore || typeof entry.set !== "number") return;
      const moreButton = button("더 보기", "db-btn db-btn-quiet db-more-btn",
        "보관해 둔 나머지 행을 이어서 보여 줍니다");
      const note = el("span", "db-more-note", "");
      const wrap = el("div", "db-more-wrap");
      wrap.append(moreButton, note);
      resultHost.append(wrap);

      moreButton.addEventListener("click", async () => {
        moreButton.disabled = true;
        moreButton.textContent = "읽는 중…";
        try {
          const body = document.querySelector(".db-result .db-grid tbody");
          const offset = body ? body.children.length : 0;
          const response = await jsonOf(await fetch("/db-page?id=" + encodeURIComponent(sessionId)
            + "&set=" + entry.set + "&offset=" + offset, { cache:"no-store" }));
          if (!response.ok){ note.textContent = messageFor(response.info); wrap.remove(); return; }
          const info = response.info;
          appendRows(info.columns || [], info.rows || [], info.clippedCells || [], offset);
          wrap.remove();
          if (info.hasMore) attachMoreButton({ set:entry.set, hasMore:true });
          else if (info.serverHasMore){
            resultHost.append(el("p", "db-truncated",
              "여기까지가 보관해 둔 " + info.total.toLocaleString() + "행입니다. 더 보려면 조건을 좁히거나 LIMIT 을 써 주세요."));
          }
        } catch(error){
          note.textContent = launcherMessage(error);
          moreButton.disabled = false;
          moreButton.textContent = "더 보기";
        }
      });
    };

    // 탭 이름만 보고 어느 문장의 결과인지 알 수 있게 문장 앞머리를 함께 적는다.
    const tabLabel = (entry, index) => {
      const head = (index + 1) + " · " + (previewOf(entry.sql || "", 34) || (entry.keyword || "").toUpperCase());
      if (entry.kind === "rows") return head + " · " + entry.rows.length + "행";
      if (entry.kind === "error") return head + " · 오류";
      return head + " · " + (Number(entry.affected) || 0) + "행 반영";
    };

    const statementSummary = (entry) => {
      const keyword = (entry.keyword || "").toUpperCase();
      if (entry.kind === "rows") return (keyword || "SELECT") + " " + entry.rows.length + "행";
      if (entry.kind === "error") return keyword + " 오류";
      return keyword + " " + (Number(entry.affected) || 0) + "행 반영";
    };

    /* failure 가 있으면 중간에 멈춘 실행이다. 그때까지의 결과도 함께 그린다 —
       앞의 문장은 이미 서버에서 실행됐으므로 무엇이 반영됐는지 보여 주어야 한다. */
    const renderStatements = (statements, label, elapsed, failure) => {
      clearResult();
      resultSets = (statements || []).filter(item => item && item.kind);
      const summary = resultSets.map(statementSummary).join(" · ");
      const stopped = failure
        ? (resultSets.length + "번째 문장에서 멈춤 — " + messageFor(failure))
        : "";
      resultStatus.textContent = [label, summary || "실행할 문장이 없습니다.", elapsed, stopped]
        .filter(Boolean).join(" — ");
      resultStatus.classList.toggle("db-result-failed", !!failure);
      if (resultSets.length > 1){
        resultTabs.hidden = false;
        resultSets.forEach((entry, index) => {
          const tab = button(tabLabel(entry, index), "db-result-tab");
          if (entry.kind === "error") tab.classList.add("db-result-tab-error");
          tab.title = entry.sql || "";
          tab.addEventListener("click", () => showResultSet(index));
          resultTabs.append(tab);
        });
      }
      // 멈춘 실행은 멈춘 자리를 먼저 보여 준다.
      if (resultSets.length) showResultSet(failure && Number.isInteger(failure.failedAt)
        ? Math.min(failure.failedAt, resultSets.length - 1) : 0);
    };

    /* 스키마 --------------------------------------------------------------- */

    const SCHEMA_GROUPS = [
      { type:"table", label:"Tables", icon:"table", expandable:true },
      { type:"view", label:"Views", icon:"view", expandable:true },
      { type:"procedure", label:"Procedures", icon:"procedure" },
      { type:"function", label:"Functions", icon:"function" },
      { type:"event", label:"Events", icon:"event" }
    ];
    const expandedSchemaGroups = new Set(["table", "view"]);
    const expandedTables = new Set();
    const expandedTableSections = new Set();
    let selectedSchemaKey = "";
    let tableContextMenu = null;
    let closeErdModal = null;

    const schemaIcon = (kind, className) => {
      const icon = el("span", className || "db-schema-icon");
      icon.innerHTML = uiIcon(kind);
      return icon;
    };

    const schemaKey = (item) => String(item.type || "table") + ":" + String(item.table || "") + ":" + String(item.name || "");

    const setSchemaSelection = (item) => {
      selectedSchemaKey = item ? schemaKey(item) : "";
      tableList.querySelectorAll(".db-table-row").forEach((row) =>
        row.classList.toggle("selected", row.dataset.schemaKey === selectedSchemaKey));
    };

    const setTableSelection = (name) => setSchemaSelection({ type:"table", name });

    const closeTableContextMenu = () => {
      if (!tableContextMenu) return;
      window.removeEventListener("pointerdown", onTableContextPointerDown, true);
      window.removeEventListener("keydown", onTableContextKey, true);
      window.removeEventListener("resize", closeTableContextMenu);
      tableContextMenu.remove();
      tableContextMenu = null;
    };

    const onTableContextPointerDown = (event) => {
      if (!tableContextMenu || tableContextMenu.contains(event.target)) return;
      closeTableContextMenu();
    };

    const onTableContextKey = (event) => {
      if (event.key === "Escape"){
        event.preventDefault();
        closeTableContextMenu();
      }
    };

    const openTableContextMenu = (item, x, y) => {
      closeTableContextMenu();
      const menu = el("div", "db-table-context-menu");
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", item.name + " 작업");
      const infoItem = button("", "db-table-context-item", "테이블 구조와 컬럼 정보를 봅니다");
      infoItem.setAttribute("role", "menuitem");
      infoItem.append(schemaIcon("info", "db-table-context-icon"), document.createTextNode("테이블 정보"));
      infoItem.addEventListener("click", () => {
        closeTableContextMenu();
        setSchemaSelection(item);
        openTableInfoModal(item.name);
      });
      menu.append(infoItem);
      document.body.append(menu);
      const bounds = menu.getBoundingClientRect();
      menu.style.left = Math.max(6, Math.min(x, window.innerWidth - bounds.width - 6)) + "px";
      menu.style.top = Math.max(6, Math.min(y, window.innerHeight - bounds.height - 6)) + "px";
      tableContextMenu = menu;
      window.addEventListener("pointerdown", onTableContextPointerDown, true);
      window.addEventListener("keydown", onTableContextKey, true);
      window.addEventListener("resize", closeTableContextMenu);
      requestAnimationFrame(() => infoItem.focus());
    };

    const showSchemaObject = async (item) => {
      setSchemaSelection(item);
      clearResult();
      resultStatus.textContent = item.name + " 정의를 읽는 중…";
      try {
        const url = "/db-object?id=" + encodeURIComponent(sessionId)
          + "&kind=" + encodeURIComponent(item.type) + "&name=" + encodeURIComponent(item.name)
          + "&database=" + encodeURIComponent(currentDatabase);
        const response = await jsonOf(await fetch(url, { cache:"no-store" }));
        if (!response.ok) throw new Error(messageFor(response.info));
        const labels = { procedure:"프로시저", function:"함수", event:"이벤트", trigger:"트리거" };
        const ddl = String(response.info.ddl || "");
        const card = el("section", "db-schema-definition");
        const head = el("div", "db-schema-definition-head");
        const heading = el("div", "db-schema-definition-title");
        heading.append(schemaIcon(item.type, "db-schema-definition-icon"), el("strong", null, item.name));
        const copy = button("정의 복사", "db-btn db-btn-quiet");
        copy.disabled = !ddl;
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(ddl); toast("정의를 복사했어요.", 1800); }
          catch(_){ toast("정의를 복사하지 못했습니다.", 2200); }
        });
        head.append(heading, el("span", "spacer", null), copy);
        card.append(head, el("pre", "db-schema-definition-ddl", ddl || "정의문이 없습니다."));
        resultHost.append(card);
        resultStatus.textContent = (labels[item.type] || "객체") + " · " + item.name
          + (item.table ? " · 테이블 " + item.table : "");
      } catch(error){
        clearResult();
        resultStatus.textContent = launcherMessage(error);
      }
    };

    const tableSection = (item, kind, label, icon, values, renderItem) => {
      const section = el("section", "db-table-child-group");
      const key = item.type + ":" + item.name + ":" + kind;
      const open = expandedTableSections.has(key);
      const toggle = button("", "db-table-child-group-row", label + " 펼치기/접기");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.append(
        schemaIcon(open ? "chevronDown" : "chevronRight", "db-schema-chevron"),
        schemaIcon(icon, "db-table-child-group-icon"),
        el("span", "db-schema-group-label", label),
        el("span", "db-schema-group-count", String(values.length))
      );
      const list = el("div", "db-table-child-items");
      list.hidden = !open;
      if (values.length) values.forEach((value) => list.append(renderItem(value)));
      else list.append(el("p", "db-empty", label + "가 없습니다."));
      toggle.addEventListener("click", () => {
        const opening = list.hidden;
        list.hidden = !opening;
        toggle.setAttribute("aria-expanded", String(opening));
        toggle.firstElementChild.innerHTML = uiIcon(opening ? "chevronDown" : "chevronRight");
        if (opening) expandedTableSections.add(key); else expandedTableSections.delete(key);
      });
      section.append(toggle, list);
      return section;
    };

    const fillTableChildren = async (item, host) => {
      if (host.dataset.loaded === "1") return;
      host.innerHTML = "";
      host.append(el("p", "db-empty", "하위 구조를 읽는 중…"));
      try {
        const info = await loadTableChildrenFor(item.name);
        host.innerHTML = "";
        const columnNode = (column) => {
          const node = button("", "db-column-item",
            column.name + " " + column.type + (column.nullable ? "" : " NOT NULL")
              + (column.comment ? " — " + column.comment : ""));
          if (column.key === "PRI") node.classList.add("db-column-key");
          node.append(schemaIcon(column.key === "PRI" ? "key" : "column", "db-column-icon"),
            el("span", "db-column-name", column.name), el("span", "db-column-type", column.type));
          node.addEventListener("click", () => insertIntoEditor(identifierFor(column.name)));
          return node;
        };
        const indexNode = (index) => {
          const columns = (index.columns || []).map(column => column.name || "함수식").join(", ");
          const node = button("", "db-column-item", index.name + " — " + columns);
          node.append(schemaIcon(index.name === "PRIMARY" ? "key" : "index", "db-column-icon"),
            el("span", "db-column-name", index.name),
            el("span", "db-column-type", (index.unique ? "UNIQUE · " : "") + index.type + " · " + columns));
          node.addEventListener("click", () => openTableInfoModal(item.name, "indexes"));
          return node;
        };
        const foreignKeyNode = (foreignKey) => {
          const local = (foreignKey.columns || []).map(column => column.local).join(", ");
          const referenced = (foreignKey.columns || []).map(column => column.referenced).join(", ");
          const detail = local + " · " + foreignKey.referencedDatabase + "." + foreignKey.referencedTable + "(" + referenced + ")";
          const node = button("", "db-column-item", foreignKey.name + " — " + detail);
          node.append(schemaIcon("foreignKey", "db-column-icon"), el("span", "db-column-name", foreignKey.name),
            el("span", "db-column-type", detail));
          node.addEventListener("click", () => openTableInfoModal(item.name, "foreignKeys"));
          return node;
        };
        const triggerNode = (trigger) => {
          const node = button("", "db-column-item", trigger.name + " — " + trigger.timing + " " + trigger.event);
          node.append(schemaIcon("trigger", "db-column-icon"), el("span", "db-column-name", trigger.name),
            el("span", "db-column-type", trigger.timing + " " + trigger.event));
          node.addEventListener("click", () => showSchemaObject(trigger));
          return node;
        };
        host.append(tableSection(item, "columns", "Columns", "column", info.columns || [], columnNode));
        if (item.type === "table"){
          host.append(
            tableSection(item, "indexes", "Indexes", "index", info.indexes || [], indexNode),
            tableSection(item, "foreignKeys", "Foreign Keys", "foreignKey", info.foreignKeys || [], foreignKeyNode),
            tableSection(item, "triggers", "Triggers", "trigger", info.triggers || [], triggerNode)
          );
        }
        host.dataset.loaded = "1";
      } catch(error){
        host.innerHTML = "";
        host.append(el("p", "db-empty", launcherMessage(error)));
      }
    };

    const renderTableList = () => {
      closeTableContextMenu();
      const needle = tableFilter.value.trim().toLowerCase();
      const shown = needle ? schemaObjects.filter(item => item.name.toLowerCase().includes(needle)) : schemaObjects;
      tableList.innerHTML = "";
      if (!currentDatabase){
        tableList.append(el("p", "db-empty", "데이터베이스를 골라 주세요."));
        return;
      }
      if (needle && !shown.length){
        tableList.append(el("p", "db-empty", "찾는 이름의 스키마 객체가 없습니다."));
        return;
      }
      SCHEMA_GROUPS.forEach((group) => {
        const allItems = schemaObjects.filter(item => item.type === group.type);
        const items = shown.filter(item => item.type === group.type);
        if (needle && !items.length) return;

        const groupHost = el("section", "db-schema-group");
        const groupOpen = expandedSchemaGroups.has(group.type);
        const groupToggle = button("", "db-schema-group-row", group.label + " 펼치기/접기");
        groupToggle.setAttribute("aria-expanded", String(groupOpen));
        groupToggle.append(
          schemaIcon(groupOpen ? "chevronDown" : "chevronRight", "db-schema-chevron"),
          schemaIcon(group.icon, "db-schema-group-icon"),
          el("span", "db-schema-group-label", group.label),
          el("span", "db-schema-group-count", needle ? items.length + "/" + allItems.length : String(allItems.length))
        );
        groupToggle.addEventListener("click", () => {
          if (expandedSchemaGroups.has(group.type)) expandedSchemaGroups.delete(group.type);
          else expandedSchemaGroups.add(group.type);
          renderTableList();
        });
        groupHost.append(groupToggle);

        if (groupOpen){
          const entries = el("div", "db-schema-group-items");
          if (!items.length) entries.append(el("p", "db-empty", group.label + "가 없습니다."));
          items.forEach((item) => {
            const entry = el("div", "db-table-entry");
            const row = el("div", "db-table-row");
            row.dataset.schemaKey = schemaKey(item);
            row.classList.toggle("selected", selectedSchemaKey === schemaKey(item));

            const tableKey = item.type + ":" + item.name;
            const tableOpen = group.expandable && expandedTables.has(tableKey);
            const toggle = button("", "db-table-toggle", "하위 구조 펼치기/접기");
            toggle.setAttribute("aria-expanded", String(tableOpen));
            toggle.append(schemaIcon(tableOpen ? "chevronDown" : "chevronRight", "db-schema-chevron"));
            if (!group.expandable){ toggle.disabled = true; toggle.classList.add("placeholder"); }
            const name = button("", "db-table-item", item.comment || item.name);
            name.dataset.kind = item.type;
            name.append(schemaIcon(group.icon, "db-table-object-icon"), el("span", "db-table-name", item.name));
            if (item.type === "function" && item.dataType) name.append(el("span", "db-table-object-meta", item.dataType));
            if (item.type === "event" && item.status) name.append(el("span", "db-table-object-meta", item.status));
            name.addEventListener("click", () => {
              setSchemaSelection(item);
              if (item.type === "table" || item.type === "view") showTable(item.name);
              else showSchemaObject(item);
            });
            if (group.expandable){
              name.setAttribute("aria-haspopup", "menu");
              name.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                setSchemaSelection(item);
                openTableContextMenu(item, event.clientX, event.clientY);
              });
              name.addEventListener("keydown", (event) => {
                if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                event.preventDefault();
                const bounds = name.getBoundingClientRect();
                setSchemaSelection(item);
                openTableContextMenu(item, bounds.left + 18, bounds.bottom - 2);
              });
            }

            row.append(toggle, name);
            const childHost = el("div", "db-table-children");
            childHost.hidden = !tableOpen;
            entry.append(row, childHost);
            entries.append(entry);

            if (tableOpen) fillTableChildren(item, childHost);
            toggle.addEventListener("click", () => {
              if (!group.expandable) return;
              const opening = childHost.hidden;
              childHost.hidden = !opening;
              toggle.setAttribute("aria-expanded", String(opening));
              toggle.innerHTML = "";
              toggle.append(schemaIcon(opening ? "chevronDown" : "chevronRight", "db-schema-chevron"));
              if (opening){
                expandedTables.add(tableKey);
                expandedTableSections.add(item.type + ":" + item.name + ":columns");
                fillTableChildren(item, childHost);
              } else expandedTables.delete(tableKey);
            });
          });
          groupHost.append(entries);
        }
        tableList.append(groupHost);
      });
    };

    // 트리를 펼칠 때만 하위 구조를 읽고, 다시 펼칠 때는 같은 응답을 재사용한다.
    const loadTableChildrenFor = async (name) => {
      if (tableChildrenCache.has(name)) return tableChildrenCache.get(name);
      const url = "/db-table?id=" + encodeURIComponent(sessionId)
        + "&name=" + encodeURIComponent(name) + "&mode=children";
      const response = await jsonOf(await fetch(url, { cache:"no-store" }));
      if (!response.ok) throw new Error(messageFor(response.info));
      const info = response.info || {};
      tableChildrenCache.set(name, info);
      return info;
    };

    const loadSchema = async () => {
      const response = await jsonOf(await fetch("/db-schema?id=" + encodeURIComponent(sessionId), { cache:"no-store" }));
      if (!response.ok){ toast(messageFor(response.info), 4000); return; }
      const info = response.info;
      const previousDatabase = currentDatabase;
      currentDatabase = info.current || "";
      erdButton.disabled = !currentDatabase;
      schemaObjects = [
        ...(Array.isArray(info.tables) ? info.tables : []),
        ...(Array.isArray(info.routines) ? info.routines : []),
        ...(Array.isArray(info.events) ? info.events : [])
      ];
      tableChildrenCache.clear();
      if (previousDatabase !== currentDatabase){
        selectedSchemaKey = "";
        expandedTables.clear();
        expandedTableSections.clear();
      }
      databaseSelect.innerHTML = "";
      if (!currentDatabase) databaseSelect.append(new Option("(선택 안 함)", ""));
      (info.databases || []).forEach((name) => databaseSelect.append(new Option(name, name)));
      databaseSelect.value = currentDatabase;
      renderTableList();
      refreshCompletionWords();
      loadSchemaColumns();
    };

    // 자동완성 후보. 테이블마다 따로 물으면 느리고, 아직 펼쳐 보지 않은 테이블은 후보에 못 든다.
    // 실패하거나 상한을 넘겨도 접속 자체는 그대로 쓴다 — 자동완성만 덜 똑똑해진다.
    const loadSchemaColumns = async () => {
      schemaColumns = [];
      if (!currentDatabase) return;
      try {
        const response = await jsonOf(await fetch("/db-schema?id=" + encodeURIComponent(sessionId)
          + "&mode=columns", { cache:"no-store" }));
        if (response.ok) schemaColumns = response.info.columns || [];
      } catch(_){ /* 자동완성 후보가 없을 뿐이다 */ }
      refreshCompletionWords();
    };

    const openErdModal = async () => {
      if (!sessionId || !currentDatabase || document.querySelector(".db-erd-modal")) return;
      const modal = el("div", "modal db-erd-modal");
      const card = el("div", "modal-card db-erd-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", currentDatabase + " ERD 다이어그램");
      const head = el("div", "db-erd-head");
      const heading = el("div", "db-erd-heading");
      heading.append(schemaIcon("graph", "db-erd-heading-icon"), el("h3", null, currentDatabase + " ERD"));
      const summary = el("p", "sub", "테이블 관계를 읽는 중…");
      heading.append(summary);
      const close = button("", "db-table-modal-close", "닫기");
      close.setAttribute("aria-label", "닫기");
      close.innerHTML = uiIcon("close");
      head.append(heading, close);

      const tools = el("div", "db-erd-tools");
      const search = input("search", "", "테이블 찾기");
      search.className = "db-erd-search";
      search.setAttribute("aria-label", "ERD 테이블 찾기");
      const searchCount = el("span", "db-erd-search-count", "");
      const zoomOut = button("", "db-erd-tool-btn", "축소"); zoomOut.innerHTML = uiIcon("zoomOut");
      const zoomLabel = button("100%", "db-erd-zoom-label", "배율을 100%로 되돌립니다");
      const zoomIn = button("", "db-erd-tool-btn", "확대"); zoomIn.innerHTML = uiIcon("zoomIn");
      const fit = button("화면 맞춤", "db-btn db-btn-quiet");
      tools.append(search, searchCount, el("span", "spacer", null), zoomOut, zoomLabel, zoomIn, fit);

      const body = el("div", "db-erd-body");
      const viewport = el("div", "db-erd-viewport");
      viewport.tabIndex = 0;
      viewport.setAttribute("aria-label", "ERD 캔버스. 마우스로 끌어 이동하고 휠로 확대하거나 축소합니다.");
      const loading = el("p", "db-erd-loading", "테이블과 외래키를 읽는 중…");
      viewport.append(loading);
      const relationDetail = el("aside", "db-erd-relation-detail");
      relationDetail.hidden = true;
      body.append(viewport, relationDetail);
      card.append(head, tools, body);
      modal.append(card);
      document.body.append(modal);
      if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

      let state = { scale:1, x:0, y:0 }, layout = null, world = null, cards = new Map(), edgeNodes = [];
      let panning = null;
      const applyTransform = () => {
        if (!world) return;
        world.style.transform = "matrix(" + state.scale + ",0,0," + state.scale + "," + state.x + "," + state.y + ")";
        zoomLabel.textContent = Math.round(state.scale * 100) + "%";
      };
      const fitDiagram = () => {
        if (!layout || !world) return;
        const rect = viewport.getBoundingClientRect();
        const scale = Math.max(.12, Math.min(1.35, (rect.width - 36) / layout.width, (rect.height - 36) / layout.height));
        state = { scale, x:(rect.width - layout.width * scale) / 2, y:(rect.height - layout.height * scale) / 2 };
        applyTransform();
      };
      const zoomAt = (nextScale, clientX, clientY) => {
        if (!world) return;
        const rect = viewport.getBoundingClientRect();
        const pointX = clientX == null ? rect.width / 2 : clientX - rect.left;
        const pointY = clientY == null ? rect.height / 2 : clientY - rect.top;
        const localX = (pointX - state.x) / state.scale;
        const localY = (pointY - state.y) / state.scale;
        const scale = Math.max(.12, Math.min(2.5, nextScale));
        state.x = pointX - localX * scale;
        state.y = pointY - localY * scale;
        state.scale = scale;
        applyTransform();
      };
      const centerNode = (node) => {
        const rect = viewport.getBoundingClientRect();
        state.x = rect.width / 2 - (node.x + node.width / 2) * state.scale;
        state.y = rect.height / 2 - (node.y + node.height / 2) * state.scale;
        applyTransform();
      };
      const forceClose = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
        closeErdModal = null;
      };
      const onKey = (event) => {
        if (event.key === "Escape" && !document.querySelector(".db-table-modal,.db-value-modal")){
          event.preventDefault();
          event.stopPropagation();
          forceClose();
        }
      };
      closeErdModal = forceClose;
      close.addEventListener("click", forceClose);
      modal.addEventListener("click", event => { if (event.target === modal) forceClose(); });
      window.addEventListener("keydown", onKey, true);
      zoomOut.addEventListener("click", () => zoomAt(state.scale / 1.2));
      zoomIn.addEventListener("click", () => zoomAt(state.scale * 1.2));
      zoomLabel.addEventListener("click", () => zoomAt(1));
      fit.addEventListener("click", fitDiagram);
      viewport.addEventListener("wheel", (event) => {
        if (!world) return;
        event.preventDefault();
        zoomAt(state.scale * Math.exp(-event.deltaY * .0014), event.clientX, event.clientY);
      }, { passive:false });
      viewport.addEventListener("pointerdown", (event) => {
        if (!world || event.button !== 0 || event.target.closest(".db-erd-table,.db-erd-edge-hit,.db-erd-relation-detail")) return;
        panning = { id:event.pointerId, x:event.clientX, y:event.clientY, startX:state.x, startY:state.y };
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("panning");
      });
      viewport.addEventListener("pointermove", (event) => {
        if (!panning || panning.id !== event.pointerId) return;
        state.x = panning.startX + event.clientX - panning.x;
        state.y = panning.startY + event.clientY - panning.y;
        applyTransform();
      });
      const endPan = (event) => {
        if (!panning || panning.id !== event.pointerId) return;
        panning = null;
        viewport.classList.remove("panning");
        try { viewport.releasePointerCapture(event.pointerId); } catch(_){}
      };
      viewport.addEventListener("pointerup", endPan);
      viewport.addEventListener("pointercancel", endPan);

      try {
        const response = await jsonOf(await fetch("/db-schema?id=" + encodeURIComponent(sessionId)
          + "&mode=erd", { cache:"no-store" }));
        if (!modal.isConnected) return;
        if (!response.ok) throw new Error(messageFor(response.info));
        const info = response.info || {};
        const tables = Array.isArray(info.tables) ? info.tables : [];
        const relationships = Array.isArray(info.relationships) ? info.relationships : [];
        const drawableRelationships = relationships.filter(relationship => !relationship.targetDatabase
          || relationship.targetDatabase === info.database);
        layout = erdLayout(tables, drawableRelationships);
        summary.textContent = "테이블 " + tables.length + "개 · 외래키 " + relationships.length + "개"
          + (info.truncated ? " · 일부 항목 생략" : "");
        viewport.innerHTML = "";
        if (!tables.length){
          viewport.append(el("p", "db-erd-loading", "다이어그램에 표시할 테이블이 없습니다."));
          return;
        }
        world = el("div", "db-erd-world");
        world.style.width = layout.width + "px";
        world.style.height = layout.height + "px";
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("class", "db-erd-lines");
        svg.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
        svg.setAttribute("width", String(layout.width));
        svg.setAttribute("height", String(layout.height));
        const defs = document.createElementNS(svgNs, "defs");
        const marker = document.createElementNS(svgNs, "marker");
        const markerId = "db-erd-arrow-" + Date.now();
        marker.setAttribute("id", markerId); marker.setAttribute("viewBox", "0 0 10 10");
        marker.setAttribute("refX", "9"); marker.setAttribute("refY", "5");
        marker.setAttribute("markerWidth", "7"); marker.setAttribute("markerHeight", "7"); marker.setAttribute("orient", "auto");
        const arrow = document.createElementNS(svgNs, "path");
        arrow.setAttribute("d", "M0 0L10 5L0 10z");
        marker.append(arrow); defs.append(marker); svg.append(defs);
        const nodeByName = new Map(layout.nodes.map(node => [node.table.name, node]));
        const foreignColumns = new Map();
        relationships.forEach((relationship) => {
          if (!foreignColumns.has(relationship.sourceTable)) foreignColumns.set(relationship.sourceTable, new Set());
          (relationship.columns || []).forEach(column => foreignColumns.get(relationship.sourceTable).add(column.source));
        });
        const selectRelationship = (relationship, index) => {
          edgeNodes.forEach((entry, position) => entry.classList.toggle("selected", position === index));
          cards.forEach((cardNode, name) => cardNode.classList.toggle("related",
            name === relationship.sourceTable || name === relationship.targetTable));
          relationDetail.innerHTML = "";
          const detailHead = el("div", "db-erd-relation-head");
          detailHead.append(schemaIcon("foreignKey", "db-erd-relation-icon"),
            el("strong", null, relationship.name), el("span", "spacer", null));
          const detailClose = button("", "db-table-modal-close", "관계 정보 닫기"); detailClose.innerHTML = uiIcon("close");
          detailHead.append(detailClose);
          const mapping = el("div", "db-erd-relation-mapping");
          (relationship.columns || []).forEach(column => mapping.append(el("p", null,
            relationship.sourceTable + "." + column.source + "  참조  "
              + relationship.targetDatabase + "." + relationship.targetTable + "." + column.target)));
          const rules = el("p", "db-erd-relation-rules",
            "ON DELETE " + relationship.deleteRule + " · ON UPDATE " + relationship.updateRule);
          const edit = button("외래키 정보", "db-btn db-btn-quiet");
          edit.addEventListener("click", () => openTableInfoModal(relationship.sourceTable, "foreignKeys"));
          relationDetail.append(detailHead, mapping, rules, edit);
          relationDetail.hidden = false;
          detailClose.addEventListener("click", () => {
            relationDetail.hidden = true;
            edgeNodes.forEach(entry => entry.classList.remove("selected"));
            cards.forEach(cardNode => cardNode.classList.remove("related"));
          });
        };
        drawableRelationships.forEach((relationship) => {
          const source = nodeByName.get(relationship.sourceTable), target = nodeByName.get(relationship.targetTable);
          if (!source || !target) return;
          const sourceCenter = source.x + source.width / 2, targetCenter = target.x + target.width / 2;
          const toLeft = targetCenter <= sourceCenter;
          const sx = toLeft ? source.x : source.x + source.width;
          const tx = toLeft ? target.x + target.width : target.x;
          const sy = source.y + Math.min(source.height - 18, 58);
          const ty = target.y + Math.min(target.height - 18, 58);
          const bend = Math.max(42, Math.abs(tx - sx) * .48);
          const d = "M" + sx + " " + sy + " C" + (sx + (toLeft ? -bend : bend)) + " " + sy
            + " " + (tx + (toLeft ? bend : -bend)) + " " + ty + " " + tx + " " + ty;
          const visible = document.createElementNS(svgNs, "path");
          visible.setAttribute("class", "db-erd-edge"); visible.setAttribute("d", d);
          visible.setAttribute("marker-end", "url(#" + markerId + ")");
          const hit = document.createElementNS(svgNs, "path");
          hit.setAttribute("class", "db-erd-edge-hit"); hit.setAttribute("d", d);
          hit.setAttribute("tabindex", "0"); hit.setAttribute("role", "button");
          hit.setAttribute("aria-label", relationship.name + " 외래키 관계");
          const edgeIndex = edgeNodes.length;
          const choose = (event) => { event.stopPropagation(); selectRelationship(relationship, edgeIndex); };
          hit.addEventListener("click", choose);
          hit.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " "){ event.preventDefault(); choose(event); } });
          const group = document.createElementNS(svgNs, "g");
          group._relationship = relationship;
          group.append(visible, hit); svg.append(group); edgeNodes.push(group);
        });
        world.append(svg);
        layout.nodes.forEach((node) => {
          const table = node.table;
          const cardNode = el("article", "db-erd-table");
          cardNode.tabIndex = 0;
          cardNode.setAttribute("role", "button");
          cardNode.setAttribute("aria-label", table.name + " 테이블 정보 열기");
          cardNode.style.left = node.x + "px"; cardNode.style.top = node.y + "px";
          cardNode.style.width = node.width + "px"; cardNode.style.height = node.height + "px";
          const tableHead = el("div", "db-erd-table-head");
          tableHead.append(schemaIcon("table", "db-erd-table-icon"), el("strong", null, table.name),
            el("span", "db-erd-column-count", String((table.columns || []).length)));
          cardNode.append(tableHead);
          const fkSet = foreignColumns.get(table.name) || new Set();
          (table.columns || []).slice(0, layout.maxColumns).forEach((column) => {
            const row = el("div", "db-erd-column");
            const keyKind = column.key === "PRI" ? "key" : (fkSet.has(column.name) ? "foreignKey" : "column");
            if (column.key === "PRI") row.classList.add("primary");
            if (fkSet.has(column.name)) row.classList.add("foreign");
            row.append(schemaIcon(keyKind, "db-erd-column-icon"), el("span", "db-erd-column-name", column.name),
              el("span", "db-erd-column-type", column.type),
              el("span", "db-erd-nullable", column.nullable ? "NULL" : ""));
            cardNode.append(row);
          });
          if ((table.columns || []).length > layout.maxColumns)
            cardNode.append(el("div", "db-erd-more-columns", "+ " + ((table.columns || []).length - layout.maxColumns) + "개 컬럼"));
          const openInfo = () => openTableInfoModal(table.name);
          cardNode.addEventListener("dblclick", openInfo);
          cardNode.addEventListener("keydown", event => { if (event.key === "Enter"){ event.preventDefault(); openInfo(); } });
          cardNode.addEventListener("click", () => {
            relationDetail.hidden = true;
            cards.forEach((other, name) => {
              other.classList.remove("related");
              other.classList.toggle("selected", name === table.name);
            });
            edgeNodes.forEach((entry) => {
              const relationship = entry._relationship;
              entry.classList.remove("selected");
              entry.classList.toggle("related", relationship
                && (relationship.sourceTable === table.name || relationship.targetTable === table.name));
            });
          });
          world.append(cardNode); cards.set(table.name, cardNode);
        });
        viewport.append(world);
        const filterCards = () => {
          const query = search.value.trim().toLowerCase();
          const matches = layout.nodes.filter(node => !query || node.table.name.toLowerCase().includes(query));
          cards.forEach((cardNode, name) => {
            cardNode.classList.toggle("search-match", !!query && name.toLowerCase().includes(query));
            cardNode.classList.toggle("search-dim", !!query && !name.toLowerCase().includes(query));
          });
          searchCount.textContent = query ? matches.length + "개" : "";
          return matches;
        };
        search.addEventListener("input", filterCards);
        search.addEventListener("keydown", event => {
          if (event.key !== "Enter") return;
          const first = filterCards()[0];
          if (first){ event.preventDefault(); centerNode(first); cards.get(first.table.name).focus(); }
        });
        requestAnimationFrame(() => { fitDiagram(); search.focus(); });
      } catch(error){
        viewport.innerHTML = "";
        notice(viewport, "ERD를 만들지 못했습니다", launcherMessage(error), "error");
        summary.textContent = "메타데이터를 읽지 못했습니다.";
      }
    };

    const openTableInfoModal = async (name, initialTab) => {
      if (!sessionId || document.querySelector(".db-table-modal")) return;
      const modal = el("div", "modal db-table-modal");
      const card = el("div", "modal-card db-table-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", name + " 테이블 정보");
      const head = el("div", "db-table-modal-head");
      const headIcon = schemaIcon("table", "db-table-modal-icon");
      const heading = el("div", "db-table-modal-heading");
      const title = el("h3", null, name);
      const subtitle = el("p", "sub", "테이블 정보를 읽는 중…");
      heading.append(title, subtitle);
      const closeButton = button("", "db-table-modal-close", "닫기");
      closeButton.setAttribute("aria-label", "닫기");
      closeButton.innerHTML = uiIcon("close");
      head.append(headIcon, heading, closeButton);
      const body = el("div", "db-table-modal-body");
      body.append(el("p", "db-table-modal-loading", "테이블 구조를 읽는 중…"));
      card.append(head, body);
      modal.append(card);
      document.body.append(modal);
      if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

      let draft = null, base = null, originalDdl = "", applying = false, initialSnapshot = "";
      const snapshot = () => draft ? JSON.stringify({
        name:draft.name, comment:draft.comment,
        columns:draft.columns.map(column => ({
          originalName:column.originalName, deleted:column.deleted, isNew:column.isNew,
          ...comparableColumn(column)
        })),
        indexes:draft.indexes.map(index => ({ originalName:index.originalName, deleted:index.deleted, isNew:index.isNew, ...comparableIndex(index) })),
        foreignKeys:draft.foreignKeys.map(foreignKey => ({
          originalName:foreignKey.originalName, deleted:foreignKey.deleted, isNew:foreignKey.isNew,
          ...comparableForeignKey(foreignKey)
        }))
      }) : "";
      const forceClose = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
      };
      const requestClose = async () => {
        if (applying) return;
        if (draft && snapshot() !== initialSnapshot && typeof confirmDialog === "function"){
          const ok = await confirmDialog("적용하지 않은 테이블 구조 변경을 버릴까요?", "버리기", "계속 편집");
          if (!ok) return;
        }
        forceClose();
      };
      const onKey = (event) => {
        if (event.key === "Escape" && !document.querySelector(".db-value-modal")){
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }
      };
      window.addEventListener("keydown", onKey, true);
      closeButton.addEventListener("click", requestClose);
      modal.addEventListener("click", (event) => { if (event.target === modal) requestClose(); });

      try {
        const url = "/db-table?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(name);
        const [infoResponse, ddlResponse] = await Promise.all([
          jsonOf(await fetch(url + "&mode=info", { cache:"no-store" })),
          jsonOf(await fetch(url + "&mode=ddl", { cache:"no-store" }))
        ]);
        if (!infoResponse.ok || !ddlResponse.ok) throw new Error(messageFor((!infoResponse.ok ? infoResponse : ddlResponse).info));
        const info = infoResponse.info;
        originalDdl = String(ddlResponse.info.ddl || "");
        const columns = (info.columns || []).map(columnDraft);
        const indexes = (info.indexes || []).map(indexDraft);
        const foreignKeys = (info.foreignKeys || []).map(foreignKeyDraft);
        base = {
          database:String(info.database || currentDatabase), name:String(info.name || name),
          comment:String(info.comment || ""), columns:columns.map(column => ({ originalName:column.originalName }))
        };
        draft = { name:base.name, comment:base.comment, columns, indexes, foreignKeys };
        initialSnapshot = snapshot();
        const editable = !readOnly && info.type === "table";
        title.textContent = info.name || name;
        subtitle.textContent = (info.type === "view" ? "뷰" : (info.engine || "테이블"))
          + " · 컬럼 " + columns.length + "개 · 인덱스 " + indexes.length + "개 · 외래키 " + foreignKeys.length + "개"
          + " · " + (editable ? "쓰기 허용" : "읽기 전용");
        headIcon.innerHTML = uiIcon(info.type === "view" ? "view" : "table");
        body.innerHTML = "";

        const tabs = el("div", "db-table-modal-tabs");
        const overviewTab = button("개요", "db-table-modal-tab active");
        const columnsTab = button("컬럼 " + columns.length, "db-table-modal-tab");
        const indexesTab = button("인덱스 " + indexes.length, "db-table-modal-tab");
        const foreignKeysTab = button("외래키 " + foreignKeys.length, "db-table-modal-tab");
        const ddlTab = button("DDL", "db-table-modal-tab");
        tabs.append(overviewTab, columnsTab, indexesTab, foreignKeysTab, ddlTab);
        const panels = el("div", "db-table-modal-panels");
        const overviewPanel = el("section", "db-table-modal-panel");
        const columnsPanel = el("section", "db-table-modal-panel");
        const indexesPanel = el("section", "db-table-modal-panel");
        const foreignKeysPanel = el("section", "db-table-modal-panel");
        const ddlPanel = el("section", "db-table-modal-panel");
        columnsPanel.hidden = true;
        indexesPanel.hidden = true;
        foreignKeysPanel.hidden = true;
        ddlPanel.hidden = true;
        panels.append(overviewPanel, columnsPanel, indexesPanel, foreignKeysPanel, ddlPanel);

        const switchTab = (tab, panel) => {
          [overviewTab, columnsTab, indexesTab, foreignKeysTab, ddlTab]
            .forEach(node => node.classList.toggle("active", node === tab));
          [overviewPanel, columnsPanel, indexesPanel, foreignKeysPanel, ddlPanel]
            .forEach(node => { node.hidden = node !== panel; });
        };
        overviewTab.addEventListener("click", () => switchTab(overviewTab, overviewPanel));
        columnsTab.addEventListener("click", () => switchTab(columnsTab, columnsPanel));
        indexesTab.addEventListener("click", () => switchTab(indexesTab, indexesPanel));
        foreignKeysTab.addEventListener("click", () => switchTab(foreignKeysTab, foreignKeysPanel));
        ddlTab.addEventListener("click", () => switchTab(ddlTab, ddlPanel));

        const tableNameInput = input("text", draft.name, "테이블 이름");
        tableNameInput.disabled = !editable;
        tableNameInput.maxLength = 64;
        const tableCommentInput = document.createElement("textarea");
        tableCommentInput.value = draft.comment;
        tableCommentInput.placeholder = "테이블 설명";
        tableCommentInput.disabled = !editable;
        tableCommentInput.maxLength = 2048;
        const overviewFields = el("div", "db-table-overview-fields");
        overviewFields.append(field("테이블 이름", tableNameInput), field("설명", tableCommentInput));
        const facts = el("dl", "db-table-facts");
        [
          ["종류", info.type === "view" ? "뷰" : "테이블"], ["엔진", info.engine || "—"],
          ["정렬 규칙", info.collation || "—"],
          ["예상 행 수", info.estimatedRows == null ? "—" : Number(info.estimatedRows).toLocaleString()],
          ["만든 시각", info.created || "—"], ["수정 시각", info.updated || "—"]
        ].forEach((pair) => facts.append(el("dt", null, pair[0]), el("dd", null, pair[1])));
        overviewPanel.append(overviewFields, facts);

        const columnsToolbar = el("div", "db-table-columns-toolbar");
        const addColumnButton = button("컬럼 추가", "db-btn db-btn-quiet");
        addColumnButton.disabled = !editable;
        columnsToolbar.append(el("p", null, "컬럼명·자료형·NULL·기본값·설명을 바꿀 수 있습니다."), addColumnButton);
        const columnList = el("div", "db-table-column-editor");
        columnsPanel.append(columnsToolbar, columnList);

        const indexesToolbar = el("div", "db-table-columns-toolbar");
        const addIndexButton = button("인덱스 추가", "db-btn db-btn-quiet");
        const addPrimaryButton = button("기본키 추가", "db-btn db-btn-quiet");
        const indexActions = el("div", "db-table-constraint-toolbar-actions");
        indexActions.append(addPrimaryButton, addIndexButton);
        addIndexButton.disabled = !editable;
        addPrimaryButton.disabled = !editable;
        indexesToolbar.append(el("p", null, "기본키와 보조 인덱스의 컬럼 순서·고유 여부·종류를 관리합니다."), indexActions);
        const indexList = el("div", "db-table-constraint-editor");
        indexesPanel.append(indexesToolbar, indexList);

        const foreignToolbar = el("div", "db-table-columns-toolbar");
        const addForeignButton = button("외래키 추가", "db-btn db-btn-quiet");
        addForeignButton.disabled = !editable;
        foreignToolbar.append(el("p", null, "로컬 컬럼과 참조 테이블 컬럼을 순서대로 연결합니다."), addForeignButton);
        const foreignList = el("div", "db-table-constraint-editor");
        foreignKeysPanel.append(foreignToolbar, foreignList);

        const ddlTools = el("div", "db-table-ddl-tools");
        const copyDdlButton = button("DDL 복사", "db-btn db-btn-quiet");
        const ddlPre = el("pre", "db-table-ddl", originalDdl);
        ddlTools.append(el("p", null, "서버가 돌려준 현재 CREATE 문입니다."), copyDdlButton);
        ddlPanel.append(ddlTools, ddlPre);
        copyDdlButton.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(originalDdl); toast("DDL을 복사했어요.", 1800); }
          catch(_){ toast("DDL을 복사하지 못했습니다.", 2200); }
        });

        const preview = el("section", "db-table-alter-preview");
        const previewHead = el("div", "db-table-alter-preview-head");
        previewHead.append(el("strong", null, "변경 SQL 미리보기"),
          el("span", "db-table-alter-note", editable ? "적용 전 실제 SQL을 확인하세요." : "이 접속에서는 정보를 보는 것만 가능합니다."));
        const issueList = el("div", "db-table-alter-issues");
        const sqlPre = el("pre", "db-table-alter-sql", "변경 사항이 없습니다.");
        preview.append(previewHead, issueList, sqlPre);
        const status = el("p", "db-table-alter-status", "");
        const actions = el("div", "modal-actions db-table-modal-actions");
        const cancel = button("닫기", "db-btn");
        const apply = button("변경 적용", "db-btn db-btn-primary");
        apply.disabled = true;
        if (!editable) apply.title = info.type === "view" ? "뷰 구조 편집은 1차 버전에서 지원하지 않습니다." : "읽기 전용 접속입니다.";
        actions.append(cancel, el("span", "spacer", null), apply);
        cancel.addEventListener("click", requestClose);

        let currentPlan = tableAlterPlan(base, draft);
        const refreshPreview = () => {
          currentPlan = tableAlterPlan(base, draft);
          issueList.innerHTML = "";
          currentPlan.errors.forEach(message => issueList.append(el("p", "error", message)));
          [...new Set(currentPlan.warnings)].forEach(message => issueList.append(el("p", "warning", message)));
          sqlPre.textContent = currentPlan.sql || (currentPlan.errors.length ? "오류를 고치면 SQL이 표시됩니다." : "변경 사항이 없습니다.");
          apply.disabled = !editable || applying || !currentPlan.sql || currentPlan.errors.length > 0;
        };
        tableNameInput.addEventListener("input", () => { draft.name = tableNameInput.value; refreshPreview(); });
        tableCommentInput.addEventListener("input", () => { draft.comment = tableCommentInput.value; refreshPreview(); });

        const columnSelect = (selected) => {
          const select = document.createElement("select");
          const choices = draft.columns.filter(column => !column.deleted).map(column => ({
            value:column.isNew ? column.name : column.originalName, label:column.name
          }));
          if (selected && !choices.some(choice => choice.value === selected))
            choices.unshift({ value:selected, label:selected + " (찾을 수 없음)" });
          choices.forEach(choice => select.append(new Option(choice.label, choice.value)));
          if (selected) select.value = selected;
          return select;
        };

        const renderIndexEditor = () => {
          indexList.innerHTML = "";
          draft.indexes.forEach((index, indexPosition) => {
            const cardNode = el("article", "db-table-constraint-card" + (index.deleted ? " deleted" : ""));
            const header = el("div", "db-table-constraint-head");
            const nameInput = input("text", index.name, "인덱스 이름");
            const primary = String(index.originalName || index.name).toUpperCase() === "PRIMARY";
            nameInput.disabled = !editable || index.deleted || primary;
            const typeSelect = document.createElement("select");
            ["BTREE", "HASH", "FULLTEXT", "SPATIAL"].forEach(value => typeSelect.append(new Option(value, value)));
            typeSelect.value = index.type;
            typeSelect.disabled = !editable || index.deleted || primary;
            const uniqueInput = input("checkbox", ""); uniqueInput.checked = primary || index.unique;
            uniqueInput.disabled = !editable || index.deleted || primary || index.type === "FULLTEXT" || index.type === "SPATIAL";
            const uniqueLabel = el("label", "db-table-constraint-check", "");
            uniqueLabel.append(uniqueInput, document.createTextNode(primary ? " 기본키" : " 고유"));
            const remove = button(index.deleted ? "복원" : "삭제", "db-btn db-btn-quiet db-table-column-remove");
            remove.disabled = !editable;
            header.append(nameInput, typeSelect, uniqueLabel, el("span", "spacer", null), remove);
            const parts = el("div", "db-table-constraint-parts");
            (index.columns || []).forEach((part, partPosition) => {
              const row = el("div", "db-table-index-part");
              const column = columnSelect(part.name);
              const prefix = input("number", part.prefix, "접두 길이"); prefix.min = "1";
              const order = document.createElement("select");
              order.append(new Option("오름차순", "ASC"), new Option("내림차순", "DESC")); order.value = part.order;
              const up = button("", "db-table-column-move-btn", "위로 이동"); up.innerHTML = uiIcon("chevronUp");
              const down = button("", "db-table-column-move-btn", "아래로 이동"); down.innerHTML = uiIcon("chevronDown");
              const del = button("제거", "db-btn db-btn-quiet db-table-constraint-part-remove");
              [column, prefix, order, up, down, del].forEach(node => {
                node.disabled = !editable || index.deleted || part.unsupported;
              });
              up.disabled = up.disabled || partPosition === 0;
              down.disabled = down.disabled || partPosition === index.columns.length - 1;
              row.append(column, prefix, order, up, down, del);
              parts.append(row);
              column.addEventListener("change", () => { part.name = column.value; refreshPreview(); });
              prefix.addEventListener("input", () => { part.prefix = prefix.value; refreshPreview(); });
              order.addEventListener("change", () => { part.order = order.value; refreshPreview(); });
              up.addEventListener("click", () => { index.columns.splice(partPosition - 1, 0, index.columns.splice(partPosition, 1)[0]); renderIndexEditor(); refreshPreview(); });
              down.addEventListener("click", () => { index.columns.splice(partPosition + 1, 0, index.columns.splice(partPosition, 1)[0]); renderIndexEditor(); refreshPreview(); });
              del.addEventListener("click", () => { index.columns.splice(partPosition, 1); renderIndexEditor(); refreshPreview(); });
            });
            const addPart = button("컬럼 추가", "db-btn db-btn-quiet db-table-constraint-add-part");
            addPart.disabled = !editable || index.deleted || !draft.columns.some(column => !column.deleted);
            addPart.addEventListener("click", () => {
              const first = draft.columns.find(column => !column.deleted);
              if (!first) return;
              index.columns.push({ name:first.isNew ? first.name : first.originalName, prefix:"", order:"ASC", unsupported:false });
              renderIndexEditor(); refreshPreview();
            });
            cardNode.append(header, parts, addPart);
            indexList.append(cardNode);
            nameInput.addEventListener("input", () => { index.name = nameInput.value; refreshPreview(); });
            typeSelect.addEventListener("change", () => {
              index.type = typeSelect.value;
              if (index.type === "FULLTEXT" || index.type === "SPATIAL") index.unique = false;
              renderIndexEditor(); refreshPreview();
            });
            uniqueInput.addEventListener("change", () => { index.unique = uniqueInput.checked; refreshPreview(); });
            remove.addEventListener("click", () => {
              if (index.isNew) draft.indexes.splice(indexPosition, 1);
              else index.deleted = !index.deleted;
              renderIndexEditor(); refreshPreview();
            });
          });
          if (!draft.indexes.length) indexList.append(el("p", "db-empty", "인덱스가 없습니다."));
          indexesTab.textContent = "인덱스 " + draft.indexes.filter(index => !index.deleted).length;
          addPrimaryButton.disabled = !editable || !draft.columns.some(column => !column.deleted)
            || draft.indexes.some(index => !index.deleted && String(index.name).toUpperCase() === "PRIMARY");
        };

        const renderForeignKeyEditor = () => {
          foreignList.innerHTML = "";
          const ruleValues = ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION"];
          draft.foreignKeys.forEach((foreignKey, foreignPosition) => {
            const cardNode = el("article", "db-table-constraint-card" + (foreignKey.deleted ? " deleted" : ""));
            const header = el("div", "db-table-constraint-head db-table-foreign-head");
            const nameInput = input("text", foreignKey.name, "외래키 이름");
            const databaseInput = input("text", foreignKey.referencedDatabase, "참조 DB");
            const tableInput = input("text", foreignKey.referencedTable, "참조 테이블");
            const deleteRule = document.createElement("select");
            const updateRule = document.createElement("select");
            ruleValues.forEach(value => { deleteRule.append(new Option("삭제 " + value, value)); updateRule.append(new Option("갱신 " + value, value)); });
            deleteRule.value = foreignKey.deleteRule; updateRule.value = foreignKey.updateRule;
            const remove = button(foreignKey.deleted ? "복원" : "삭제", "db-btn db-btn-quiet db-table-column-remove");
            [nameInput, databaseInput, tableInput, deleteRule, updateRule].forEach(node => { node.disabled = !editable || foreignKey.deleted; });
            remove.disabled = !editable;
            header.append(nameInput, databaseInput, tableInput, deleteRule, updateRule, remove);
            const pairs = el("div", "db-table-constraint-parts");
            foreignKey.columns.forEach((pair, pairPosition) => {
              const row = el("div", "db-table-foreign-part");
              const local = columnSelect(pair.local);
              const referenced = input("text", pair.referenced, "참조 컬럼");
              const up = button("", "db-table-column-move-btn", "위로 이동"); up.innerHTML = uiIcon("chevronUp");
              const down = button("", "db-table-column-move-btn", "아래로 이동"); down.innerHTML = uiIcon("chevronDown");
              const del = button("제거", "db-btn db-btn-quiet db-table-constraint-part-remove");
              [local, referenced, up, down, del].forEach(node => { node.disabled = !editable || foreignKey.deleted; });
              up.disabled = up.disabled || pairPosition === 0;
              down.disabled = down.disabled || pairPosition === foreignKey.columns.length - 1;
              row.append(local, schemaIcon("arrow", "db-table-reference-arrow"), referenced, up, down, del);
              pairs.append(row);
              local.addEventListener("change", () => { pair.local = local.value; refreshPreview(); });
              referenced.addEventListener("input", () => { pair.referenced = referenced.value; refreshPreview(); });
              up.addEventListener("click", () => { foreignKey.columns.splice(pairPosition - 1, 0, foreignKey.columns.splice(pairPosition, 1)[0]); renderForeignKeyEditor(); refreshPreview(); });
              down.addEventListener("click", () => { foreignKey.columns.splice(pairPosition + 1, 0, foreignKey.columns.splice(pairPosition, 1)[0]); renderForeignKeyEditor(); refreshPreview(); });
              del.addEventListener("click", () => { foreignKey.columns.splice(pairPosition, 1); renderForeignKeyEditor(); refreshPreview(); });
            });
            const addPair = button("컬럼 짝 추가", "db-btn db-btn-quiet db-table-constraint-add-part");
            addPair.disabled = !editable || foreignKey.deleted || !draft.columns.some(column => !column.deleted);
            addPair.addEventListener("click", () => {
              const first = draft.columns.find(column => !column.deleted);
              if (!first) return;
              foreignKey.columns.push({ local:first.isNew ? first.name : first.originalName, referenced:"id" });
              renderForeignKeyEditor(); refreshPreview();
            });
            cardNode.append(header, pairs, addPair);
            foreignList.append(cardNode);
            nameInput.addEventListener("input", () => { foreignKey.name = nameInput.value; refreshPreview(); });
            databaseInput.addEventListener("input", () => { foreignKey.referencedDatabase = databaseInput.value; refreshPreview(); });
            tableInput.addEventListener("input", () => { foreignKey.referencedTable = tableInput.value; refreshPreview(); });
            deleteRule.addEventListener("change", () => { foreignKey.deleteRule = deleteRule.value; refreshPreview(); });
            updateRule.addEventListener("change", () => { foreignKey.updateRule = updateRule.value; refreshPreview(); });
            remove.addEventListener("click", () => {
              if (foreignKey.isNew) draft.foreignKeys.splice(foreignPosition, 1);
              else foreignKey.deleted = !foreignKey.deleted;
              renderForeignKeyEditor(); refreshPreview();
            });
          });
          if (!draft.foreignKeys.length) foreignList.append(el("p", "db-empty", "외래키가 없습니다."));
          foreignKeysTab.textContent = "외래키 " + draft.foreignKeys.filter(foreignKey => !foreignKey.deleted).length;
        };

        addIndexButton.addEventListener("click", () => {
          const first = draft.columns.find(column => !column.deleted);
          if (!first) return;
          let suffix = 1, candidate = "idx_" + first.name;
          const used = new Set(draft.indexes.filter(index => !index.deleted).map(index => index.name.toLowerCase()));
          while (used.has(candidate.toLowerCase())) candidate = "idx_" + first.name + "_" + (++suffix);
          const index = indexDraft({
            name:candidate, unique:false, type:"BTREE",
            columns:[{ name:first.isNew ? first.name : first.originalName, prefix:null, order:"ASC" }]
          }, Date.now());
          index.originalName = ""; index.original = null; index.isNew = true;
          draft.indexes.push(index);
          renderIndexEditor(); refreshPreview(); indexesTab.click();
        });

        addPrimaryButton.addEventListener("click", () => {
          const first = draft.columns.find(column => !column.deleted);
          if (!first || draft.indexes.some(index => !index.deleted && String(index.name).toUpperCase() === "PRIMARY")) return;
          const index = indexDraft({
            name:"PRIMARY", unique:true, type:"BTREE",
            columns:[{ name:first.isNew ? first.name : first.originalName, prefix:null, order:"ASC" }]
          }, Date.now());
          index.originalName = ""; index.original = null; index.isNew = true;
          draft.indexes.push(index);
          renderIndexEditor(); refreshPreview(); indexesTab.click();
        });

        addForeignButton.addEventListener("click", () => {
          const first = draft.columns.find(column => !column.deleted);
          if (!first) return;
          let suffix = 1, candidate = "fk_" + draft.name + "_" + first.name;
          const used = new Set(draft.foreignKeys.filter(foreignKey => !foreignKey.deleted).map(foreignKey => foreignKey.name.toLowerCase()));
          while (used.has(candidate.toLowerCase())) candidate = "fk_" + draft.name + "_" + first.name + "_" + (++suffix);
          const foreignKey = foreignKeyDraft({
            name:candidate, referencedDatabase:base.database, referencedTable:"referenced_table",
            updateRule:"RESTRICT", deleteRule:"RESTRICT",
            columns:[{ local:first.isNew ? first.name : first.originalName, referenced:"id" }]
          }, Date.now());
          foreignKey.originalName = ""; foreignKey.original = null; foreignKey.isNew = true;
          draft.foreignKeys.push(foreignKey);
          renderForeignKeyEditor(); refreshPreview(); foreignKeysTab.click();
        });

        const renderColumnEditor = () => {
          columnList.innerHTML = "";
          const hasGenerated = draft.columns.some(column => column.generationExpression && !column.deleted);
          draft.columns.forEach((column, index) => {
            const row = el("div", "db-table-column-edit-row" + (column.deleted ? " deleted" : ""));
            const move = el("div", "db-table-column-move");
            const up = button("", "db-table-column-move-btn", "위로 이동");
            const down = button("", "db-table-column-move-btn", "아래로 이동");
            up.innerHTML = uiIcon("chevronUp");
            down.innerHTML = uiIcon("chevronDown");
            up.disabled = !editable || hasGenerated || column.deleted || index === 0;
            down.disabled = !editable || hasGenerated || column.deleted || index === draft.columns.length - 1;
            move.append(up, down);
            const nameInput = input("text", column.name, "컬럼명");
            const typeInput = input("text", column.type, "varchar(255)");
            const nullableInput = input("checkbox", ""); nullableInput.checked = column.nullable;
            const defaultMode = document.createElement("select");
            [["none", "기본값 없음"], ["null", "NULL"], ["value", "값"], ["expression", "표현식"]]
              .forEach(pair => defaultMode.append(new Option(pair[1], pair[0])));
            defaultMode.value = column.defaultMode;
            const defaultInput = input("text", column.defaultValue, column.defaultMode === "expression" ? "CURRENT_TIMESTAMP" : "기본값");
            defaultInput.disabled = column.defaultMode === "none" || column.defaultMode === "null";
            const autoInput = input("checkbox", ""); autoInput.checked = column.autoIncrement;
            const commentInput = input("text", column.comment, "설명");
            const complex = !!(column.generationExpression || column.unsupportedExtra);
            [nameInput, typeInput, nullableInput, defaultMode, defaultInput, autoInput, commentInput].forEach(node => {
              node.disabled = !editable || column.deleted || complex || (node === defaultInput && (column.defaultMode === "none" || column.defaultMode === "null"));
            });
            const identity = el("div", "db-table-column-identity");
            identity.append(nameInput);
            if (column.key === "PRI") identity.append(el("span", "db-table-column-badge pk", "PK"));
            if (complex) identity.append(el("span", "db-table-column-badge", column.generationExpression ? "생성 컬럼" : "고급 속성"));
            const flags = el("div", "db-table-column-flags");
            const nullableLabel = el("label", null, ""); nullableLabel.append(nullableInput, document.createTextNode(" NULL"));
            const autoLabel = el("label", null, ""); autoLabel.append(autoInput, document.createTextNode(" 자동 증가"));
            flags.append(nullableLabel, autoLabel);
            const defaultWrap = el("div", "db-table-column-default"); defaultWrap.append(defaultMode, defaultInput);
            const remove = button(column.deleted ? "복원" : "삭제", "db-btn db-btn-quiet db-table-column-remove");
            remove.disabled = !editable;
            row.append(move, identity, typeInput, flags, defaultWrap, commentInput, remove);
            columnList.append(row);

            const changed = () => { refreshPreview(); };
            nameInput.addEventListener("input", () => {
              column.name = nameInput.value;
              renderIndexEditor();
              renderForeignKeyEditor();
              changed();
            });
            typeInput.addEventListener("input", () => { column.type = typeInput.value; changed(); });
            nullableInput.addEventListener("change", () => { column.nullable = nullableInput.checked; changed(); });
            defaultMode.addEventListener("change", () => {
              column.defaultMode = defaultMode.value;
              defaultInput.disabled = !editable || column.deleted || complex || column.defaultMode === "none" || column.defaultMode === "null";
              changed();
            });
            defaultInput.addEventListener("input", () => { column.defaultValue = defaultInput.value; changed(); });
            autoInput.addEventListener("change", () => { column.autoIncrement = autoInput.checked; changed(); });
            commentInput.addEventListener("input", () => { column.comment = commentInput.value; changed(); });
            up.addEventListener("click", () => {
              draft.columns.splice(index - 1, 0, draft.columns.splice(index, 1)[0]);
              renderColumnEditor(); renderIndexEditor(); renderForeignKeyEditor(); refreshPreview();
            });
            down.addEventListener("click", () => {
              draft.columns.splice(index + 1, 0, draft.columns.splice(index, 1)[0]);
              renderColumnEditor(); renderIndexEditor(); renderForeignKeyEditor(); refreshPreview();
            });
            remove.addEventListener("click", () => {
              if (column.isNew) draft.columns.splice(index, 1);
              else column.deleted = !column.deleted;
              renderColumnEditor(); renderIndexEditor(); renderForeignKeyEditor(); refreshPreview();
            });
          });
          columnsTab.textContent = "컬럼 " + draft.columns.filter(column => !column.deleted).length;
        };

        addColumnButton.addEventListener("click", () => {
          let suffix = 1, candidate = "new_column";
          const used = new Set(draft.columns.filter(column => !column.deleted).map(column => column.name.toLowerCase()));
          while (used.has(candidate.toLowerCase())) candidate = "new_column_" + (++suffix);
          const column = columnDraft({ name:candidate, type:"varchar(255)", nullable:true }, Date.now());
          column.id = "new-" + Date.now();
          column.originalName = "";
          column.original = null;
          column.isNew = true;
          draft.columns.push(column);
          renderColumnEditor(); renderIndexEditor(); renderForeignKeyEditor(); refreshPreview();
          columnsTab.click();
        });

        apply.addEventListener("click", async () => {
          refreshPreview();
          if (!currentPlan.sql || currentPlan.errors.length) return;
          applying = true; refreshPreview(); status.textContent = "서버의 현재 구조를 다시 확인하는 중…";
          try {
            const latest = await jsonOf(await fetch(url + "&mode=ddl", { cache:"no-store" }));
            if (!latest.ok) throw new Error(messageFor(latest.info));
            if (String(latest.info.ddl || "") !== originalDdl){
              status.textContent = "모달을 연 뒤 서버의 테이블 구조가 바뀌었습니다. 닫고 다시 열어 주세요.";
              status.classList.add("error");
              applying = false; refreshPreview();
              return;
            }
            const warningText = [...new Set(currentPlan.warnings)].slice(0, 8).map(message => "· " + message).join("\n");
            const confirmed = typeof confirmDialog !== "function" || await confirmDialog(
              "테이블 구조를 변경할까요?\n\n" + (warningText || "· ALTER TABLE을 실행합니다.")
                + "\n\nMySQL의 구조 변경은 되돌리기 어렵고 큰 테이블에서는 시간이 걸릴 수 있습니다.",
              currentPlan.destructive ? "삭제 포함 적용" : "변경 적용", "취소");
            if (!confirmed){ applying = false; status.textContent = ""; refreshPreview(); return; }
            status.classList.remove("error");
            status.textContent = "테이블 구조를 변경하는 중…";
            const nextName = draft.name;
            const started = await runQuery({
              sql:currentPlan.sql, label:"테이블 구조 변경", quiet:true, skipRiskConfirm:true,
              onComplete:async (ok, result) => {
                if (!modal.isConnected) return;
                if (!ok){
                  applying = false;
                  status.classList.add("error");
                  status.textContent = messageFor(result);
                  refreshPreview();
                  return;
                }
                forceClose();
                if (closeErdModal) closeErdModal();
                selectedSchemaKey = schemaKey({ type:"table", name:nextName });
                try {
                  await loadSchema();
                  setTableSelection(nextName);
                  showTable(nextName);
                  toast("테이블 구조를 변경했습니다.", 2400);
                } catch(error){
                  toast("구조는 변경했지만 목록을 새로 읽지 못했습니다. " + launcherMessage(error), 4500);
                }
              }
            });
            if (!started){ applying = false; status.textContent = "다른 쿼리가 실행 중입니다."; refreshPreview(); }
          } catch(error){
            applying = false;
            status.classList.add("error");
            status.textContent = launcherMessage(error);
            refreshPreview();
          }
        });

        renderColumnEditor();
        renderIndexEditor();
        renderForeignKeyEditor();
        refreshPreview();
        body.append(tabs, panels, preview, status, actions);
        const initial = {
          columns:[columnsTab, columnsPanel], indexes:[indexesTab, indexesPanel],
          foreignKeys:[foreignKeysTab, foreignKeysPanel], ddl:[ddlTab, ddlPanel]
        }[initialTab] || [overviewTab, overviewPanel];
        switchTab(initial[0], initial[1]);
        requestAnimationFrame(() => initial[0].focus());
      } catch(error){
        body.innerHTML = "";
        notice(body, "테이블 정보를 읽지 못했습니다", launcherMessage(error), "error");
      }
    };

    const showTable = async (name) => {
      resultStatus.textContent = name + " 를 읽는 중…";
      try {
        const url = "/db-table?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(name);
        const response = await jsonOf(await fetch(url, { cache:"no-store" }));
        if (!response.ok){ resultStatus.textContent = messageFor(response.info); clearResult(); return; }
        const info = response.info;
        renderRows(info.displayColumns || [], info.rows || [], info.truncated, info.clippedCells);
        const keys = (info.columns || []).filter(column => column.key === "PRI").map(column => column.name);
        resultStatus.textContent = name + " · 컬럼 " + (info.columns || []).length + "개"
          + (keys.length ? " · 기본키 " + keys.join(", ") : "")
          + " · 미리보기 " + (info.rows || []).length + "행"
          + (formatMs(info.ms) ? " · " + formatMs(info.ms) : "");
        const countRow = button("전체 행 수 세기", "db-btn db-btn-quiet db-count-btn",
          "큰 테이블에서는 시간이 걸릴 수 있어 따로 실행합니다");
        countRow.addEventListener("click", async () => {
          countRow.disabled = true;
          countRow.textContent = "세는 중…";
          try {
            const countUrl = url + "&mode=count";
            const counted = await jsonOf(await fetch(countUrl, { cache:"no-store" }));
            countRow.textContent = counted.ok
              ? "전체 " + counted.info.rowCount.toLocaleString() + "행"
              : messageFor(counted.info);
          } catch(error){
            countRow.textContent = launcherMessage(error);
          }
        });
        resultHost.prepend(countRow);
      } catch(error){
        resultStatus.textContent = launcherMessage(error);
        clearResult();
      }
    };

    databaseSelect.addEventListener("change", async () => {
      const name = databaseSelect.value;
      if (!name) return;
      try {
        const response = await jsonOf(await fetch("/db-use?id=" + encodeURIComponent(sessionId)
          + "&name=" + encodeURIComponent(name), { method:"POST" }));
        if (!response.ok){ toast(messageFor(response.info), 4000); return; }
        profile.database = name;
        markDirty();
        await loadSchema();
      } catch(error){ toast(launcherMessage(error), 4000); }
    });
    erdButton.addEventListener("click", openErdModal);

    tableFilter.addEventListener("input", renderTableList);

    /* 트랜잭션 -------------------------------------------------------------
       상태(자동 커밋 여부·미커밋 변경 유무)는 프런트가 짐작하지 않는다. 워커가 커넥션을 쥐고
       있으므로 커밋·롤백·쿼리 응답에 실려 오는 값을 그대로 받아 화면에 반영한다. */

    const refreshTxUi = () => {
      txWrap.hidden = !sessionId || readOnly;
      autoCommitToggle.checked = autoCommit;
      const idle = !runningJob;
      autoCommitToggle.disabled = !idle;
      commitButton.disabled = autoCommit || !idle;
      rollbackButton.disabled = autoCommit || !idle;
      txBadge.hidden = !pendingTx;
      // 확정하지 않은 변경이 있는 동안에는 커밋을 눈에 띄게 둔다
      commitButton.classList.toggle("db-btn-primary", pendingTx);
    };

    const applyTxState = (info) => {
      if (info && typeof info === "object"){
        if (typeof info.autoCommit === "boolean") autoCommit = info.autoCommit;
        if (typeof info.pending === "boolean") pendingTx = info.pending;
      }
      refreshTxUi();
    };

    const txRequest = async (op, query) => {
      if (!sessionId) return null;
      const response = await jsonOf(await fetch("/db-tx?id=" + encodeURIComponent(sessionId)
        + "&op=" + encodeURIComponent(op) + (query || ""), { method:"POST" }));
      applyTxState(response.info);
      return response;
    };

    const finishTx = async (commit) => {
      if (!sessionId || autoCommit) return;
      if (!commit && pendingTx && typeof confirmDialog === "function"){
        const ok = await confirmDialog("커밋하지 않은 변경을 모두 되돌릴까요?", "롤백", "취소");
        if (!ok) return;
      }
      try {
        const response = await txRequest(commit ? "commit" : "rollback");
        if (!response) return;
        if (!response.ok){ toast(messageFor(response.info), 3200); return; }
        toast(commit ? "커밋했습니다." : "롤백했습니다.", 2000);
      } catch(error){ toast(launcherMessage(error), 4000); }
    };

    commitButton.addEventListener("click", () => finishTx(true));
    rollbackButton.addEventListener("click", () => finishTx(false));

    autoCommitToggle.addEventListener("change", async () => {
      const wanted = autoCommitToggle.checked;
      try {
        let response = await txRequest("autocommit", "&on=" + (wanted ? "1" : "0"));
        // 자동 커밋을 켜면 서버가 열려 있던 트랜잭션을 확정한다. 모르는 사이에 커밋되지 않도록
        // 워커가 먼저 막고, 여기서 사용자에게 물어 커밋할지 정한다(되돌리려면 롤백을 먼저 쓴다).
        if (response && !response.ok && response.info && response.info.code === "tx-pending"){
          const ok = typeof confirmDialog === "function"
            ? await confirmDialog("커밋하지 않은 변경이 있습니다.\n커밋하고 자동 커밋으로 바꿀까요?"
                + "\n\n되돌리려면 취소하고 롤백을 먼저 눌러 주세요.", "커밋하고 전환", "취소")
            : false;
          if (!ok){ refreshTxUi(); return; }
          const committed = await txRequest("commit");
          if (!committed || !committed.ok){ toast(messageFor(committed && committed.info), 3200); refreshTxUi(); return; }
          response = await txRequest("autocommit", "&on=1");
        }
        if (response && !response.ok){ toast(messageFor(response.info), 3200); return; }
        profile.autoCommit = autoCommit;
        markDirty();
        toast(autoCommit ? "자동 커밋을 켰습니다." : "수동 커밋 모드입니다. 변경한 뒤 커밋을 눌러야 반영됩니다.", 2800);
      } catch(error){
        toast(launcherMessage(error), 4000);
      } finally { refreshTxUi(); }
    });

    /* 실행 ----------------------------------------------------------------- */

    const setRunning = (running) => {
      cancelButton.disabled = !running;
      runAllButton.disabled = running || !sessionId;
      if (running){
        runButton.disabled = true;
        runButton.textContent = "실행 중…";
      } else refreshRunLabel();
      refreshTxUi();
    };

    const stopPolling = () => {
      if (pollTimer){ clearTimeout(pollTimer); pollTimer = 0; }
    };

    // 걸린 시간은 인덱스 수업에서 그 자체가 교재가 된다. 서버가 잰 값만 쓴다 —
    // 프런트에서 재면 폴링 간격(300ms)이 섞여 빠른 쿼리가 느리게 보인다.
    const formatMs = (ms) => {
      const value = Number(ms);
      if (!Number.isFinite(value)) return "";
      return value < 1000 ? value + "ms" : (value / 1000).toFixed(2) + "초";
    };

    const pollQuery = () => {
      pollTimer = setTimeout(async () => {
        if (closed || !runningJob) return;
        try {
          const response = await jsonOf(await fetch("/db-query-poll?job=" + encodeURIComponent(runningJob), { cache:"no-store" }));
          if (!response.done){
            if (response.cancelling) resultStatus.textContent = "취소하는 중…";
            pollQuery();
            return;
          }
          runningJob = "";
          setRunning(false);
          if (!response.ok){
            if (!runningQuiet) rememberQuery(runningSql, 0, false);
            applyTxState(response.info);
            const partial = (response.info && response.info.statements) || [];
            if (partial.length){
              renderStatements(partial, runningLabel, formatMs(response.info.ms), response.info);
            } else {
              clearResult();
              resultStatus.textContent = messageFor(response.info);
            }
            const complete = runningComplete; runningComplete = null;
            if (complete) complete(false, response.info);
            return;
          }
          if (!runningQuiet) rememberQuery(runningSql, response.info.ms, true);
          applyTxState(response.info);
          renderStatements(response.info.statements || [], runningLabel, formatMs(response.info.ms));
          const complete = runningComplete; runningComplete = null;
          if (complete) complete(true, response.info);
        } catch(error){
          runningJob = "";
          setRunning(false);
          resultStatus.textContent = launcherMessage(error);
          const complete = runningComplete; runningComplete = null;
          if (complete) complete(false, { detail:launcherMessage(error) });
        }
      }, POLL_MS);
    };

    const runQuery = async (target) => {
      if (!sessionId || runningJob) return false;
      const chosen = target || runTarget();
      const sql = chosen ? chosen.sql.trim() : "";
      if (!sql){ toast("실행할 SQL 을 입력해 주세요.", 2200); return false; }

      // 확인 대상은 편집기 전체가 아니라 실제로 보낼 것만이다. 아래에 적어 둔 DROP 때문에
      // 위의 SELECT 하나에도 확인창이 뜨면 확인창을 아무도 읽지 않게 된다.
      const risky = riskyStatements(sql);
      if (!chosen.skipRiskConfirm && risky.length && typeof confirmDialog === "function"){
        const lines = risky.slice(0, 5).map(item => "· " + item.reason).join("\n");
        const ok = await confirmDialog(
          "되돌릴 수 없는 문장이 있습니다.\n\n" + lines
            + (risky.length > 5 ? "\n· 그 밖 " + (risky.length - 5) + "건" : "")
            + "\n\n그대로 실행할까요?",
          "실행", "취소");
        if (!ok) return false;
      }

      runningLabel = chosen.label;
      runningSql = sql;
      runningQuiet = !!chosen.quiet;
      runningComplete = typeof chosen.onComplete === "function" ? chosen.onComplete : null;
      setRunning(true);
      clearResult();
      resultStatus.classList.remove("db-result-failed");
      resultStatus.textContent = chosen.label + " — 실행 중…";
      try {
        const response = await jsonOf(await fetch("/db-query?id=" + encodeURIComponent(sessionId), {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([sql, String(timeoutInput.value || DEFAULT_TIMEOUT)])
        }));
        runningJob = response.job;
        pollQuery();
        return true;
      } catch(error){
        setRunning(false);
        resultStatus.textContent = launcherMessage(error);
        const complete = runningComplete; runningComplete = null;
        if (complete) complete(false, { detail:launcherMessage(error) });
        return false;
      }
    };

    runButton.addEventListener("click", () => runQuery(runTarget()));
    explainButton.addEventListener("click", () => {
      const target = runTarget();
      if (!target){ toast("실행 계획을 볼 문장을 먼저 골라 주세요.", 2200); return; }
      // 이미 EXPLAIN 인 문장에 또 붙이지 않는다. 편집기 내용은 건드리지 않는다.
      const sql = firstKeyword(target.sql) === "explain" ? target.sql : "EXPLAIN " + target.sql;
      runQuery({ sql, label:"실행 계획" });
    });
    runAllButton.addEventListener("click", () => runQuery(allTarget()));
    cancelButton.addEventListener("click", async () => {
      if (!runningJob) return;
      cancelButton.disabled = true;
      resultStatus.textContent = "취소하는 중…";
      try { await fetch("/db-query-cancel?job=" + encodeURIComponent(runningJob), { method:"POST" }); }
      catch(_){ /* 취소 실패는 쿼리 결과로 드러난다 */ }
    });

    /* 내보내기 -------------------------------------------------------------- */

    const exportBase = () => String(doc.name || "결과").replace(/\.dbconn$/i, "") + " 결과";

    exportCsvButton.addEventListener("click", () => {
      if (!lastRows || typeof MNTableExport === "undefined") return;
      MNTableExport.saveCsv({ rows:lastRows, header:true }, { baseName:exportBase(), notify:(message) => toast(message, 2400) });
    });
    openSheetButton.addEventListener("click", () => {
      if (!lastRows || typeof MNTableExport === "undefined") return;
      MNTableExport.openInEditor({ rows:lastRows, header:true },
        { baseName:exportBase(), doc, notify:(message) => toast(message, 2400) });
    });

    /* SQL 파일 가져오기 ------------------------------------------------------
       한글 주석이 든 덤프는 CP949 인 경우가 많다. 바이트를 보고 인코딩을 고른 뒤 읽어야
       주석과 한글 데이터가 깨지지 않는다(판정기는 코어의 것을 그대로 쓴다). */

    const SQL_IMPORT_WARN = 1024 * 1024;        // 이보다 크면 한 번 묻는다(편집기가 느려진다)
    const SQL_IMPORT_MAX = 8 * 1024 * 1024;     // 이보다 크면 받지 않는다
    const sizeText = (bytes) => {
      const value = Number(bytes) || 0;
      return value >= 1024 * 1024 ? (value / 1024 / 1024).toFixed(1) + "MB"
        : Math.max(1, Math.round(value / 1024)) + "KB";
    };

    const readSqlText = async (file) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = typeof detectTextEncoding === "function" ? detectTextEncoding(bytes) : null;
        return new TextDecoder((info && info.encoding) || "utf-8").decode(bytes);
      } catch(_){ return await file.text(); }
    };

    const importSqlFile = async (file) => {
      if (!file) return;
      if (file.size > SQL_IMPORT_MAX){
        toast(file.name + " 은 " + sizeText(file.size) + " 입니다. "
          + sizeText(SQL_IMPORT_MAX) + " 이하의 .sql 파일만 열 수 있습니다.", 4200);
        return;
      }
      if (file.size > SQL_IMPORT_WARN && typeof confirmDialog === "function"){
        const ok = await confirmDialog(file.name + " 은 " + sizeText(file.size) + " 입니다.\n"
          + "편집기가 느려질 수 있습니다. 그래도 열까요?", "열기", "취소");
        if (!ok) return;
      }
      let text;
      try { text = await readSqlText(file); }
      catch(_){ toast("파일을 읽지 못했습니다.", 3000); return; }
      text = String(text || "").replace(/^\uFEFF/, "");
      // 쓰던 SQL 을 말없이 지우지 않는다. 편집기가 비어 있을 때만 바로 채운다.
      if (editor.getValue().trim() && typeof confirmDialog === "function"){
        const ok = await confirmDialog("편집기에 쓰던 SQL 이 있습니다.\n"
          + file.name + " 의 내용으로 바꿀까요?\n\n지금 내용은 사라집니다(저장하지 않았다면 되돌릴 수 없습니다).",
          "바꾸기", "취소");
        if (!ok) return;
      }
      editor.setValue(text);      // input 이벤트가 나가 profile.sql·실행 버튼이 함께 갱신된다
      editor.ta.setSelectionRange(0, 0);
      editor.ta.focus();
      refreshRunLabel();
      // DELIMITER 는 MySQL 명령행 클라이언트의 지시어지 SQL 문장이 아니다. 워커의 문장 나누기는
      // 세미콜론만 보므로, 프로시저 덤프를 열었을 때 그대로 실행하면 실패한다는 것을 미리 알린다.
      const note = /^\s*DELIMITER\b/im.test(text) ? " · DELIMITER 구문은 그대로 실행할 수 없습니다" : "";
      toast(file.name + " 을 불러왔습니다 — 문장 " + statementRanges(text).length + "개" + note, 3600);
    };

    importButton.addEventListener("click", () => {
      sqlFileInput.value = "";                  // 같은 파일을 다시 골라도 change 가 나게 한다
      sqlFileInput.click();
    });
    sqlFileInput.addEventListener("change", () => {
      const file = sqlFileInput.files && sqlFileInput.files[0];
      importSqlFile(file).catch(() => toast("파일을 읽지 못했습니다.", 3000));
    });

    /* 실행 이력 ------------------------------------------------------------
       접속(호스트·포트·DB·계정)별로 나눠 브라우저에 남긴다. 비밀번호는 들어가지 않지만
       쿼리 자체는 남으므로 지우는 버튼을 함께 둔다. */

    const HISTORY_KEY = "classdockDbHistoryV1";
    const HISTORY_MAX = 50;
    const historySignature = () => [profile.host, profile.port, profile.database, profile.user].join("|");

    const readHistory = () => {
      try {
        const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
        const list = all[historySignature()];
        return Array.isArray(list) ? list : [];
      } catch(_){ return []; }
    };

    const writeHistory = (list) => {
      try {
        const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
        all[historySignature()] = list.slice(0, HISTORY_MAX);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
      } catch(_){ /* 저장 공간이 없으면 이력만 남지 않는다 */ }
    };

    const rememberQuery = (sql, ms, ok) => {
      const list = readHistory().filter(item => item.sql !== sql);
      list.unshift({ sql, at:Date.now(), ms:Number(ms) || 0, ok:!!ok });
      writeHistory(list);
    };

    const renderHistory = () => {
      const list = readHistory();
      historyList.innerHTML = "";
      if (!list.length){
        historyList.append(el("p", "db-empty", "아직 실행한 쿼리가 없습니다."));
        return;
      }
      list.forEach((item) => {
        const row = button("", "db-history-item", item.sql);
        const when = new Date(item.at);
        const stamp = when.toTimeString().slice(0, 5);
        row.append(
          el("span", "db-history-sql", previewOf(item.sql)),
          el("span", "db-history-meta", stamp + (item.ms ? " · " + formatMs(item.ms) : "") + (item.ok ? "" : " · 실패"))
        );
        if (!item.ok) row.classList.add("db-history-failed");
        row.addEventListener("click", () => { insertIntoEditor(item.sql); historyPanel.hidden = true; });
        historyList.append(row);
      });
    };

    historyButton.addEventListener("click", () => {
      historyPanel.hidden = !historyPanel.hidden;
      if (!historyPanel.hidden) renderHistory();
    });
    historyClose.addEventListener("click", () => { historyPanel.hidden = true; });
    historyClear.addEventListener("click", async () => {
      const ok = typeof confirmDialog === "function"
        ? await confirmDialog("이 접속의 실행 기록을 모두 지울까요?", "지우기", "취소") : true;
      if (!ok) return;
      writeHistory([]);
      renderHistory();
    });

    /* 연결·해제 ------------------------------------------------------------ */

    const showWorkspace = (connected) => {
      form.hidden = connected;
      workspace.hidden = !connected;
      // 화면에 올라온 뒤라야 작업 영역 폭을 잴 수 있다(상한 계산이 그때 유효해진다).
      if (connected){
        setSidebarWidth(readSidebarWidth() || SIDEBAR_DEFAULT, false);
        setEditorHeight(readEditorHeight() || EDITOR_DEFAULT, false);
      }
      modeBadge.textContent = readOnly ? "읽기 전용" : "쓰기 허용";
      modeBadge.classList.toggle("db-mode-write", !readOnly);
      refreshTxUi();
    };

    // 부족한 파이썬 패키지를 그 자리에서 설치하게 해 준다(드라이버·인증 보조 패키지 모두 같은 경로).
    const offerPackageInstall = (packages, reason) => {
      statusLine.innerHTML = "";
      const wrap = el("div", "db-install");
      wrap.append(el("span", null, reason));
      const installButton = button("지금 설치", "db-btn");
      const log = el("pre", "db-install-log");
      log.hidden = true;
      installButton.addEventListener("click", async () => {
        installButton.disabled = true;
        log.hidden = false;
        log.textContent = "설치를 시작합니다…\n";
        try {
          const started = await jsonOf(await fetch("/pip-install-start", {
            method:"POST",
            headers:{ "Content-Type":"text/plain; charset=utf-8", "X-ClassDock-Pip-Confirm":"1" },
            body:packages.join(" ")
          }));
          let seen = 0;
          const tick = async () => {
            const status = await jsonOf(await fetch("/pip-install-poll?id=" + encodeURIComponent(started.id)
              + "&from=" + seen, { cache:"no-store" }));
            if (status.logDelta){ log.textContent += status.logDelta; seen += status.logDelta.length; }
            else if (status.log){ log.textContent = status.log; seen = status.log.length; }
            log.scrollTop = log.scrollHeight;
            if (!status.complete){ setTimeout(tick, 400); return; }
            installButton.disabled = false;
            if (status.code === 0){
              installButton.textContent = "설치 완료 — 다시 연결해 보세요";
              toast(packages.join(", ") + " 을(를) 설치했습니다.", 2600);
            } else {
              installButton.textContent = "다시 시도";
            }
          };
          tick();
        } catch(error){
          installButton.disabled = false;
          log.textContent += launcherMessage(error) + "\n";
        }
      });
      wrap.append(installButton, log);
      statusLine.append(wrap);
    };

    const connect = async () => {
      if (!isExe()){
        statusLine.textContent = "데이터베이스 접속은 ClassDock.exe 에서만 사용할 수 있습니다.";
        return;
      }
      profile.host = hostInput.value.trim();
      profile.port = Math.max(1, Math.min(65535, Number(portInput.value) || 3306));
      profile.database = databaseInput.value.trim();
      profile.user = userInput.value.trim();
      profile.readOnly = !writeToggle.checked;
      if (profile.readOnly) profile.autoCommit = true;   // 읽기 전용은 확정할 것이 없다
      markDirty();

      connectButton.disabled = true;
      connectButton.textContent = "연결 중…";
      statusLine.textContent = "";
      try {
        const response = await jsonOf(await fetch("/db-session-open", {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([profile.host, String(profile.port), profile.database,
            profile.user, passwordInput.value, profile.readOnly ? "1" : "0",
            profile.autoCommit === false ? "0" : "1"])
        }));
        if (!response.ok){
          const code = response.info && response.info.code;
          if (code === "driver-missing") offerPackageInstall(["pymysql"], "MySQL 드라이버(pymysql)가 없습니다.");
          else if (code === "auth-crypto") offerPackageInstall(["cryptography"], messageFor(response.info));
          else statusLine.textContent = messageFor(response.info);
          return;
        }
        passwordInput.value = "";                     // 화면에도 남기지 않는다
        sessionId = response.id;
        readOnly = !!response.readOnly;
        autoCommit = response.autoCommit !== false;
        pendingTx = false;
        serverLabel.textContent = response.label + (response.info.serverVersion ? " · MySQL " + response.info.serverVersion : "");
        showWorkspace(true);
        applyColor();
        refreshRunLabel();
        await loadSchema();
        editor.ta.focus();
      } catch(error){
        statusLine.textContent = launcherMessage(error);
      } finally {
        connectButton.disabled = false;
        connectButton.textContent = "연결";
      }
    };

    const disconnect = async (silent) => {
      // 커밋하지 않은 변경은 커넥션이 닫히는 순간 서버가 롤백한다. 말없이 사라지지 않게 한 번 묻는다.
      if (!silent && sessionId && pendingTx && typeof confirmDialog === "function"){
        const ok = await confirmDialog("커밋하지 않은 변경이 있습니다.\n연결을 끊으면 모두 사라집니다. 계속할까요?",
          "연결 끊기", "취소");
        if (!ok) return;
      }
      stopPolling();
      if (closeValueModal) closeValueModal();
      if (closeErdModal) closeErdModal();
      runningJob = "";
      const id = sessionId;
      sessionId = "";
      if (!id) return;
      try { await fetch("/db-session-close?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
      if (silent) return;
      pendingTx = false;
      showWorkspace(false);
      clearResult();
      refreshRunLabel();
      resultStatus.textContent = "";
      statusLine.textContent = "연결을 끊었습니다.";
    };

    connectButton.addEventListener("click", connect);
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      try { await saveDbConnDoc(doc); }
      finally { saveButton.disabled = false; }
    });
    disconnectButton.addEventListener("click", () => disconnect(false));
    [hostInput, portInput, databaseInput, userInput, passwordInput].forEach((node) => {
      node.addEventListener("keydown", (event) => { if (event.key === "Enter") connect(); });
    });

    // 탭을 닫거나 창을 닫으면 워커 프로세스와 서버 커넥션을 정리한다.
    (doc.cleanupFns = doc.cleanupFns || []).push(() => { closed = true; disconnect(true); });
    doc.cleanupFns.push(closeTableContextMenu);
    doc.cleanupFns.push(() => { if (closeErdModal) closeErdModal(); });
    doc.cleanupFns.push(() => { try { editor.destroy(); } catch(_){} });
    // 앱의 Ctrl+F(문서 안 찾기)·Ctrl+G(줄 이동)를 편집기 것으로 연결한다.
    doc.openDocFind = () => editor.openFind();
    doc.openGotoLine = () => editor.openGoto();
    doc.cleanupFns.push(() => { delete doc.openDocFind; delete doc.openGotoLine; });
    const onUnload = () => {
      if (!sessionId) return;
      try { navigator.sendBeacon("/db-session-close?id=" + encodeURIComponent(sessionId)); } catch(_){}
    };
    window.addEventListener("beforeunload", onUnload);
    doc.cleanupFns.push(() => window.removeEventListener("beforeunload", onUnload));

    showWorkspace(false);
    applyColor();
    refreshRunLabel();
    if (!isExe()){
      form.hidden = true;
      notice(root, "EXE 에서 열어주세요",
        "MySQL 접속은 ClassDock.exe 의 로컬 서버를 통해서만 할 수 있습니다. 브라우저 단독 실행에서는 원격 데이터베이스에 연결할 수 없습니다.", "");
    } else if (!profile.user) {
      userInput.focus();
    } else {
      passwordInput.focus();
    }
  };

  return { COLORS, COLOR_LABELS, emptyProfile, parseProfile, serializeProfile,
    statementRanges, splitStatements, statementAt, firstKeyword, riskyStatements,
    identifierFor, ddlIdentifier, ddlString, defaultDraft, columnDraft, indexDraft, foreignKeyDraft, tableAlterPlan,
    erdLayout, aliasMap, orderBySpot, applyOrderBy, orderByState, messageFor, mount };
})();

/* 파일 로더가 부르는 진입점 ------------------------------------------------ */

async function loadDbConnDoc(file, opts = {}){
  let profile;
  try { profile = MNDbClient.parseProfile(await file.text()); }
  catch(_){
    if (typeof toast === "function") toast("접속 문서(.dbconn)를 읽지 못해 텍스트로 열었어요.", 3500);
    return typeof loadText === "function" ? loadText(file, opts) : null;
  }
  const doc = makeDoc("dbconn", file.name, opts);
  doc.dbProfile = profile;
  doc.sourceFile = file;
  doc.savedText = MNDbClient.serializeProfile(profile);
  doc.render = async () => {
    if (doc._dbMounted) return;
    doc._dbMounted = true;
    MNDbClient.mount(doc);
  };
  if (typeof refreshChrome === "function") refreshChrome();
  if (typeof activateIfIdle === "function") activateIfIdle(doc, opts);
  return doc;
}

async function saveDbConnDoc(doc){
  if (!doc || !doc.dbProfile) return false;
  const json = MNDbClient.serializeProfile(doc.dbProfile);
  const ok = typeof saveTextDoc === "function" ? await saveTextDoc(json, doc, doc.name) : false;
  if (!ok) return false;
  doc.savedText = json;
  if (typeof markDocumentSavedSnapshot === "function"){
    await markDocumentSavedSnapshot(doc, new TextEncoder().encode(json), "application/json");
  } else if (typeof markDocumentDirty === "function") markDocumentDirty(doc, false);
  return true;
}

let _dbConnScratchCount = 0;

function newDbConnScratch(){
  _dbConnScratchCount++;
  const name = "접속" + (_dbConnScratchCount > 1 ? _dbConnScratchCount : "") + ".dbconn";
  const starter = MNDbClient.serializeProfile(MNDbClient.emptyProfile());
  if (typeof handleFiles !== "function") return Promise.resolve(null);
  return Promise.resolve(handleFiles([new File([starter], name, { type:"application/json" })], { isScratch:true }));
}

if (typeof module !== "undefined" && module.exports) module.exports = MNDbClient;
