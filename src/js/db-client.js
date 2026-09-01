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
    host:"127.0.0.1", port:3306, database:"", user:"", readOnly:true, color:"", sql:""
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
      if (COLORS.includes(raw.color)) profile.color = raw.color;
      if (typeof raw.sql === "string") profile.sql = raw.sql;
    }
    return profile;
  };

  // 비밀번호는 어떤 경로로도 이 직렬화에 들어오지 않는다(입력값을 프로필에 담지 않는다).
  const serializeProfile = (profile) => JSON.stringify({
    classdock:"dbconn", version:1, driver:"mysql",
    host:profile.host, port:profile.port, database:profile.database,
    user:profile.user, readOnly:!!profile.readOnly, color:profile.color || "", sql:profile.sql || ""
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

  /* ── 자동완성(Ctrl+Space) ────────────────────────────────────────────────
     문맥 판단은 커서 앞의 낱말과 그 바로 앞 한 조각만 본다. SQL 을 제대로 파싱하지 않는 대신
     틀려도 후보가 조금 많아질 뿐 잘못된 글자를 넣지는 않는다. */

  const SQL_KEYWORDS = [
    "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET", "JOIN", "LEFT JOIN",
    "INNER JOIN", "ON", "AS", "AND", "OR", "NOT", "NULL", "IS NULL", "IS NOT NULL", "IN", "LIKE",
    "BETWEEN", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "HAVING", "UNION", "CASE", "WHEN",
    "THEN", "ELSE", "END", "ASC", "DESC", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
    "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "EXPLAIN"
  ];

  // 커서 앞을 읽어 (이미 친 글자, 그 시작 위치, `앞.` 한정자, 바로 앞 낱말)를 낸다.
  const completionContext = (text, cursor) => {
    const value = String(text || "").slice(0, Math.max(0, cursor | 0));
    const word = /[A-Za-z_][A-Za-z0-9_$]*$/.exec(value);
    const prefix = word ? word[0] : "";
    const before = value.slice(0, value.length - prefix.length);
    const dotted = /([A-Za-z_][A-Za-z0-9_$]*)\.$/.exec(before);
    const previous = /([A-Za-z_]+)\s+$/.exec(before);
    return {
      prefix,
      start: value.length - prefix.length,
      qualifier: dotted ? dotted[1] : "",
      after: previous ? previous[1].toLowerCase() : ""
    };
  };

  // `FROM 주문 o` 처럼 붙인 별칭을 테이블 이름으로 되돌린다. `o.` 뒤에 그 테이블 컬럼을 주기 위해서다.
  const ALIAS_STOPWORDS = /^(?:on|where|set|values|group|order|limit|join|inner|left|right|outer|cross|using|having|select|as|and|or)$/i;
  const aliasMap = (sql) => {
    const map = new Map();
    const pattern = /\b(?:from|join|update|into)\s+`?([A-Za-z_ㄱ-힝][\w$ㄱ-힝]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][\w$]*)`?)?/gi;
    let match;
    while ((match = pattern.exec(String(sql || "")))){
      map.set(match[1].toLowerCase(), match[1]);
      if (match[2] && !ALIAS_STOPWORDS.test(match[2])) map.set(match[2].toLowerCase(), match[1]);
    }
    return map;
  };

  const completionCandidates = (context, schema) => {
    const tables = (schema && schema.tables) || [];
    const columns = (schema && schema.columns) || [];
    const aliases = (schema && schema.aliases) || new Map();
    const items = [];

    if (context.qualifier){
      // `별칭.` 뒤에서는 그 테이블의 컬럼만 준다. 다른 후보를 섞으면 오히려 방해가 된다.
      const table = aliases.get(context.qualifier.toLowerCase()) || context.qualifier;
      columns.forEach((column) => {
        if (column.table.toLowerCase() === table.toLowerCase())
          items.push({ label:column.name, detail:column.type, kind:"column" });
      });
    } else {
      const wantsTable = ["from", "join", "into", "update", "table"].includes(context.after);
      tables.forEach(table =>
        items.push({ label:table.name, detail:table.type === "view" ? "뷰" : "표", kind:"table" }));
      if (!wantsTable){
        const seen = new Set();
        columns.forEach((column) => {
          const key = column.name.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          items.push({ label:column.name, detail:column.table, kind:"column" });
        });
        SQL_KEYWORDS.forEach(word => items.push({ label:word, detail:"", kind:"keyword" }));
      }
    }

    const prefix = context.prefix.toLowerCase();
    const matched = prefix ? items.filter(item => item.label.toLowerCase().startsWith(prefix)) : items;
    return matched.slice(0, 40);
  };

  // 이름을 편집기에 넣을 때 그대로 써도 되는지 본다. 평범한 식별자가 아니면 역따옴표로 감싼다
  // (공백·예약어·한글 이름을 그대로 넣으면 곧바로 문법 오류가 된다).
  const identifierFor = (name) => {
    const text = String(name == null ? "" : name);
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(text) ? text : "`" + text.replace(/`/g, "``") + "`";
  };

  /* 줄 주석 토글(Ctrl+/). 고른 줄이 모두 주석이면 벗기고, 하나라도 아니면 전부 붙인다.
     DBeaver·MySQL Workbench·DataGrip 이 같은 키에 같은 규칙을 쓴다.
     DOM 없이 검사할 수 있도록 순수 함수로 둔다. */
  const toggleLineComment = (text, selectionStart, selectionEnd) => {
    const value = String(text || "");
    const start = Math.max(0, Math.min(selectionStart | 0, value.length));
    const end = Math.max(start, Math.min(selectionEnd | 0, value.length));
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd < 0) lineEnd = value.length;

    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const meaningful = lines.filter(line => line.trim());
    if (!meaningful.length) return { text:value, start:selectionStart, end:selectionEnd };
    const allCommented = meaningful.every(line => /^\s*--\s?/.test(line));
    const changed = lines.map((line) => {
      if (!line.trim()) return line;                                  // 빈 줄은 건드리지 않는다
      return allCommented ? line.replace(/^(\s*)--\s?/, "$1") : line.replace(/^(\s*)/, "$1-- ");
    });
    const replaced = changed.join("\n");
    const next = value.slice(0, lineStart) + replaced + value.slice(lineEnd);

    if (start === end){
      // 선택이 없으면 커서를 같은 줄에 남긴다(줄 앞이 늘거나 준 만큼만 민다).
      const caret = Math.max(lineStart, start + (changed[0].length - lines[0].length));
      return { text:next, start:caret, end:caret };
    }
    return { text:next, start:lineStart, end:lineStart + replaced.length };
  };

  // 되돌릴 수 없는 문장을 골라 낸다. 차단이 아니라 "이게 그 문장이다"라고 알려 주는 장치다.
  const riskyStatements = (sql) => splitStatements(sql).map((statement) => {
    const keyword = firstKeyword(statement);
    const hasWhere = /\bwhere\b/i.test(statement);
    if (keyword === "drop") return { statement, reason:"DROP — 테이블이나 데이터베이스가 사라집니다." };
    if (keyword === "truncate") return { statement, reason:"TRUNCATE — 테이블의 모든 행이 사라집니다." };
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
    let currentDatabase = profile.database || "";
    let tables = [];
    const columnCache = new Map();          // 테이블 이름 -> 컬럼 정의(트리를 다시 펼칠 때 재사용)
    let schemaColumns = [];                 // 현재 DB 의 전체 컬럼(자동완성 후보)
    let runningJob = "", runningLabel = "", runningSql = "", runningQuiet = false;
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
    const tableFilter = input("search", "", "테이블 찾기");
    tableFilter.className = "db-table-filter";
    const tableList = el("div", "db-table-list");
    sidebar.append(
      el("div", "db-sidebar-head", null),
      tableFilter, tableList
    );
    sidebar.querySelector(".db-sidebar-head").append(el("span", "db-sidebar-label", "데이터베이스"), databaseSelect);

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
    // run-save 클래스는 app.js 의 전역 Ctrl+S(saveCurrent)가 찾아 눌러 주는 표식이다.
    // 자체 키 처리기를 두면 그 경로와 두 번 겹치므로 클래스만 맞춘다.
    const saveButton = button("저장", "db-btn db-btn-quiet run-save",
      "접속 정보와 SQL 을 .dbconn 파일에 저장합니다 (Ctrl+S · 비밀번호는 저장하지 않습니다)");
    saveButton.dataset.shortcutAction = "saveCurrent";
    saveButton.dataset.shortcutTitle = "접속 문서 저장";
    const disconnectButton = button("연결 끊기", "db-btn db-btn-quiet");
    cancelButton.disabled = true;

    toolbar.append(runButton, runAllButton, cancelButton, explainButton, el("span", "db-timeout-wrap", null),
      modeBadge, serverLabel, historyButton, saveButton, disconnectButton);
    toolbar.querySelector(".db-timeout-wrap").append(el("span", null, "제한"), timeoutInput, el("span", null, "초"));

    const editorWrap = el("div", "db-editor");
    const editorHighlight = el("pre", "db-editor-highlight");
    editorHighlight.setAttribute("aria-hidden", "true");
    const editor = document.createElement("textarea");
    editor.className = "db-editor-input";
    editor.spellcheck = false;
    editor.value = profile.sql || "";
    editor.setAttribute("aria-label", "SQL 편집기");
    editorWrap.append(editorHighlight, editor);

    const resultBar = el("div", "db-result-bar");
    const resultStatus = el("span", "db-result-status", "");
    const exportCsvButton = button("CSV로 내보내기", "db-btn db-btn-quiet");
    const openSheetButton = button("표 편집기로 열기", "db-btn db-btn-quiet");
    resultBar.append(resultStatus, el("span", "db-result-spacer", null), exportCsvButton, openSheetButton);
    exportCsvButton.hidden = true;
    openSheetButton.hidden = true;

    // 여러 문장을 실행하면 결과 집합도 여러 개가 온다. 예전에는 마지막 것만 그리고 나머지를 버렸다.
    const resultTabs = el("div", "db-result-tabs");
    resultTabs.hidden = true;

    const resultHost = el("div", "db-result");

    /* 셀 값 보기 패널 — 그리드는 한 줄로 줄여 보여 주므로 긴 값은 여기서만 온전히 읽을 수 있다. */
    const valuePanel = el("aside", "db-value-panel");
    valuePanel.hidden = true;
    const valueTitle = el("strong", "db-value-title", "");
    const valueBody = el("pre", "db-value-body", "");
    const valueNote = el("p", "db-value-note", "");
    const valueCopy = button("값 복사", "db-btn db-btn-quiet");
    const valueClose = button("닫기", "db-btn db-btn-quiet");
    const valueHead = el("div", "db-value-head");
    valueHead.append(valueTitle, el("span", "db-result-spacer", null), valueCopy, valueClose);
    valuePanel.append(valueHead, valueBody, valueNote);

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
      valuePanel, historyPanel, completionBox);
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

    /* SQL 강조 ------------------------------------------------------------- */

    const syncHighlight = () => {
      if (typeof highlightCodeBase !== "function"){ editorHighlight.hidden = true; return; }
      // 마지막 줄바꿈이 잘리지 않도록 한 칸 덧댄다(textarea 와 높이를 맞춘다).
      editorHighlight.innerHTML = highlightCodeBase(editor.value + "\n", "sql");
      editorHighlight.scrollTop = editor.scrollTop;
      editorHighlight.scrollLeft = editor.scrollLeft;
    };

    /* 무엇을 실행할지 ------------------------------------------------------
       선택이 있으면 선택한 글자 그대로, 없으면 커서가 놓인 문장 하나.
       편집기 전체는 Ctrl+Shift+Enter 또는 `전체 실행` 버튼으로만 나간다.
       DBeaver·MySQL Workbench·DataGrip 이 모두 쓰는 규칙이다. */

    const runTarget = () => {
      const value = editor.value;
      const from = editor.selectionStart, to = editor.selectionEnd;
      if (from !== to){
        const picked = value.slice(from, to).trim();
        if (picked) return { sql:picked, label:"선택 실행" };
      }
      const range = statementAt(value, from);
      return range ? { sql:range.text, label:"현재 문장 실행" } : null;
    };

    const allTarget = () => {
      const sql = editor.value.trim();
      return sql ? { sql, label:"전체 실행" } : null;
    };

    const previewOf = (sql) => {
      const line = String(sql).split("\n").find(item => item.trim()) || "";
      const clean = line.trim();
      return clean.length > 60 ? clean.slice(0, 60) + "…" : clean;
    };

    // 버튼이 무엇을 실행할지 이름으로 밝힌다. 겉모습이 같은 버튼이 상황마다 다르게
    // 동작하는 것이 규칙 자체보다 위험하다.
    const refreshRunLabel = () => {
      if (runningJob) return;
      const target = runTarget();
      const total = statementRanges(editor.value).length;
      runButton.textContent = target ? target.label : "실행";
      runButton.disabled = !target || !sessionId;
      runButton.title = target ? "Ctrl+Enter — " + previewOf(target.sql) : "실행할 SQL 을 입력해 주세요.";
      runAllButton.hidden = total < 2;
      runAllButton.disabled = !sessionId;
      runAllButton.textContent = "전체 실행 (" + total + ")";
    };

    editor.addEventListener("input", () => {
      profile.sql = editor.value;
      syncHighlight();
      refreshRunLabel();
      markDirty();
    });
    editor.addEventListener("scroll", () => {
      editorHighlight.scrollTop = editor.scrollTop;
      editorHighlight.scrollLeft = editor.scrollLeft;
    });
    ["keyup", "mouseup", "select", "focus", "blur"].forEach((name) =>
      editor.addEventListener(name, refreshRunLabel));
    /* 자동완성 ------------------------------------------------------------- */

    let completionItems = [], completionIndex = 0, completionStart = 0;

    const closeCompletion = () => {
      completionBox.hidden = true;
      completionItems = [];
    };

    // 강조 오버레이 안에서 커서 위치의 사각형을 잰다. 두 층의 글꼴·여백·줄바꿈이 같아 좌표가 일치한다.
    const caretRect = () => {
      if (editorHighlight.hidden) return null;
      const offset = editor.selectionStart;
      const walker = document.createTreeWalker(editorHighlight, NodeFilter.SHOW_TEXT);
      let seen = 0, node = walker.nextNode();
      while (node){
        const length = node.nodeValue.length;
        if (seen + length >= offset){
          try {
            const range = document.createRange();
            range.setStart(node, offset - seen);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            if (rect && (rect.top || rect.left)) return rect;
          } catch(_){ /* 위치를 못 재면 편집기 아래에 붙인다 */ }
          break;
        }
        seen += length;
        node = walker.nextNode();
      }
      return null;
    };

    const highlightCompletion = () => {
      Array.from(completionBox.children).forEach((node, index) =>
        node.classList.toggle("active", index === completionIndex));
      const active = completionBox.children[completionIndex];
      if (active) active.scrollIntoView({ block:"nearest" });
    };

    const acceptCompletion = () => {
      const item = completionItems[completionIndex];
      if (!item) return;
      const value = editor.value;
      const snippet = item.kind === "keyword" ? item.label : identifierFor(item.label);
      editor.value = value.slice(0, completionStart) + snippet + value.slice(editor.selectionStart);
      const caret = completionStart + snippet.length;
      editor.setSelectionRange(caret, caret);
      closeCompletion();
      profile.sql = editor.value;
      syncHighlight();
      refreshRunLabel();
      markDirty();
    };

    const openCompletion = () => {
      const context = completionContext(editor.value, editor.selectionStart);
      const statement = statementAt(editor.value, editor.selectionStart);
      completionItems = completionCandidates(context, {
        tables, columns:schemaColumns, aliases:aliasMap(statement ? statement.text : editor.value)
      });
      if (!completionItems.length){
        closeCompletion();
        toast(schemaColumns.length ? "맞는 후보가 없습니다." : "스키마를 아직 읽지 못했습니다.", 1800);
        return;
      }
      completionStart = context.start;
      completionIndex = 0;
      completionBox.innerHTML = "";
      completionItems.forEach((item, index) => {
        const row = el("div", "db-completion-item");
        row.dataset.kind = item.kind;
        row.append(el("span", "db-completion-label", item.label));
        if (item.detail) row.append(el("span", "db-completion-detail", item.detail));
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();                       // 편집기 포커스를 뺏기지 않게
          completionIndex = index;
          acceptCompletion();
        });
        completionBox.append(row);
      });
      completionBox.hidden = false;
      const rect = caretRect();
      const anchor = rect || editor.getBoundingClientRect();
      completionBox.style.left = Math.round(anchor.left) + "px";
      completionBox.style.top = Math.round((rect ? anchor.bottom : anchor.top) + 4) + "px";
      highlightCompletion();
    };

    editor.addEventListener("blur", closeCompletion);
    editor.addEventListener("keydown", (event) => {
      if (!completionBox.hidden){
        if (event.key === "ArrowDown"){
          event.preventDefault();
          completionIndex = (completionIndex + 1) % completionItems.length;
          highlightCompletion(); return;
        }
        if (event.key === "ArrowUp"){
          event.preventDefault();
          completionIndex = (completionIndex - 1 + completionItems.length) % completionItems.length;
          highlightCompletion(); return;
        }
        if (event.key === "Enter" || event.key === "Tab"){ event.preventDefault(); acceptCompletion(); return; }
        if (event.key === "Escape"){ event.preventDefault(); closeCompletion(); return; }
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "Space"){
        event.preventDefault();
        openCompletion();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter"){
        event.preventDefault();
        closeCompletion();
        runQuery(event.shiftKey ? allTarget() : runTarget());
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "/"){
        event.preventDefault();
        const next = toggleLineComment(editor.value, editor.selectionStart, editor.selectionEnd);
        editor.value = next.text;
        editor.setSelectionRange(next.start, next.end);
        profile.sql = editor.value;
        syncHighlight();
        refreshRunLabel();
        markDirty();
      }
    });

    /* 결과 표 -------------------------------------------------------------- */

    let lastRows = null;          // MNTableExport 로 넘길 현재 결과 집합
    let resultSets = [];          // 행을 낸 문장들(탭 하나가 하나)
    let selectedCell = null;

    const closeValuePanel = () => {
      valuePanel.hidden = true;
      if (selectedCell){ selectedCell.classList.remove("selected"); selectedCell = null; }
    };

    /* 셀 하나를 온전히 보여 준다. 그리드는 한 줄로 줄여 그리므로 여러 줄 값과 긴 값은
       여기서만 제대로 읽을 수 있다. 서버에서 잘라 온 값은 그렇다고 밝힌다 — 잘린 값을
       전부인 것처럼 보여 주면 화면이 거짓말을 하는 셈이 된다. */
    const openValuePanel = (title, text, note, isNull) => {
      valuePanel.hidden = false;
      valueTitle.textContent = title;
      valueBody.textContent = text;
      valueBody.classList.toggle("db-value-null", !!isNull);
      valueNote.textContent = note;
      valueCopy.disabled = !!isNull;
      valuePanel.scrollIntoView({ block:"nearest" });
    };

    const showCellValue = (td, columnName, value, clipped) => {
      if (selectedCell) selectedCell.classList.remove("selected");
      selectedCell = td;
      td.classList.add("selected");
      const text = value === null ? "NULL" : String(value);
      let note;
      if (value === null) note = "빈 값(NULL)입니다.";
      else if (/^<BLOB \d+ bytes>$/.test(text)) note = "이진 데이터라 내용을 표시하지 않습니다. 크기만 가져왔습니다.";
      else if (clipped) note = "서버에서 500자까지만 가져온 값입니다. 전체가 필요하면 그 컬럼만 따로 조회해 주세요.";
      else note = text.length.toLocaleString() + "자";
      openValuePanel(columnName, text, note, value === null);
    };

    // 편집기 커서 자리에 이름을 넣는다. 스키마 트리에서 고른 이름을 손으로 옮겨 적지 않게 한다.
    const insertIntoEditor = (snippet) => {
      const start = editor.selectionStart, end = editor.selectionEnd;
      const value = editor.value;
      editor.value = value.slice(0, start) + snippet + value.slice(end);
      const caret = start + snippet.length;
      editor.setSelectionRange(caret, caret);
      editor.focus();
      profile.sql = editor.value;
      syncHighlight();
      refreshRunLabel();
      markDirty();
    };

    valueClose.addEventListener("click", closeValuePanel);
    valueCopy.addEventListener("click", () => {
      const text = valueBody.textContent;
      if (typeof copyDocumentMenuText === "function") copyDocumentMenuText(text, "셀 값을 복사했어요.");
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("셀 값을 복사했어요.", 1800));
    });

    let currentGrid = null;      // 지금 그려 둔 표(더 보기가 뒤에 행을 이어 붙인다)

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
          td.title = "클릭하면 값 전체를 봅니다";
          td.addEventListener("click", () => showCellValue(td, columns[columnIndex] || "", value, isClipped));
          tr.append(td);
        });
        bodyEl.append(tr);
      });
    };

    const appendRows = (columns, rows, clippedCells, startIndex) => {
      if (!currentGrid) return;
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
      const head = el("thead");
      const headRow = el("tr");
      headRow.append(el("th", "db-grid-index", "#"));
      const sorted = sortable ? orderByState(sortable.sql) : null;
      columns.forEach((name) => {
        const th = el("th", null, name);
        if (sortable){
          const active = sorted && sorted.column === name;
          th.classList.add("db-sortable");
          if (active) th.classList.add("db-sorted");
          th.append(el("span", "db-sort-mark", active ? (sorted.direction === "desc" ? "▼" : "▲") : "↕"));
          th.title = "클릭하면 이 컬럼으로 정렬합니다 — 편집기의 ORDER BY 를 고쳐 서버에 다시 묻습니다"
            + (active ? (sorted.direction === "desc" ? " (한 번 더 누르면 정렬 해제)" : " (한 번 더 누르면 내림차순)") : "");
          th.addEventListener("click", () => sortable.onSort(name, sorted));
        }
        headRow.append(th);
      });
      head.append(headRow);
      const bodyEl = el("tbody");
      table.append(head, bodyEl);
      resultHost.append(table);
      currentGrid = { body:bodyEl, columns:columns.slice() };
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
      renderRows(entry.columns, entry.rows, entry.truncated, entry.clippedCells, sortableFor(entry));
      attachMoreButton(entry);
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

    const renderStatements = (statements, label, elapsed) => {
      clearResult();
      resultSets = statements.filter(item => item && item.kind === "rows");
      const summary = statements.map((item) => {
        if (item.kind === "rows") return (item.keyword || "select").toUpperCase() + " " + item.rows.length + "행";
        return (item.keyword || "").toUpperCase() + " " + item.affected + "행 반영";
      }).join(" · ");
      resultStatus.textContent = [label, summary || "실행할 문장이 없습니다.", elapsed]
        .filter(Boolean).join(" — ");
      if (resultSets.length > 1){
        resultTabs.hidden = false;
        resultSets.forEach((entry, index) => {
          const tab = button("결과 " + (index + 1) + " · " + entry.rows.length + "행", "db-result-tab");
          tab.addEventListener("click", () => showResultSet(index));
          resultTabs.append(tab);
        });
      }
      if (resultSets.length) showResultSet(0);
    };

    /* 스키마 --------------------------------------------------------------- */

    const renderTableList = () => {
      const needle = tableFilter.value.trim().toLowerCase();
      const shown = needle ? tables.filter(item => item.name.toLowerCase().includes(needle)) : tables;
      tableList.innerHTML = "";
      if (!tables.length){
        tableList.append(el("p", "db-empty", currentDatabase ? "테이블이 없습니다." : "데이터베이스를 골라 주세요."));
        return;
      }
      if (!shown.length){
        tableList.append(el("p", "db-empty", "찾는 이름의 테이블이 없습니다."));
        return;
      }
      shown.forEach((item) => {
        const entry = el("div", "db-table-entry");
        const row = el("div", "db-table-row");

        const toggle = button("▸", "db-table-toggle", "컬럼 펼치기");
        toggle.setAttribute("aria-expanded", "false");
        const name = button(item.name, "db-table-item", item.comment || item.name);
        name.dataset.kind = item.type;
        name.append(el("span", "db-table-kind", item.type === "view" ? "뷰" : "표"));
        name.addEventListener("click", () => showTable(item.name));
        const insert = button("＋", "db-table-insert", "편집기에 이름 넣기");
        insert.addEventListener("click", () => insertIntoEditor(identifierFor(item.name)));

        row.append(toggle, name, insert);
        const columnHost = el("div", "db-column-list");
        columnHost.hidden = true;
        entry.append(row, columnHost);
        tableList.append(entry);

        toggle.addEventListener("click", async () => {
          if (!columnHost.hidden){
            columnHost.hidden = true;
            toggle.textContent = "▸";
            toggle.setAttribute("aria-expanded", "false");
            return;
          }
          columnHost.hidden = false;
          toggle.textContent = "▾";
          toggle.setAttribute("aria-expanded", "true");
          if (columnHost.dataset.loaded === "1") return;
          columnHost.innerHTML = "";
          columnHost.append(el("p", "db-empty", "컬럼을 읽는 중…"));
          try {
            const columns = await loadColumnsFor(item.name);
            columnHost.innerHTML = "";
            if (!columns.length){ columnHost.append(el("p", "db-empty", "컬럼이 없습니다.")); return; }
            columns.forEach((column) => {
              const label = column.name + (column.key === "PRI" ? " ·" : "");
              const node = button(label, "db-column-item",
                column.name + " " + column.type + (column.nullable ? "" : " NOT NULL")
                  + (column.comment ? " — " + column.comment : ""));
              if (column.key === "PRI") node.classList.add("db-column-key");
              node.append(el("span", "db-column-type", column.type));
              node.addEventListener("click", () => insertIntoEditor(identifierFor(column.name)));
              columnHost.append(node);
            });
            columnHost.dataset.loaded = "1";
          } catch(error){
            columnHost.innerHTML = "";
            columnHost.append(el("p", "db-empty", launcherMessage(error)));
          }
        });
      });
    };

    // 트리를 펼칠 때만 쓰는 컬럼 조회. 같은 테이블을 다시 펼쳐도 서버를 또 부르지 않는다.
    const loadColumnsFor = async (name) => {
      if (columnCache.has(name)) return columnCache.get(name);
      const url = "/db-table?id=" + encodeURIComponent(sessionId)
        + "&name=" + encodeURIComponent(name) + "&mode=columns";
      const response = await jsonOf(await fetch(url, { cache:"no-store" }));
      if (!response.ok) throw new Error(messageFor(response.info));
      const columns = response.info.columns || [];
      columnCache.set(name, columns);
      return columns;
    };

    const loadSchema = async () => {
      const response = await jsonOf(await fetch("/db-schema?id=" + encodeURIComponent(sessionId), { cache:"no-store" }));
      if (!response.ok){ toast(messageFor(response.info), 4000); return; }
      const info = response.info;
      currentDatabase = info.current || "";
      tables = Array.isArray(info.tables) ? info.tables : [];
      columnCache.clear();
      databaseSelect.innerHTML = "";
      if (!currentDatabase) databaseSelect.append(new Option("(선택 안 함)", ""));
      (info.databases || []).forEach((name) => databaseSelect.append(new Option(name, name)));
      databaseSelect.value = currentDatabase;
      renderTableList();
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
        const ddlButton = button("DDL 보기", "db-btn db-btn-quiet db-count-btn",
          "이 테이블을 만드는 CREATE 문을 봅니다");
        ddlButton.addEventListener("click", async () => {
          ddlButton.disabled = true;
          try {
            const ddl = await jsonOf(await fetch(url + "&mode=ddl", { cache:"no-store" }));
            if (!ddl.ok){ toast(messageFor(ddl.info), 4000); return; }
            const text = ddl.info.ddl || "";
            openValuePanel(name + " · DDL", text, text.length.toLocaleString() + "자", false);
          } catch(error){ toast(launcherMessage(error), 4000); }
          finally { ddlButton.disabled = false; }
        });
        resultHost.prepend(countRow, ddlButton);
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

    tableFilter.addEventListener("input", renderTableList);

    /* 실행 ----------------------------------------------------------------- */

    const setRunning = (running) => {
      cancelButton.disabled = !running;
      runAllButton.disabled = running || !sessionId;
      if (running){
        runButton.disabled = true;
        runButton.textContent = "실행 중…";
      } else refreshRunLabel();
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
            resultStatus.textContent = messageFor(response.info);
            clearResult();
            return;
          }
          if (!runningQuiet) rememberQuery(runningSql, response.info.ms, true);
          renderStatements(response.info.statements || [], runningLabel, formatMs(response.info.ms));
        } catch(error){
          runningJob = "";
          setRunning(false);
          resultStatus.textContent = launcherMessage(error);
        }
      }, POLL_MS);
    };

    const runQuery = async (target) => {
      if (!sessionId || runningJob) return;
      const chosen = target || runTarget();
      const sql = chosen ? chosen.sql.trim() : "";
      if (!sql){ toast("실행할 SQL 을 입력해 주세요.", 2200); return; }

      // 확인 대상은 편집기 전체가 아니라 실제로 보낼 것만이다. 아래에 적어 둔 DROP 때문에
      // 위의 SELECT 하나에도 확인창이 뜨면 확인창을 아무도 읽지 않게 된다.
      const risky = riskyStatements(sql);
      if (risky.length && typeof confirmDialog === "function"){
        const lines = risky.slice(0, 5).map(item => "· " + item.reason).join("\n");
        const ok = await confirmDialog(
          "되돌릴 수 없는 문장이 있습니다.\n\n" + lines
            + (risky.length > 5 ? "\n· 그 밖 " + (risky.length - 5) + "건" : "")
            + "\n\n그대로 실행할까요?",
          "실행", "취소");
        if (!ok) return;
      }

      runningLabel = chosen.label;
      runningSql = sql;
      runningQuiet = !!chosen.quiet;
      setRunning(true);
      clearResult();
      resultStatus.textContent = chosen.label + " — 실행 중…";
      try {
        const response = await jsonOf(await fetch("/db-query?id=" + encodeURIComponent(sessionId), {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([sql, String(timeoutInput.value || DEFAULT_TIMEOUT)])
        }));
        runningJob = response.job;
        pollQuery();
      } catch(error){
        setRunning(false);
        resultStatus.textContent = launcherMessage(error);
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
      markDirty();

      connectButton.disabled = true;
      connectButton.textContent = "연결 중…";
      statusLine.textContent = "";
      try {
        const response = await jsonOf(await fetch("/db-session-open", {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" },
          body:encodeStrings([profile.host, String(profile.port), profile.database,
            profile.user, passwordInput.value, profile.readOnly ? "1" : "0"])
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
        serverLabel.textContent = response.label + (response.info.serverVersion ? " · MySQL " + response.info.serverVersion : "");
        showWorkspace(true);
        applyColor();
        syncHighlight();
        refreshRunLabel();
        await loadSchema();
        editor.focus();
      } catch(error){
        statusLine.textContent = launcherMessage(error);
      } finally {
        connectButton.disabled = false;
        connectButton.textContent = "연결";
      }
    };

    const disconnect = async (silent) => {
      stopPolling();
      runningJob = "";
      const id = sessionId;
      sessionId = "";
      if (!id) return;
      try { await fetch("/db-session-close?id=" + encodeURIComponent(id), { method:"POST" }); } catch(_){}
      if (silent) return;
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
    const onUnload = () => {
      if (!sessionId) return;
      try { navigator.sendBeacon("/db-session-close?id=" + encodeURIComponent(sessionId)); } catch(_){}
    };
    window.addEventListener("beforeunload", onUnload);
    doc.cleanupFns.push(() => window.removeEventListener("beforeunload", onUnload));

    showWorkspace(false);
    applyColor();
    syncHighlight();
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

  return { COLORS, COLOR_LABELS, SQL_KEYWORDS, emptyProfile, parseProfile, serializeProfile,
    statementRanges, splitStatements, statementAt, firstKeyword, riskyStatements,
    identifierFor, toggleLineComment, completionContext, completionCandidates, aliasMap,
    orderBySpot, applyOrderBy, orderByState, messageFor, mount };
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
