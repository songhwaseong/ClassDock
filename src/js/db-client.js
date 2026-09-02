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
      case "dependency":        return "다른 객체가 사용 중이라 삭제하거나 변경할 수 없습니다. " + detail;
      case "connection-lost":   return "서버와의 연결이 끊어졌습니다. 다시 연결해 주세요.";
      case "cancelled":         return "쿼리를 취소했습니다.";
      case "read-only":         return "읽기 전용 접속이라 쓰기 문장을 실행할 수 없습니다.";
      case "read-only-blocked": return "읽기 전용 접속입니다. " + detail + " 문장을 실행하려면 접속을 끊고 '쓰기 허용'을 켜서 다시 연결해 주세요.";
      case "not-connected":     return "접속이 끊어졌습니다. 다시 연결해 주세요.";
      case "tx-pending":        return "커밋하지 않은 변경이 있습니다. 먼저 커밋하거나 롤백해 주세요.";
      case "tx-auto-commit":    return "자동 커밋 상태라 확정할 변경이 없습니다.";
      case "job-not-found":     return "실행 기록을 찾지 못했습니다. 다시 실행해 주세요.";
      case "row-gone":          return "그 행을 찾지 못했습니다. 다른 곳에서 지웠거나 기본키가 바뀐 것 같습니다. 다시 조회해 주세요.";
      case "binary-cell":       return "이진 데이터라 글자로 고칠 수 없습니다.";
      case "bad-cell-target":   return "고칠 칸이 어디인지 알아내지 못했습니다. 다시 조회해 주세요.";
      case "bad-cell-key":      return "행을 짚을 기본키 값을 알아내지 못했습니다. 다시 조회해 주세요.";
      case "bad-change-kind":   return "알 수 없는 변경입니다. 결과를 다시 조회해 주세요.";
      case "no-changes":        return "적용할 변경이 없습니다.";
      case "too-many-changes":  return "한 번에 적용할 수 있는 변경은 500건까지입니다. 나눠서 적용해 주세요.";
      case "too-many-values":   return "한 행에 넣을 수 있는 값의 수를 넘었습니다.";
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
    if (raw.indexOf("db-bad-cell") >= 0) return "고칠 칸을 알아내지 못했습니다. 결과를 다시 조회해 주세요.";
    if (raw.indexOf("db-bad-change") >= 0) return "변경 목록을 읽지 못했습니다. 결과를 다시 조회해 주세요.";
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

  const SIDEBAR_COLLAPSED_KEY = "classdockDbSidebarCollapsedV1";
  const readSidebarCollapsed = () => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; } catch(_){ return false; }
  };
  const storeSidebarCollapsed = (collapsed) => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false"); } catch(_){}
  };

  const EDITOR_KEY = "classdockDbEditorHeightV1";
  const EDITOR_MIN = 90, EDITOR_DEFAULT = 180, EDITOR_KEEP_RESULT = 240;
  const RESULT_LAYOUT_KEY = "classdockDbResultLayoutV1";
  const EDITOR_WIDTH_KEY = "classdockDbEditorWidthV1";
  const EDITOR_WIDTH_MIN = 260, EDITOR_WIDTH_DEFAULT = 520, EDITOR_KEEP_RESULT_WIDTH = 320;
  const EDITOR_COLOR_LIGHT_KEY = "classdockDbEditorTextColorLightV1";
  const EDITOR_COLOR_DARK_KEY = "classdockDbEditorTextColorDarkV1";
  const RESULT_COLOR_LIGHT_KEY = "classdockDbResultTextColorLightV1";
  const RESULT_COLOR_DARK_KEY = "classdockDbResultTextColorDarkV1";

  const readEditorHeight = () => {
    try {
      const value = Number(localStorage.getItem(EDITOR_KEY));
      return Number.isFinite(value) && value >= EDITOR_MIN ? value : 0;
    } catch(_){ return 0; }
  };

  const storeEditorHeight = (height) => {
    try { localStorage.setItem(EDITOR_KEY, String(Math.round(height))); } catch(_){}
  };

  const readResultLayout = () => {
    try { return localStorage.getItem(RESULT_LAYOUT_KEY) === "side" ? "side" : "below"; }
    catch(_){ return "below"; }
  };

  const storeResultLayout = (layout) => {
    try { localStorage.setItem(RESULT_LAYOUT_KEY, layout === "side" ? "side" : "below"); } catch(_){}
  };

  const readEditorWidth = () => {
    try {
      const value = Number(localStorage.getItem(EDITOR_WIDTH_KEY));
      return Number.isFinite(value) && value >= EDITOR_WIDTH_MIN ? value : 0;
    } catch(_){ return 0; }
  };

  const storeEditorWidth = (width) => {
    try { localStorage.setItem(EDITOR_WIDTH_KEY, String(Math.round(width))); } catch(_){}
  };

  /* ── SQL 문장 나누기(확인 창 판단용) ──────────────────────────────────────
     실제 실행 단위는 워커(db_worker.py)가 다시 나눈다. 여기서 나누는 이유는
     되돌릴 수 없는 문장을 보내기 전에 화면에서 먼저 확인받기 위해서다. */

  // MySQL CLI 의 DELIMITER 지시어까지 해석한다. 지시어 자체는 서버로 보내지 않고,
  // 그 다음 문장을 어디까지 한 덩어리로 볼지만 바꾼다. 그래서 BEGIN ... END 안의
  // 세미콜론은 그대로 남고 CREATE PROCEDURE 전체가 한 문장이 된다.
  const delimiterDirectiveAt = (text, index, hasCode) => {
    if (hasCode || (index > 0 && text[index - 1] !== "\n")) return null;
    const lineEnd = text.indexOf("\n", index);
    const end = lineEnd < 0 ? text.length : lineEnd + 1;
    const line = text.slice(index, lineEnd < 0 ? text.length : lineEnd).replace(/\r$/, "");
    const match = /^\s*DELIMITER[ \t]+(\S+)[ \t]*$/i.exec(line);
    return match ? { delimiter:match[1], end } : null;
  };

  // 원문에서의 위치(start·end)까지 함께 돌려준다. 커서가 놓인 문장 하나만 실행하려면
  // 잘라 낸 문자열만으로는 부족하고 어디서 어디까지인지를 알아야 한다.
  const statementRanges = (sql) => {
    const text = String(sql || ""), length = text.length;
    const bounds = [];
    let delimiter = ";", segmentStart = 0, index = 0, hasCode = false;
    while (index < length){
      const directive = delimiterDirectiveAt(text, index, hasCode);
      if (directive){
        // 지시어 앞의 빈 줄·주석은 실행 문장이 아니다. 다음 실제 문장부터 범위를 잡는다.
        delimiter = directive.delimiter;
        segmentStart = directive.end;
        index = directive.end;
        hasCode = false;
        continue;
      }
      const char = text[index];
      if (char === "'" || char === '"' || char === "`"){
        hasCode = true;
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
      if (text.startsWith(delimiter, index)){
        bounds.push([segmentStart, index, delimiter]);
        index += delimiter.length;
        segmentStart = index;
        hasCode = false;
        continue;
      }
      if (!/\s/.test(char)) hasCode = true;
      index++;
    }
    bounds.push([segmentStart, length, delimiter]);

    const ranges = [];
    bounds.forEach((pair) => {
      const raw = text.slice(pair[0], pair[1]);
      const trimmed = raw.trim();
      if (!trimmed) return;
      // 앞은 전부 공백이므로 trimmed 의 첫 등장 위치가 곧 문장 시작이다.
      const start = pair[0] + raw.indexOf(trimmed);
      ranges.push({
        start, end:start + trimmed.length, text:trimmed,
        line:text.slice(0, start).split("\n").length,
        endLine:text.slice(0, start + trimmed.length).split("\n").length,
        delimiter:pair[2] || ";"
      });
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

  const chooseScriptDelimiter = (text, preferred) => {
    const candidates = [preferred, "$$", "//", ";;", "@@", "§§"].filter(Boolean);
    return candidates.find(token => token !== ";" && !String(text || "").includes(token)) || "§§";
  };

  const wrapDelimitedStatement = (statement, preferred) => {
    const body = String(statement || "").trim();
    if (!body) return "";
    const delimiter = chooseScriptDelimiter(body, preferred);
    return "DELIMITER " + delimiter + "\n" + body + delimiter + "\nDELIMITER ;";
  };

  // CREATE PROCEDURE/FUNCTION/TRIGGER/EVENT 의 머리. 본문에 세미콜론이 들어 있어
  // 문장 나누기·정렬 양쪽에서 "통째로 다뤄야 하는 덩어리" 판정에 쓴다.
  const ROUTINE_HEAD = /^CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i;
  const stripLeadingComments = (text) => String(text || "").replace(
    /^(?:\s|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");

  // 커서 실행은 statementRanges가 DELIMITER 줄을 뺀 본문만 돌려준다. 그 본문을 그대로
  // 워커에 보내면 다시 세미콜론으로 잘리므로 사용자 지정 구분자를 잠시 복원한다.
  // 사용자가 CREATE 복합문 본문만 직접 선택한 경우도 같은 방식으로 보호한다.
  const compoundExecutionScript = (statement, delimiter) => {
    const text = String(statement || "").trim();
    if (!text || /^\s*DELIMITER\b/im.test(text)) return text;
    if (delimiter && delimiter !== ";") return wrapDelimitedStatement(text, delimiter);
    const routine = ROUTINE_HEAD.test(stripLeadingComments(text));
    return routine && text.includes(";") ? wrapDelimitedStatement(text) : text;
  };

  /* ── SQL 정렬(sql-formatter) ────────────────────────────────────────────
     라이브러리는 DELIMITER 지시어를 모른다. 편집기 내용을 통째로 넘기면 끝을
     "END $$ DELIMITER;" 처럼 한 줄로 붙여 놓는데, delimiterDirectiveAt 은 줄 단독
     DELIMITER 만 인정하므로 구분자 되돌리기가 사라지고 뒤 문장이 앞 문장에 먹혀
     서버로 잘못 나간다. 그래서 라이브러리에는 문장 하나씩만 물리고, 아래는 손대지 않는다.
       · 구분자가 ; 가 아닌 문장 — DELIMITER 로 감싼 프로시저·함수 본문
       · 라이브러리가 읽지 못한 문장 — 따옴표를 안 닫은 채 타이핑 중인 경우 등
     마지막으로 정렬 뒤 문장 나누기 결과가 달라지면 통째로 원문을 돌려준다.
     보기 좋은 것보다 "실행되는 문장이 그대로인 것"이 먼저다. */
  const SQL_FORMAT_OPTIONS = { language:"mysql", keywordCase:"upper" };

  /* format 은 sql-formatter 의 format(text, options). 라이브러리를 직접 붙잡지 않고
     인자로 받는 이유는 지연 로드(MNLazy)와 테스트가 같은 함수를 쓰게 하기 위해서다.
     limit({from,to}) 를 주면 그 범위에 걸친 문장만 손본다(우클릭 메뉴의 선택 영역 정렬).
     → { text, formatted, skipped, reason } */
  const formatSqlText = (sql, format, limit) => {
    const text = String(sql || "");
    const asIs = (reason) => ({ text, formatted:0, skipped:0, reason: reason || "" });
    if (!text.trim() || typeof format !== "function") return asIs("empty");
    const ranges = statementRanges(text);
    if (!ranges.length) return asIs("empty");
    /* DELIMITER 없이 쓴 프로시저는 본문이 세미콜론마다 조각나 들어온다. 조각을 따로
       정렬하면 한 덩어리였다는 사실이 지워지므로 이때는 아무것도 하지 않는다
       (커서 실행은 compoundExecutionScript 가 같은 판정으로 다시 감싸 준다). */
    if (ranges.some(range => range.delimiter === ";" && ROUTINE_HEAD.test(stripLeadingComments(range.text)))){
      return asIs("routine");
    }
    /* 선택 영역이 있으면 거기에 걸친 문장만 정렬한다. 문장 한가운데만 골랐어도 그 문장은
       통째로 정렬한다 — 절반만 다시 쓰면 남은 절반과 들여쓰기가 어긋난다. */
    const from = limit ? Number(limit.from) : NaN, to = limit ? Number(limit.to) : NaN;
    const limited = Number.isFinite(from) && Number.isFinite(to) && to > from;
    let out = text, formatted = 0, skipped = 0;
    for (let index = ranges.length - 1; index >= 0; index--){   // 뒤에서부터 갈아 끼워야 앞 문장의 위치가 살아 있다
      const range = ranges[index];
      if (limited && (range.end <= from || range.start >= to)) continue;   // 선택과 겹치지 않는 문장
      if (range.delimiter !== ";"){ skipped++; continue; }
      let next;
      try { next = String(format(range.text, SQL_FORMAT_OPTIONS) || "").trim(); }
      catch(_){ skipped++; continue; }                          // 못 읽는 문장은 원문 그대로
      if (!next){ skipped++; continue; }
      out = out.slice(0, range.start) + next + out.slice(range.end);
      formatted++;
    }
    if (splitStatements(out).length !== ranges.length) return asIs("unsafe");
    return { text: out, formatted, skipped, reason:"" };
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

  /* 정의 창으로 볼 수 있는 객체. */
  const DEFINITION_OBJECT_KINDS = { procedure:true, function:true, event:true, trigger:true };
  // 스키마 트리의 종류 중 덤프가 그대로 받는 것. 컬럼·인덱스·외래키는 딸린 테이블로 바꿔 넘긴다.
  const DUMP_KINDS_FROM_TREE = { table:"table", view:"view", procedure:"procedure",
    function:"function", trigger:"trigger", event:"event" };

  /* 그중 편집기에서 Ctrl+클릭으로 찾아갈 수 있는 것. 스키마를 읽을 때 목록을 통째로 받는 것만 든다 —
     테이블을 펼쳐야 알 수 있는 객체를 여기 넣으면 펼친 것만 링크가 되어 동작이 들쭉날쭉해진다. */
  const LINKABLE_OBJECT_KINDS = { procedure:true, function:true, event:true, trigger:true };

  /* 루틴 이름 앞에 놓이는 키워드. 스키마 한정(`db.이름`)과 역따옴표도 같은 참조로 본다.
     테이블과 달리 루틴은 FROM·JOIN 같은 단서가 없어, 이름만 같으면 링크로 만들면
     주석·문자열·컬럼명까지 걸린다. 그래서 실제 참조 형태일 때만 대상으로 삼는다. */
  const ROUTINE_REFERENCE = {
    procedure: /\b(?:call|procedure)\s+(?:`?[A-Za-z_$글-힣][\w$글-힣]*`?\s*\.\s*)?`?$/i,
    function: /\bfunction\s+(?:`?[A-Za-z_$글-힣][\w$글-힣]*`?\s*\.\s*)?`?$/i,
    event: /\bevent\s+(?:`?[A-Za-z_$글-힣][\w$글-힣]*`?\s*\.\s*)?`?$/i,
    trigger: /\btrigger\s+(?:`?[A-Za-z_$글-힣][\w$글-힣]*`?\s*\.\s*)?`?$/i
  };

  // 프로시저·함수는 호출 형태(`이름(`)만으로도 참조로 인정한다. 이벤트·트리거는 호출 문법이 없어
  // CREATE·ALTER·DROP 뒤의 키워드로만 찾는다.
  const routineReferenceAt = (text, wordInfo, kind) => {
    const source = String(text || "");
    const start = Number(wordInfo.start) || 0;
    const end = Number.isFinite(wordInfo.end) ? wordInfo.end : start + String(wordInfo.word).length;
    if (kind === "procedure" || kind === "function"){
      if (/^\s*\(/.test(source.slice(end))) return true;
    }
    const pattern = ROUTINE_REFERENCE[kind];
    return !!pattern && pattern.test(source.slice(0, start));
  };

  /* SQL 편집기의 Ctrl+클릭 대상. 현재 DB의 테이블·뷰와 별칭, 그리고 프로시저·함수·이벤트·트리거를 해석한다.
     이름이 겹치면 테이블이 먼저다 — FROM 뒤에 적힌 이름을 루틴 정의로 열면 안 된다. */
  const sqlDefinitionTargetAt = (source, wordInfo, objects) => {
    if (!wordInfo || !wordInfo.word) return null;
    const text = String(source || "");
    const list = Array.isArray(objects) ? objects : [];
    const word = String(wordInfo.word);
    const statement = statementAt(text, Number.isFinite(wordInfo.point) ? wordInfo.point : wordInfo.start);
    const tableName = aliasMap(statement ? statement.text : text).get(word.toLowerCase());
    if (tableName){
      const item = list.find(candidate => candidate
        && (candidate.type === "table" || candidate.type === "view")
        && String(candidate.name).toLowerCase() === tableName.toLowerCase());
      if (item) return { kind:"table", name:item.name, item };
    }
    const routine = list.find(candidate => candidate && LINKABLE_OBJECT_KINDS[candidate.type]
      && String(candidate.name).toLowerCase() === word.toLowerCase());
    if (!routine || !routineReferenceAt(text, wordInfo, routine.type)) return null;
    return { kind:"routine", name:routine.name, item:routine };
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

  // SHOW CREATE 로 읽은 복합문을 다시 편집·실행할 수 있는 MySQL CLI 스크립트로 감싼다.
  // MySQL 은 프로시저·함수·트리거·이벤트에 CREATE OR REPLACE가 없으므로 교체는 DROP+CREATE다.
  const routineEditScript = (item, ddl, database) => {
    const kind = String(item && item.type || "").toLowerCase();
    const keywords = { procedure:"PROCEDURE", function:"FUNCTION", trigger:"TRIGGER", event:"EVENT" };
    if (!keywords[kind] || !item || !item.name || !String(ddl || "").trim()) return "";
    const body = String(ddl).trim();
    const target = (database ? ddlIdentifier(database) + "." : "") + ddlIdentifier(item.name);
    const drop = "DROP " + keywords[kind] + " IF EXISTS " + target;
    const delimiter = chooseScriptDelimiter(body + "\n" + drop);
    return "DELIMITER " + delimiter + "\n\n" + drop + delimiter + "\n\n"
      + body + delimiter + "\n\nDELIMITER ;";
  };

  /* 정의문에서 매개변수 목록을 뽑는다. 서버에 따로 묻지 않고 이미 받은 CREATE 문만 읽는다.
     역따옴표 이름 안의 괄호·쉼표와 DECIMAL(10,2) 같은 중첩 괄호를 세지 않도록 깊이를 센다.
     읽지 못하면 빈 목록을 준다 — 정의 탭은 그대로 보이므로 창이 쓸모없어지지는 않는다.
     반환형은 여기서 읽지 않는다. 스키마 목록의 dataType 이 이미 정확하다. */
  const routineParameters = (ddl, kind) => {
    const text = String(ddl || "");
    if (kind !== "procedure" && kind !== "function") return [];
    // 이름이 역따옴표로 감싸여 있으면 그 안의 괄호는 건너뛰고 여는 괄호를 찾는다.
    let open = -1;
    for (let index = 0; index < text.length; index++){
      const char = text[index];
      if (char === "`"){
        const stop = text.indexOf("`", index + 1);
        index = stop < 0 ? text.length : stop;
        continue;
      }
      if (char === "("){ open = index; break; }
    }
    if (open < 0) return [];
    let depth = 0, close = -1;
    for (let index = open; index < text.length; index++){
      const char = text[index];
      if (char === "`"){
        const stop = text.indexOf("`", index + 1);
        index = stop < 0 ? text.length : stop;
        continue;
      }
      if (char === "("){ depth++; continue; }
      if (char === ")" && !--depth){ close = index; break; }
    }
    if (close < 0) return [];
    const inside = text.slice(open + 1, close);
    const parts = [];
    let start = 0;
    depth = 0;
    for (let index = 0; index < inside.length; index++){
      const char = inside[index];
      if (char === "`"){
        const stop = inside.indexOf("`", index + 1);
        index = stop < 0 ? inside.length : stop;
        continue;
      }
      if (char === "("){ depth++; continue; }
      if (char === ")"){ depth--; continue; }
      if (char === "," && !depth){ parts.push(inside.slice(start, index)); start = index + 1; }
    }
    parts.push(inside.slice(start));
    return parts.map(part => part.trim()).filter(Boolean).map(part => {
      const direction = /^(in|out|inout)\s+/i.exec(part);
      const rest = direction ? part.slice(direction[0].length) : part;
      // 프로시저 매개변수의 기본 방향은 IN 이다(MySQL 이 생략을 그렇게 읽는다).
      const label = direction ? direction[1].toUpperCase() : "IN";
      const name = /^`((?:[^`]|``)+)`|^([A-Za-z_$글-힣][\w$글-힣]*)/.exec(rest);
      if (!name) return { name:rest, direction:label, type:"" };
      return {
        name: name[1] ? name[1].replace(/``/g, "`") : name[2],
        direction: label,
        type: rest.slice(name[0].length).trim()
      };
    });
  };

  const schemaObjectLabel = (item) => ({
    table:"테이블", view:"뷰", column:"컬럼", index:"인덱스", foreignKey:"외래키",
    procedure:"프로시저", function:"함수", trigger:"트리거", event:"이벤트"
  })[String(item && item.type || "")] || "객체";

  // 트리 삭제가 만드는 문장은 화면 확인용이면서 실제 실행문이다. 객체 이름은 서버에서
  // 읽었더라도 언제나 식별자로 다시 인용한다. 하위 객체는 부모 테이블이 반드시 필요하다.
  const schemaDropSql = (item, database) => {
    const type = String(item && item.type || "");
    const name = String(item && item.name || "");
    const schema = String(database || item && item.database || "");
    if (!name || !schema) return "";
    const target = ddlIdentifier(schema) + "." + ddlIdentifier(name);
    const table = item && item.table
      ? ddlIdentifier(schema) + "." + ddlIdentifier(item.table) : "";
    if (type === "table") return "DROP TABLE " + target + ";";
    if (type === "view") return "DROP VIEW " + target + ";";
    if (type === "procedure") return "DROP PROCEDURE " + target + ";";
    if (type === "function") return "DROP FUNCTION " + target + ";";
    if (type === "trigger") return "DROP TRIGGER " + target + ";";
    if (type === "event") return "DROP EVENT " + target + ";";
    if (!table) return "";
    if (type === "column") return "ALTER TABLE " + table + " DROP COLUMN " + ddlIdentifier(name) + ";";
    if (type === "index") return "ALTER TABLE " + table + " "
      + (name.toUpperCase() === "PRIMARY" ? "DROP PRIMARY KEY" : "DROP INDEX " + ddlIdentifier(name)) + ";";
    if (type === "foreignKey") return "ALTER TABLE " + table + " DROP FOREIGN KEY " + ddlIdentifier(name) + ";";
    return "";
  };

  /* 셀 편집 미리보기 --------------------------------------------------------
     화면에 보여 줄 UPDATE 문장을 만든다. 실제로 서버에 나가는 것은 이 글자가 아니다 —
     워커가 같은 모양의 문장을 자리표시자(%s)로 만들고 값은 따로 실어 보낸다. 여기서
     따옴표를 붙이는 것은 사람이 읽으라고 하는 일이지 SQL 을 조립하는 일이 아니다.
     조건은 언제나 기본키다. 옛 값을 조건에 섞지 않는다 — 표의 값은 500자에서 잘리거나
     글자로 옮겨진 것이라(소수점·날짜) 아무도 바꾸지 않았는데 0행이 반영되는 일이 잦다. */
  const targetName = (target) => (target && target.database ? ddlIdentifier(target.database) + "." : "")
    + ddlIdentifier((target && target.table) || "");

  const keyWherePreview = (keys) => {
    const where = (keys || []).map(key => ddlIdentifier(key.name) + " = " + ddlString(key.value)).join(" AND ");
    return where ? " WHERE " + where : "";
  };

  const cellUpdatePreview = (target, column, keys, value, isNull) => {
    if (!target || !target.table || !column) return "";
    return "UPDATE " + targetName(target) + " SET " + ddlIdentifier(column) + " = "
      + (isNull ? "NULL" : ddlString(value)) + keyWherePreview(keys);
  };

  const rowDeletePreview = (target, keys) => {
    if (!target || !target.table) return "";
    return "DELETE FROM " + targetName(target) + keyWherePreview(keys);
  };

  const rowInsertPreview = (target, values) => {
    if (!target || !target.table) return "";
    const list = values || [];
    // 값을 하나도 적지 않은 행 = 전부 기본값. MySQL 이 받는 문장이라 그대로 보여 준다.
    if (!list.length) return "INSERT INTO " + targetName(target) + " () VALUES ()";
    return "INSERT INTO " + targetName(target)
      + " (" + list.map(item => ddlIdentifier(item.column)).join(", ") + ")"
      + " VALUES (" + list.map(item => item.isNull ? "NULL" : ddlString(item.value)).join(", ") + ")";
  };

  // 고칠 수 없는 까닭을 그대로 사람 말로 옮긴다. 잠긴 이유를 밝히지 않으면
  // "왜 어떤 칸은 되고 어떤 칸은 안 되는지" 를 사용자가 추측하게 된다.
  const EDIT_BLOCK_NOTES = {
    "read-only":   "읽기 전용 접속입니다. 접속을 끊고 ‘쓰기 허용’을 켜서 다시 연결하면 값을 고칠 수 있습니다.",
    "no-source":   "계산식·함수로 만든 열이라 고칠 원본 칸이 없습니다.",
    "multi-table": "여러 테이블을 조인한 결과라 어느 테이블의 행을 고칠지 정할 수 없습니다.",
    "view":        "뷰라서 값을 고칠 수 없습니다. 원본 테이블을 조회해 주세요.",
    "no-key":      "이 테이블에는 기본키가 없어 한 행을 정확히 짚을 수 없습니다.",
    "key-missing": "기본키 컬럼이 결과에 빠져 있어 한 행을 정확히 짚을 수 없습니다",
    "key":         "기본키 칸은 여기서 고치지 않습니다. 행을 짚는 근거라 값 수정과 다른 이야기입니다.",
    "binary":      "이진 데이터라 글자로 고칠 수 없습니다.",
    "generated":   "다른 컬럼에서 자동으로 만들어지는 값이라 직접 고칠 수 없습니다.",
    "unknown":     "이 결과의 값은 고칠 수 없습니다."
  };

  const editBlockNote = (plan) => {
    const reason = String((plan && plan.reason) || "unknown");
    const note = EDIT_BLOCK_NOTES[reason] || EDIT_BLOCK_NOTES.unknown;
    const detail = String((plan && plan.detail) || "");
    return detail ? note + " (" + detail + ")" : note;
  };

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
    // 덤프는 읽기만 하므로 읽기 전용 접속에서도 쓸 수 있다(오히려 그때 더 필요하다).
    const dumpButton = button("내보내기", "db-btn db-btn-quiet",
      "고른 테이블·뷰·프로시저를 CREATE·INSERT 문이 든 .sql 파일로 저장합니다");
    const formatButton = button("정렬", "db-btn db-btn-quiet",
      "편집기의 SQL 을 줄바꿈·들여쓰기해 보기 좋게 정리합니다 (일부만 고를 때는 우클릭 메뉴)");
    formatButton.dataset.shortcutAction = "formatDocument";
    formatButton.dataset.shortcutTitle = "SQL 정렬 — 프로시저 본문은 그대로 둡니다";
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
    const layoutButton = button("Side", "db-btn db-btn-quiet db-layout-btn",
      "실행 결과를 SQL 편집기 오른쪽에 표시합니다");
    const schemaPanelButton = button("스키마 숨기기", "db-btn db-btn-quiet db-schema-btn",
      "왼쪽 스키마 패널을 숨깁니다");
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
      modeBadge, txWrap, serverLabel, schemaPanelButton, layoutButton, historyButton, formatButton, importButton,
      dumpButton, saveButton, disconnectButton, sqlFileInput);
    // 저장·정렬 버튼의 안내에 지금 설정된 단축키를 붙인다(사용자가 키를 바꿔도 따라간다).
    if (typeof syncShortcutHints === "function") syncShortcutHints(toolbar);
    toolbar.querySelector(".db-timeout-wrap").append(el("span", null, "제한"), timeoutInput, el("span", null, "초"));

    /* SQL 정렬 — 라이브러리(sql-formatter)는 처음 정렬할 때만 읽는다(312KB).
       공용 편집기 위젯의 formatSource 자리에 끼워 되돌리기 한 단계 묶기·커서 되돌리기·
       비동기 도중 편집 폐기를 그대로 물려받는다. 실패해도 편집기 내용은 건드리지 않는다. */
    const loadSqlFormatter = async () => {
      const current = () => (typeof window !== "undefined" && window.sqlFormatter
        && typeof window.sqlFormatter.format === "function") ? window.sqlFormatter.format : null;
      const ready = current();
      if (ready) return ready;
      if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("sqlFormat");
      return current();
    };

    const formatEditorSql = async (source, context) => {
      context = context || {};
      const onlySelection = context.scope === "selection";
      const format = await loadSqlFormatter();
      if (!format) return { text:source, message:"SQL 정렬기를 불러오지 못했어요." };
      const result = formatSqlText(source, format,
        onlySelection ? { from:context.from, to:context.to } : null);
      const what = onlySelection ? "선택한 문장을" : "SQL 을";
      let message = "";
      if (result.reason === "routine"){
        message = "프로시저·함수 정의가 있어 정렬하지 않았어요. DELIMITER 로 감싸면 나머지 문장을 정렬합니다.";
      } else if (result.reason === "unsafe"){
        message = "정렬 결과가 문장 나누기를 바꿔서 원래대로 두었어요.";
      } else if (onlySelection && !result.formatted && !result.skipped){
        message = "선택 영역에 정렬할 문장이 없어요.";
      } else if (result.text !== source){
        message = result.skipped
          ? what + " 정렬했어요. 문장 " + result.skipped + "개는 그대로 뒀어요."
          : what + " 정렬했어요.";
      } else if (!result.formatted && result.skipped){
        message = "정렬할 수 있는 문장이 없어요. 프로시저 본문은 그대로 둡니다.";
      }
      return { text:result.text, engine:"sql-formatter", message };
    };

    // 툴바 버튼·우클릭 메뉴가 함께 쓰는 실행부. 알림 문구는 정렬기가 정해 주므로
    // 단축키(Shift+Alt+F) 경로와 같은 말이 나온다.
    const runEditorFormat = (opts) => {
      editor.formatDocument(opts || {}).then((result) => {
        if (!result || typeof toast !== "function") return;
        if (result.message) toast(result.message, 2400);
        else if (!result.changed && !result.stale) toast("이미 정렬돼 있어요.", 1400);
      }).catch(() => {});
    };

    /* 줄 정리 — 텍스트 편집기의 '줄 정리' 메뉴(LINE_TIDY_ITEMS)를 그대로 가져다 쓴다.
       목록을 베껴 두면 한쪽에 도구가 늘 때 다른 쪽만 뒤처지므로 원본을 참조한다.
       대상 범위 규칙도 그쪽과 같다 — 고른 줄이 있으면 그 범위만, 없으면 편집기 전체. */
    const runLineTidy = (item) => {
      const result = editor.applyLineTidy(item.action);
      if (typeof toast !== "function") return;
      if (!result) toast("따라치기 중에는 줄 정리를 쓸 수 없어요.", 2200);
      else if (!result.changed) toast("바뀐 줄이 없어요.", 1600);
      else toast(item.done + (result.lineDelta > 0 ? " (" + result.lineDelta + "줄 줄었어요)" : ""), 1900);
    };

    /* 줄바꿈 — 이 편집기 안에서만 켜고 끈다. 텍스트 편집기는 앱 전역 설정(textWrapEnabled)을
       쓰지만, SQL 은 결과 표와 폭을 나눠 쓰는 화면이라 문서를 옮길 때마다 따라오면 성가시다. */
    let sqlWrapOn = false;
    const setSqlWrap = (on) => {
      sqlWrapOn = !!on;
      if (typeof editor.setWrap === "function") editor.setWrap(sqlWrapOn);
      if (typeof toast === "function") toast(sqlWrapOn ? "긴 줄을 접어서 보여 줄게요." : "줄바꿈을 껐어요.", 1400);
    };

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
      // 공용 편집기의 정렬(Shift+Alt+F) 확장점. 파이썬 전용 경로를 타지 않게 이 자리로 넘긴다.
      formatSource: formatEditorSql,
      /* 우클릭 메뉴 — 이 편집기에는 도구막대가 없으니(툴바 자리는 실행·접속용이다) 텍스트
         편집기의 '줄 정리'·찾기·줄바꿈을 여기로 모은다. 복사·붙여넣기·대소문자 변환·특수문자는
         공용 메뉴가 이미 아래에 붙여 준다. 메뉴가 열릴 때 불리므로 지금 선택을 여기서 읽어
         닫아 두고, 항목을 누를 때 그 범위를 다시 세운다 — 메뉴가 닫히며 포커스가 흔들려도
         처음 고른 자리에 그대로 걸리게 하려는 것이다. */
      contextMenuActions: () => {
        const area = editor.ta;
        const from = Math.min(area.selectionStart, area.selectionEnd);
        const to = Math.max(area.selectionStart, area.selectionEnd);
        const picked = to > from;
        const onPicked = (run) => () => {
          area.focus({ preventScroll:true });
          try { area.setSelectionRange(from, to); } catch(_){}
          run();
        };
        const items = [
          { label: picked ? "선택 영역 SQL 정렬" : "SQL 정렬 (전체)",
            title: picked ? "고른 부분에 걸친 문장만 정렬합니다 (문장 한가운데를 골라도 그 문장 전체)"
                          : "편집기의 SQL 전체를 정렬합니다 (Shift+Alt+F)",
            action: onPicked(() => runEditorFormat(picked ? { scope:"selection" } : {})) }
        ];
        /* 줄 정리 열한 개를 1단에 늘어놓으면 메뉴가 화면보다 길어진다. 한 층 접어 둔다 —
           한 번 고르면 끝나는 도구라 두 번 누르는 값이 크지 않다. */
        if (typeof LINE_TIDY_ITEMS !== "undefined" && Array.isArray(LINE_TIDY_ITEMS)){
          const children = LINE_TIDY_ITEMS.map((tidy) => (tidy.separator ? { separator:true } : {
            label:tidy.label, title:tidy.title, action:onPicked(() => runLineTidy(tidy))
          }));
          items.push({ label:"줄 정리", children,
            title:"정렬·중복 삭제·번호 매기기 — 고른 줄이 있으면 그 부분만, 없으면 편집기 전체" });
        }
        items.push(
          { separator:true },
          { label:"찾기·바꾸기", title:"이 편집기 안에서 찾고 바꿉니다 (Ctrl+F)",
            action: onPicked(() => editor.openFind()) },
          { label:"줄 번호로 이동", title:"줄 번호를 입력해 그 줄로 갑니다 (Ctrl+G)",
            action: onPicked(() => editor.openGoto()) },
          { label: sqlWrapOn ? "줄바꿈 끄기" : "줄바꿈 켜기",
            title:"긴 줄을 편집기 너비에 맞춰 접어서 보여 줍니다 (내용은 바뀌지 않아요)",
            action: onPicked(() => setSqlWrap(!sqlWrapOn)) }
        );
        return items;
      },
      // 편집기가 고정 높이(overflow:hidden)라 자동완성 목록을 안쪽에 두면 잘린다.
      // 노트북 셀과 같은 이유로 body 로 빼서 띄운다.
      completionPortal: true,
      completionWords,
      // `별칭.` 뒤에서는 그 별칭이 가리키는 테이블의 컬럼만 준다.
      memberCandidates: (source, receiver, prefix) => sqlMemberCandidates(source, receiver, prefix),
      // Ctrl+클릭은 공용 편집기의 정의 대상 확장점을 사용한다. 테이블·뷰는 테이블 정보 창을,
      // 프로시저·함수·이벤트는 루틴 정보 창을 연다. 트리거는 sqlDefinitionTargetAt 이 걸러 낸다.
      definitionTargetAt: ({ source, wordInfo }) => sqlDefinitionTargetAt(source, wordInfo, schemaObjects),
      openDefinitionTarget: ({ target }) => {
        if (!target) return false;
        if (target.kind === "table"){
          setSchemaSelection(target.item);
          openTableInfoModal(target.name);
          return true;
        }
        if (target.kind === "routine"){
          setSchemaSelection(target.item);
          openObjectInfoModal(target.item);
          return true;
        }
        return false;
      }
    });
    editor.ta.setAttribute("aria-label", "SQL 편집기");
    editorWrap.append(editor.host);

    const resultBar = el("div", "db-result-bar");
    const resultStatus = el("span", "db-result-status", "");
    const selectInfo = el("span", "db-select-info", "");
    selectInfo.hidden = true;
    const memoButton = button("전체 메모로", "db-btn db-btn-quiet", "현재 결과 표 전체를 메모로 보냅니다");
    const exportCsvButton = button("CSV로 내보내기", "db-btn db-btn-quiet");
    const openSheetButton = button("표 편집기로 열기", "db-btn db-btn-quiet");
    const resultFontTools = el("span", "db-result-font-tools");
    resultFontTools.setAttribute("role", "group");
    resultFontTools.setAttribute("aria-label", "SQL 편집기와 결과 표 글꼴 및 색 설정");
    const fontDownButton = button("A−", "db-result-font-btn", "SQL 편집기와 결과 표 글자를 작게");
    const fontUpButton = button("A+", "db-result-font-btn", "SQL 편집기와 결과 표 글자를 크게");
    const fontPick = document.createElement("select");
    fontPick.className = "db-result-font-pick";
    fontPick.title = "SQL 편집기와 결과 표 글꼴";
    fontPick.setAttribute("aria-label", fontPick.title);
    const fontGroups = typeof groupedCodeFontChoices === "function" ? groupedCodeFontChoices() : { mono:[], prop:[] };
    const installedFonts = [...fontGroups.mono, ...fontGroups.prop];
    const addFontOptions = (label, list) => {
      if (!list.length) return;
      const group = document.createElement("optgroup");
      group.label = label;
      list.forEach(choice => {
        const option = new Option(choice.label, choice.value);
        if (typeof _codeFontFamily === "string" && choice.value === _codeFontFamily) option.selected = true;
        group.append(option);
      });
      fontPick.append(group);
    };
    addFontOptions("고정폭 (코딩용)", fontGroups.mono);
    addFontOptions("가변폭 (읽기용)", fontGroups.prop);
    if (installedFonts.length <= 1) fontPick.hidden = true;
    const editorColor = input("color", "#0f172a");
    editorColor.className = "db-result-color";
    editorColor.title = "현재 테마의 SQL 편집기 일반 글자색";
    editorColor.setAttribute("aria-label", editorColor.title);
    const editorColorField = el("label", "db-result-color-field");
    editorColorField.append(el("span", "db-result-color-label", "편집"), editorColor);
    const editorColorReset = button("↺", "db-result-font-btn db-result-color-reset", "현재 테마의 SQL 편집기 글자색을 기본값으로 되돌립니다");
    const resultColor = input("color", "#0f172a");
    resultColor.className = "db-result-color";
    resultColor.title = "현재 테마의 결과 표 글자색";
    resultColor.setAttribute("aria-label", resultColor.title);
    const resultColorField = el("label", "db-result-color-field");
    resultColorField.append(el("span", "db-result-color-label", "결과"), resultColor);
    const resultColorReset = button("↺", "db-result-font-btn db-result-color-reset", "현재 테마의 결과 글자색을 기본값으로 되돌립니다");
    resultFontTools.append(fontDownButton, fontUpButton, fontPick,
      editorColorField, editorColorReset, resultColorField, resultColorReset);
    const addRowButton = button("행 추가", "db-btn db-btn-quiet", "이 테이블에 넣을 행을 만들어 변경 목록에 담습니다");
    const deleteRowButton = button("행 삭제", "db-btn db-btn-quiet", "고른 칸이 걸친 행을 지우려고 변경 목록에 담습니다");
    resultBar.append(resultStatus, selectInfo, el("span", "db-result-spacer", null),
      resultFontTools, addRowButton, deleteRowButton, memoButton, exportCsvButton, openSheetButton);
    memoButton.hidden = true;
    exportCsvButton.hidden = true;
    openSheetButton.hidden = true;
    addRowButton.hidden = true;
    deleteRowButton.hidden = true;

    /* 변경 바 — 담아 둔 변경이 있을 때만 나온다. 적용하기 전에는 서버에 아무것도 가지 않으므로
       "지금 화면과 서버가 다르다"는 사실을 눈에 띄는 자리에서 계속 알린다. */
    const editBar = el("div", "db-edit-bar");
    editBar.hidden = true;
    const editBarCount = el("strong", "db-edit-count", "");
    const editBarDetail = el("span", "db-edit-detail", "");
    const previewChangesButton = button("미리보기", "db-btn db-btn-quiet", "적용할 문장을 그대로 봅니다");
    const applyChangesButton = button("적용", "db-btn db-btn-primary", "담아 둔 변경을 한 번에 서버에 반영합니다");
    const discardChangesButton = button("모두 취소", "db-btn db-btn-quiet", "담아 둔 변경을 모두 버립니다");
    editBar.append(editBarCount, editBarDetail, el("span", "db-result-spacer", null),
      previewChangesButton, applyChangesButton, discardChangesButton);

    // 여러 문장을 실행하면 결과 집합도 여러 개가 온다. 예전에는 마지막 것만 그리고 나머지를 버렸다.
    const resultTabs = el("div", "db-result-tabs");
    resultTabs.hidden = true;

    const resultHost = el("div", "db-result");
    if (typeof registerEditorFont === "function"){
      registerEditorFont(editor.host);
      registerEditorFont(resultHost);
    }

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

    const editorPane = el("div", "db-editor-pane");
    editorPane.append(editorWrap);
    const resultPane = el("div", "db-result-pane");
    resultPane.append(resultBar, resultTabs, editBar, resultHost);
    const editorDivider = el("div", "db-query-divider");
    editorDivider.setAttribute("role", "separator");
    editorDivider.tabIndex = 0;
    const queryLayout = el("div", "db-query-layout");
    queryLayout.append(editorPane, editorDivider, resultPane);

    main.append(toolbar, queryLayout, historyPanel, completionBox);
    const divider = el("div", "db-divider");
    divider.title = "드래그: 스키마 패널 너비 조절 · 더블클릭: 기본 너비로";
    divider.setAttribute("aria-hidden", "true");
    workspace.append(sidebar, divider, main);
    root.append(form, workspace);

    /* SQL 편집기와 결과의 배치. 사용자가 고른 방향은 유지하되, 좁은 화면에서는 아래 배치로
       잠시 바꿔 두 영역이 지나치게 좁아지지 않게 한다. 화면이 다시 넓어지면 저장한 방향으로 돌아간다. */
    let resultLayout = readResultLayout();
    const compactQueryLayout = window.matchMedia("(max-width:900px)");
    const sideLayoutActive = () => resultLayout === "side" && !compactQueryLayout.matches;
    const applyResultLayout = () => {
      const side = sideLayoutActive();
      queryLayout.classList.toggle("db-layout-side", side);
      queryLayout.classList.toggle("db-layout-below", !side);
      editorDivider.setAttribute("aria-orientation", side ? "vertical" : "horizontal");
      editorDivider.title = side
        ? "드래그: 편집기 너비 조절 · 더블클릭: 기본 너비로"
        : "드래그: 편집기 높이 조절 · 더블클릭: 기본 높이로";
      layoutButton.textContent = side ? "Below" : "Side";
      layoutButton.title = side
        ? "실행 결과를 SQL 편집기 아래에 표시합니다"
        : "실행 결과를 SQL 편집기 오른쪽에 표시합니다";
      layoutButton.setAttribute("aria-pressed", String(side));
    };
    layoutButton.addEventListener("click", () => {
      resultLayout = sideLayoutActive() ? "below" : "side";
      storeResultLayout(resultLayout);
      applyResultLayout();
    });
    const onCompactQueryLayout = () => applyResultLayout();
    compactQueryLayout.addEventListener("change", onCompactQueryLayout);
    applyResultLayout();

    /* 스키마 패널 접기 ------------------------------------------------------ */

    let sidebarCollapsed = readSidebarCollapsed();

    /* 폭을 0 으로 만들지 않고 통째로 감춘다. 폭만 0 이면 화면에서만 사라지고
       Tab 순서와 스크린리더는 그대로 안으로 들어간다 — 보이지 않는 곳에 커서가 갇힌다.
       (원격 터미널 도크·분할선이 쓰는 [hidden] 규칙과 같은 방식이다.) */
    const applySidebarCollapsed = () => {
      // 감추기 전에 옮긴다. display:none 이 된 뒤에는 포커스가 body 로 떨어진다.
      if (sidebarCollapsed && sidebar.contains(document.activeElement)) schemaPanelButton.focus();
      workspace.classList.toggle("db-sidebar-collapsed", sidebarCollapsed);
      sidebar.hidden = sidebarCollapsed;
      divider.hidden = sidebarCollapsed;
      schemaPanelButton.textContent = sidebarCollapsed ? "스키마 보이기" : "스키마 숨기기";
      schemaPanelButton.title = sidebarCollapsed
        ? "왼쪽 스키마 패널을 다시 보입니다" : "왼쪽 스키마 패널을 숨깁니다";
      schemaPanelButton.setAttribute("aria-pressed", String(!sidebarCollapsed));
    };

    schemaPanelButton.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      storeSidebarCollapsed(sidebarCollapsed);
      applySidebarCollapsed();
      // 접혀 있는 동안 창이 줄었으면 저장해 둔 폭이 상한을 넘을 수 있다. 펼 때 다시 재운다.
      if (!sidebarCollapsed) setSidebarWidth(readSidebarWidth() || SIDEBAR_DEFAULT, false);
    });

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

    /* SQL 편집기 ↔ 결과 분할 크기 ------------------------------------------- */

    const maxEditorHeight = () => {
      const rect = queryLayout.getBoundingClientRect();
      if (!rect.height) return Infinity;              // 연결 전에는 화면에 없어 높이가 0 이다
      // 결과 자리를 240px 은 남긴다 — 분할선을 끝까지 내려 결과를 없애지 못하게.
      return Math.max(EDITOR_MIN, rect.height - EDITOR_KEEP_RESULT);
    };

    const setEditorHeight = (px, persist) => {
      const height = Math.round(Math.max(EDITOR_MIN, Math.min(maxEditorHeight(), px)));
      queryLayout.style.setProperty("--db-editor-height", height + "px");
      if (persist) storeEditorHeight(height);
      return height;
    };

    const maxEditorWidth = () => {
      const rect = queryLayout.getBoundingClientRect();
      if (!rect.width) return Infinity;
      return Math.max(EDITOR_WIDTH_MIN, rect.width - EDITOR_KEEP_RESULT_WIDTH);
    };

    const setEditorWidth = (px, persist) => {
      const width = Math.round(Math.max(EDITOR_WIDTH_MIN, Math.min(maxEditorWidth(), px)));
      queryLayout.style.setProperty("--db-editor-width", width + "px");
      if (persist) storeEditorWidth(width);
      return width;
    };

    editorDivider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { editorDivider.setPointerCapture(event.pointerId); } catch(_){}
      editorDivider.classList.add("dragging");
      const side = sideLayoutActive();
      const startPoint = side ? event.clientX : event.clientY;
      const startSize = side ? editorPane.getBoundingClientRect().width : editorPane.getBoundingClientRect().height;
      const move = (moveEvent) => {
        const point = side ? moveEvent.clientX : moveEvent.clientY;
        if (side) setEditorWidth(startSize + point - startPoint, false);
        else setEditorHeight(startSize + point - startPoint, false);
      };
      const end = () => {
        editorDivider.classList.remove("dragging");
        editorDivider.removeEventListener("pointermove", move);
        editorDivider.removeEventListener("pointerup", end);
        editorDivider.removeEventListener("pointercancel", end);
        try { editorDivider.releasePointerCapture(event.pointerId); } catch(_){}
        if (side) storeEditorWidth(editorPane.getBoundingClientRect().width);
        else storeEditorHeight(editorPane.getBoundingClientRect().height);
      };
      editorDivider.addEventListener("pointermove", move);
      editorDivider.addEventListener("pointerup", end);
      editorDivider.addEventListener("pointercancel", end);
    });

    editorDivider.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (sideLayoutActive()) setEditorWidth(EDITOR_WIDTH_DEFAULT, true);
      else setEditorHeight(EDITOR_DEFAULT, true);
    });
    editorDivider.addEventListener("keydown", (event) => {
      const side = sideLayoutActive();
      const delta = event.shiftKey ? 40 : 12;
      if (side && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (!side && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      if (side){
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        setEditorWidth(editorPane.getBoundingClientRect().width + direction * delta, true);
      } else {
        const direction = event.key === "ArrowUp" ? -1 : 1;
        setEditorHeight(editorPane.getBoundingClientRect().height + direction * delta, true);
      }
    });

    /* SQL 편집기와 결과 표의 글꼴·크기·색. 글꼴과 크기는 Python 편집기와 같은 공용 설정을
       함께 쓰고, 편집기 일반 글자색과 결과 글자색은 라이트·다크 테마별로 따로 기억한다.
       --code-text 만 편집기 host 에 덮어 문법 강조(키워드·문자열·주석) 색은 그대로 둔다. */
    const resultTheme = () => document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const editorColorKey = () => resultTheme() === "dark" ? EDITOR_COLOR_DARK_KEY : EDITOR_COLOR_LIGHT_KEY;
    const resultColorKey = () => resultTheme() === "dark" ? RESULT_COLOR_DARK_KEY : RESULT_COLOR_LIGHT_KEY;
    const defaultTextColor = () => resultTheme() === "dark" ? "#e2e8f0" : "#0f172a";
    const savedTextColor = (key) => {
      try {
        const value = String(localStorage.getItem(key) || "");
        return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "";
      } catch(_){ return ""; }
    };
    const applyEditorTextColor = () => {
      const value = savedTextColor(editorColorKey());
      if (value) editor.host.style.setProperty("--code-text", value);
      else editor.host.style.removeProperty("--code-text");
      editorColor.value = value || defaultTextColor();
      editorColorReset.disabled = !value;
    };
    const applyResultTextColor = () => {
      const value = savedTextColor(resultColorKey());
      if (value) root.style.setProperty("--db-result-text-color", value);
      else root.style.removeProperty("--db-result-text-color");
      resultColor.value = value || defaultTextColor();
      resultColorReset.disabled = !value;
    };
    const applyTextColors = () => {
      applyEditorTextColor();
      applyResultTextColor();
    };
    fontDownButton.addEventListener("click", () => {
      if (typeof bumpCodeFont === "function") bumpCodeFont(-1);
    });
    fontUpButton.addEventListener("click", () => {
      if (typeof bumpCodeFont === "function") bumpCodeFont(1);
    });
    fontPick.addEventListener("change", () => {
      if (typeof setCodeFontFamily === "function") setCodeFontFamily(fontPick.value);
    });
    editorColor.addEventListener("input", () => {
      try { localStorage.setItem(editorColorKey(), editorColor.value); } catch(_){}
      applyEditorTextColor();
    });
    editorColorReset.addEventListener("click", () => {
      try { localStorage.removeItem(editorColorKey()); } catch(_){}
      applyEditorTextColor();
    });
    resultColor.addEventListener("input", () => {
      try { localStorage.setItem(resultColorKey(), resultColor.value); } catch(_){}
      applyResultTextColor();
    });
    resultColorReset.addEventListener("click", () => {
      try { localStorage.removeItem(resultColorKey()); } catch(_){}
      applyResultTextColor();
    });
    const resultThemeObserver = new MutationObserver(applyTextColors);
    resultThemeObserver.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });
    applyTextColors();

    /* 무엇을 실행할지 ------------------------------------------------------
       선택이 있으면 선택한 글자 그대로, 없으면 커서가 놓인 문장 하나.
       편집기 전체는 Ctrl+Shift+Enter 또는 `전체 실행` 버튼으로만 나간다.
       DBeaver·MySQL Workbench·DataGrip 이 모두 쓰는 규칙이다. */

    const runTarget = () => {
      const value = editor.getValue();
      const from = editor.ta.selectionStart, to = editor.ta.selectionEnd;
      if (from !== to){
        const picked = value.slice(from, to).trim();
        if (picked) return { sql:compoundExecutionScript(picked), displaySql:picked, label:"선택 실행" };
      }
      const range = statementAt(value, from);
      return range ? {
        sql:compoundExecutionScript(range.text, range.delimiter), displaySql:range.text, label:"현재 문장 실행"
      } : null;
    };

    const allTarget = () => {
      const sql = editor.getValue().trim();
      return sql ? { sql:compoundExecutionScript(sql), displaySql:sql, label:"전체 실행" } : null;
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
      const total = statementRanges(compoundExecutionScript(editor.getValue())).length;
      runButton.textContent = target ? target.label : "실행";
      runButton.disabled = !target || !sessionId;
      runButton.title = target ? "Ctrl+Enter — " + previewOf(target.displaySql || target.sql) : "실행할 SQL 을 입력해 주세요.";
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

    formatButton.addEventListener("click", () => {
      runEditorFormat();
      editor.ta.focus();
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

    /* 셀 값 보기·고치기 ------------------------------------------------------
       보기는 늘 되고, 고치기는 워커가 "고칠 수 있다"고 판정한 결과에서만 열린다.
       판정을 프런트가 짐작하지 않는 이유는 하나다 — 열 이름만으로는 별칭·조인·계산식을
       가릴 수 없다. 어느 테이블 어느 컬럼에서 온 열인지는 서버가 알려 준 것만 믿는다. */

    const showCellValue = (columnName, value, clipped, point) => {
      const text = value === null ? "NULL" : String(value);
      let note;
      if (value === null) note = "빈 값(NULL)입니다.";
      else if (/^<BLOB \d+ bytes>$/.test(text)) note = "이진 데이터라 내용을 표시하지 않습니다. 크기만 가져왔습니다.";
      else if (clipped) note = "서버에서 500자까지만 가져온 값입니다. 전체가 필요하면 그 컬럼만 따로 조회해 주세요.";
      else note = text.length.toLocaleString() + "자";
      const edit = point ? cellEditContext(point.row, point.col, clipped) : null;
      openValueModal(columnName || "값", text, note, value === null, edit);
    };

    /* 이 칸을 고칠 수 있는가. 무엇을 고칠 수 있는지는 워커가 보낸 계획이 정하고,
       여기서는 그 계획대로 행을 짚을 기본키 값을 표에서 꺼낼 수 있는지만 더 본다. */
    /* 한 행을 짚을 기본키 값을 표에서 꺼낸다. 꺼내지 못하면 그 까닭을 돌려준다 —
       못 짚는 행을 고치거나 지우면 엉뚱한 행이 바뀐다. */
    const rowKeyValues = (row) => {
      const plan = currentGrid && currentGrid.edit;
      if (!plan || !plan.editable) return { error:editBlockNote(plan) };
      const keys = [];
      const list = plan.keys || [];
      for (let index = 0; index < list.length; index++){
        const node = gridCellAt(row, list[index].index);
        if (!node || node.classList.contains("db-null"))
          return { error:"기본키 값을 읽지 못해 이 행을 짚을 수 없습니다." };
        if (node.classList.contains("db-clipped"))
          return { error:"기본키 값이 길어 잘려 왔습니다. 그 값으로는 행을 정확히 짚을 수 없습니다." };
        keys.push({ name:list[index].name, value:node.textContent });
      }
      return { keys };
    };

    const cellEditContext = (row, col, clipped) => {
      const plan = currentGrid && currentGrid.edit;
      if (!plan) return { editable:false, note:EDIT_BLOCK_NOTES.unknown };
      if (!plan.editable) return { editable:false, note:editBlockNote(plan) };
      if (stagedDelete(row)) return { editable:false, note:"지우려고 담아 둔 행입니다. 먼저 그 변경을 빼 주세요." };
      const cellPlan = (plan.cells || [])[col];
      if (!cellPlan || !cellPlan.editable) return { editable:false, note:editBlockNote(cellPlan) };
      const found = rowKeyValues(row);
      if (found.error) return { editable:false, note:found.error };
      const change = stagedUpdate(row, col);
      return { editable:true, target:{ database:plan.database, table:plan.table },
        column:cellPlan.column, nullable:!!cellPlan.nullable, type:String(cellPlan.type || ""),
        keys:found.keys, row, col, clipped:!!clipped,
        // 이미 담아 둔 칸이면 서버가 아니라 담아 둔 값에서 이어 고친다.
        staged:change ? { value:change.value, isNull:change.isNull } : null };
    };

    /* 변경 모아 적용 --------------------------------------------------------
       고친 칸·지울 행·넣을 행은 곧바로 서버로 가지 않고 목록에 쌓인다. `적용` 을 누를 때
       한 묶음으로 나가고, 하나라도 실패하면 그 묶음만 통째로 되돌아온다(절반만 반영되는 일이 없다).
       무엇이 나갈지는 미리보기에서 문장 그대로 보여 준다 — GUI 로 고친 일이 어떤 SQL 인지 감추지 않는다. */

    let staged = null;              // { target:{database,table}, list:[변경], seq }
    let applying = false;

    const stagedCount = () => (staged ? staged.list.length : 0);
    const stagedUpdate = (row, col) => staged
      ? staged.list.find(item => item.kind === "update" && item.row === row && item.col === col) : null;
    const stagedDelete = (row) => staged
      ? staged.list.find(item => item.kind === "delete" && item.row === row) : null;

    const stagedTally = () => {
      const tally = { update:0, "delete":0, insert:0 };
      if (staged) staged.list.forEach(change => { tally[change.kind]++; });
      return tally;
    };

    const changeSql = (change) => {
      const target = staged ? staged.target : null;
      if (change.kind === "update")
        return cellUpdatePreview(target, change.column, change.keys, change.value, change.isNull);
      if (change.kind === "delete") return rowDeletePreview(target, change.keys);
      return rowInsertPreview(target, change.values);
    };

    const cellSnapshot = (row, col) => {
      const node = gridCellAt(row, col);
      if (!node) return { text:"", isNull:false, clipped:false, title:"" };
      return { text:node.textContent, isNull:node.classList.contains("db-null"),
        clipped:node.classList.contains("db-clipped"), title:node.title };
    };

    const paintStagedCell = (change) => {
      const node = gridCellAt(change.row, change.col);
      if (!node) return;
      node.classList.add("db-cell-staged");
      node.classList.toggle("db-null", !!change.isNull);
      node.classList.remove("db-clipped");         // 담은 값은 온전한 값이라 잘림 표시가 남으면 안 된다
      node.textContent = change.isNull ? "NULL" : change.value;
      node.title = "담아 둔 변경입니다 — 위의 ‘적용’을 눌러야 서버에 반영됩니다";
    };

    const restoreStagedCell = (change) => {
      const node = gridCellAt(change.row, change.col);
      if (!node) return;
      node.classList.remove("db-cell-staged");
      node.classList.toggle("db-null", !!change.before.isNull);
      node.classList.toggle("db-clipped", !!change.before.clipped);
      node.textContent = change.before.text;
      node.title = change.before.title;
    };

    const paintStagedRow = (row, on) => {
      const tr = currentGrid && currentGrid.body ? currentGrid.body.children[row] : null;
      if (tr) tr.classList.toggle("db-row-staged", on);
    };

    // 표를 새로 그릴 때는 되돌릴 자리가 이미 사라졌으므로 칠하지 않고 목록만 버린다.
    const dropStaged = () => { staged = null; refreshEditBar(); };

    const discardStaged = () => {
      if (staged) staged.list.forEach((change) => {
        if (change.kind === "update") restoreStagedCell(change);
        else if (change.kind === "delete") paintStagedRow(change.row, false);
      });
      dropStaged();
    };

    const ensureStaged = (target) => {
      if (!staged) staged = { target:{ database:target.database || "", table:target.table }, list:[], seq:0 };
      return staged;
    };

    const unstage = (id) => {
      if (!staged) return;
      const at = staged.list.findIndex(item => item.id === id);
      if (at < 0) return;
      const change = staged.list[at];
      staged.list.splice(at, 1);
      if (change.kind === "update") restoreStagedCell(change);
      else if (change.kind === "delete") paintStagedRow(change.row, false);
      if (!staged.list.length) staged = null;
      refreshEditBar();
    };

    const refreshEditBar = () => {
      const count = stagedCount();
      editBar.hidden = !count;
      applyChangesButton.disabled = applying;
      discardChangesButton.disabled = applying;
      previewChangesButton.disabled = applying;
      if (!count) return;
      const tally = stagedTally();
      const parts = [];
      if (tally.update) parts.push("값 수정 " + tally.update);
      if (tally["delete"]) parts.push("행 삭제 " + tally["delete"]);
      if (tally.insert) parts.push("행 추가 " + tally.insert);
      editBarCount.textContent = "담아 둔 변경 " + count + "건";
      editBarDetail.textContent = parts.join(" · ") + " · 아직 서버에 반영되지 않았습니다";
    };

    const stageUpdate = (edit, value, isNull) => {
      const before = stagedUpdate(edit.row, edit.col)
        ? stagedUpdate(edit.row, edit.col).before : cellSnapshot(edit.row, edit.col);
      const text = isNull ? "" : String(value == null ? "" : value);
      // 원래 값으로 되돌려 놓았으면 담지 않는다. 아무것도 바꾸지 않는 UPDATE 를 보낼 이유가 없다.
      const same = !before.clipped && (isNull ? before.isNull : (!before.isNull && before.text === text));
      const previous = stagedUpdate(edit.row, edit.col);
      if (same){
        if (previous) unstage(previous.id);
        return false;
      }
      ensureStaged(edit.target);
      const change = { id:++staged.seq, kind:"update", row:edit.row, col:edit.col, column:edit.column,
        keys:edit.keys, value:text, isNull:!!isNull, before };
      const at = staged.list.findIndex(item => item.kind === "update" && item.row === edit.row && item.col === edit.col);
      if (at >= 0) staged.list[at] = change; else staged.list.push(change);
      paintStagedCell(change);
      refreshEditBar();
      return true;
    };

    const MAX_STAGED = 500;      // 워커가 한 묶음으로 받는 상한과 같다(담을 때 미리 막는다)

    const stageDeleteRows = async (rows) => {
      const plan = currentGrid && currentGrid.edit;
      if (!plan || !plan.editable){ toast(editBlockNote(plan), 3500); return; }
      if (stagedCount() + rows.length > MAX_STAGED){
        toast("한 번에 담을 수 있는 변경은 " + MAX_STAGED + "건까지입니다. 먼저 적용해 주세요.", 3500);
        return;
      }
      // 컬럼 머리를 누르면 그 열 전체가 골라진다 = 보이는 행 전부가 대상이 된다.
      // 몇 행인지 먼저 말해 주지 않으면 실수로 표 전체를 담게 된다.
      if (rows.length >= 10 && typeof confirmDialog === "function"){
        const ok = await confirmDialog(rows.length.toLocaleString()
          + "행을 지우려고 담습니다.\n(아직 서버에서 지워지지는 않습니다.)", "담기", "취소");
        if (!ok) return;
      }
      let added = 0, blocked = "";
      rows.forEach((row) => {
        if (stagedDelete(row)) return;
        const found = rowKeyValues(row);
        if (found.error){ blocked = found.error; return; }
        ensureStaged({ database:plan.database, table:plan.table });
        // 지울 행에 담아 둔 값 수정이 있으면 뜻이 없다. 함께 뺀다.
        staged.list.filter(item => item.kind === "update" && item.row === row)
          .forEach(item => unstage(item.id));
        ensureStaged({ database:plan.database, table:plan.table });
        staged.list.push({ id:++staged.seq, kind:"delete", row, keys:found.keys });
        paintStagedRow(row, true);
        added++;
      });
      refreshEditBar();
      if (added) toast(added.toLocaleString() + "행을 지우려고 담았어요. ‘적용’을 눌러야 서버에서 지워집니다.", 3000);
      else if (blocked) toast(blocked, 3500);
      else toast("이미 담아 둔 행입니다.", 2000);
    };

    const stageInsert = (values) => {
      const plan = currentGrid && currentGrid.edit;
      if (!plan || !plan.editable) return;
      if (stagedCount() >= MAX_STAGED){
        toast("한 번에 담을 수 있는 변경은 " + MAX_STAGED + "건까지입니다. 먼저 적용해 주세요.", 3500);
        return;
      }
      ensureStaged({ database:plan.database, table:plan.table });
      staged.list.push({ id:++staged.seq, kind:"insert", values });
      refreshEditBar();
      toast("넣을 행 하나를 담았어요. ‘적용’을 눌러야 서버에 들어갑니다.", 3000);
    };

    // 고른 칸이 걸친 행 번호. 칸 하나는 `행 * 열수 + 열` 정수 하나로 눌러 담겨 있다.
    const selectedRows = () => {
      const count = gridColumnCount();
      const rows = new Set();
      if (gridSelection && count) gridSelection.keys.forEach(key => rows.add(Math.floor(key / count)));
      return Array.from(rows).sort((left, right) => left - right);
    };

    /* 적용 요청의 본문. 이름과 값만 순서대로 싣는다 — 문장은 워커가 자리표시자로 만든다. */
    const pushKeys = (parts, keys) => {
      parts.push(String(keys.length));
      keys.forEach(key => parts.push(key.name, key.value));
    };

    const applyRequestBody = () => {
      const parts = [staged.target.database || "", staged.target.table, String(staged.list.length)];
      staged.list.forEach((change) => {
        parts.push(change.kind);
        if (change.kind === "update"){
          parts.push(change.column, change.isNull ? "" : change.value, change.isNull ? "1" : "0");
          pushKeys(parts, change.keys);
        } else if (change.kind === "delete"){
          pushKeys(parts, change.keys);
        } else {
          parts.push(String(change.values.length));
          change.values.forEach(item => parts.push(item.column, item.isNull ? "" : item.value, item.isNull ? "1" : "0"));
        }
      });
      return encodeStrings(parts);
    };

    const applySummary = (info) => {
      const counts = (info && info.counts) || {};
      const parts = [];
      if (counts.update) parts.push("값 수정 " + counts.update + "건");
      if (counts["delete"]) parts.push("행 삭제 " + counts["delete"] + "건");
      if (counts.insert) parts.push("행 추가 " + counts.insert + "건");
      let text = parts.length ? parts.join(" · ") + " 반영했어요." : "반영할 것이 없었어요.";
      if (counts.unchanged) text += " " + counts.unchanged + "건은 값이 이미 같았습니다.";
      if (counts.missing) text += " " + counts.missing + "건은 지울 행이 이미 없었습니다.";
      if (!info.autoCommit) text += " 커밋해야 확정됩니다.";
      return text;
    };

    const applyStaged = async () => {
      if (!stagedCount() || applying) return;
      const tally = stagedTally();
      const lines = [];
      if (tally.update) lines.push("· 값 수정 " + tally.update + "건");
      if (tally["delete"]) lines.push("· 행 삭제 " + tally["delete"] + "건");
      if (tally.insert) lines.push("· 행 추가 " + tally.insert + "건");
      if (typeof confirmDialog === "function"){
        const ok = await confirmDialog(
          "다음 변경을 서버에 반영합니다.\n\n" + lines.join("\n") + "\n\n"
            + (autoCommit ? "자동 커밋 상태라 적용하면 바로 확정됩니다."
                          : "수동 커밋 상태입니다 — 적용한 뒤 커밋해야 확정됩니다."),
          "적용", "취소");
        if (!ok) return;
      }
      applying = true;
      refreshEditBar();
      resultStatus.textContent = "변경을 적용하는 중…";
      try {
        const response = await jsonOf(await fetch("/db-apply?id=" + encodeURIComponent(sessionId), {
          method:"POST", headers:{ "Content-Type":"application/octet-stream" }, body:applyRequestBody()
        }));
        applying = false;
        if (!response.ok){
          applyTxState(response.info);
          refreshEditBar();
          // 실패하면 묶음 전체가 되돌아간다. 절반만 들어갔다고 오해하게 두지 않는다.
          resultStatus.textContent = messageFor(response.info) + " — 아무것도 반영되지 않았습니다(변경은 그대로 담겨 있습니다).";
          resultStatus.classList.add("db-result-failed");
          return;
        }
        const info = response.info;
        applyTxState(info);
        const reload = currentGrid && currentGrid.reload;
        dropStaged();
        toast(applySummary(info), 3600);
        // 지운 행·넣은 행까지 화면에 맞추는 가장 정직한 방법은 다시 조회하는 것이다.
        if (reload) reload();
        else resultStatus.textContent = applySummary(info) + " 결과를 다시 조회하면 화면에도 반영됩니다.";
      } catch(error){
        applying = false;
        refreshEditBar();
        resultStatus.textContent = launcherMessage(error);
        resultStatus.classList.add("db-result-failed");
      }
    };

    /* 담아 둔 변경 목록 — 나갈 문장을 그대로 보여 주고 하나씩 뺄 수 있다. */
    const openChangesModal = () => {
      if (!stagedCount()) return;
      const modal = el("div", "modal db-value-modal");
      const card = el("div", "modal-card db-changes-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", "담아 둔 변경");
      const head = el("div", "db-value-head");
      const close = button("", "db-table-modal-close", "닫기");
      close.setAttribute("aria-label", "닫기");
      close.innerHTML = uiIcon("close");
      const copyAll = button("전체 복사", "db-btn db-btn-quiet");
      head.append(el("strong", "db-value-title", "담아 둔 변경"), el("span", "db-result-spacer", null), copyAll, close);
      const list = el("div", "db-changes-list");
      const note = el("p", "db-value-note", "");
      card.append(head, list, note);
      modal.append(card);
      document.body.append(modal);

      const forceClose = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
      };
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        forceClose();
      };
      const render = () => {
        list.innerHTML = "";
        if (!stagedCount()){ forceClose(); return; }
        staged.list.forEach((change) => {
          const row = el("div", "db-change-row");
          row.append(el("code", "db-value-sql", changeSql(change)));
          const remove = button("빼기", "db-btn db-btn-quiet", "이 변경만 목록에서 뺍니다");
          remove.addEventListener("click", () => { unstage(change.id); render(); });
          row.append(remove);
          list.append(row);
        });
        note.textContent = "적용을 누르면 위 문장이 한 묶음으로 실행됩니다. 하나라도 실패하면 전부 되돌아갑니다.";
      };
      render();
      close.addEventListener("click", forceClose);
      modal.addEventListener("click", event => { if (event.target === modal) forceClose(); });
      window.addEventListener("keydown", onKey, true);
      copyAll.addEventListener("click", () => {
        const text = staged.list.map(change => changeSql(change) + ";").join("\n");
        if (typeof copyDocumentMenuText === "function") copyDocumentMenuText(text, "변경 문장을 복사했어요.");
        else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("변경 문장을 복사했어요.", 1800));
      });
    };

    /* 행 추가 — 결과에 실린 열만으로는 넣을 수 없다(조회하지 않은 컬럼도 채워야 한다).
       그래서 테이블 정의를 읽어 컬럼 전체를 늘어놓고, 적지 않은 칸은 서버의 기본값에 맡긴다. */
    const openInsertModal = async () => {
      const plan = currentGrid && currentGrid.edit;
      if (!plan || !plan.editable){ toast(editBlockNote(plan), 3500); return; }
      let info;
      try {
        const url = "/db-table?id=" + encodeURIComponent(sessionId) + "&mode=info"
          + "&name=" + encodeURIComponent(plan.table)
          + "&database=" + encodeURIComponent(plan.database || "");
        const response = await jsonOf(await fetch(url, { cache:"no-store" }));
        if (!response.ok){ toast(messageFor(response.info), 3500); return; }
        info = response.info;
      } catch(error){ toast(launcherMessage(error), 3500); return; }

      const modal = el("div", "modal db-value-modal");
      const card = el("div", "modal-card db-insert-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", plan.table + " 행 추가");
      const head = el("div", "db-value-head");
      const close = button("", "db-table-modal-close", "닫기");
      close.setAttribute("aria-label", "닫기");
      close.innerHTML = uiIcon("close");
      head.append(el("strong", "db-value-title", "행 추가 — " + plan.table),
        el("span", "db-result-spacer", null), close);
      const grid = el("div", "db-insert-grid");
      const preview = el("code", "db-value-sql", "");
      const note = el("p", "db-value-note", "적지 않은 칸은 서버의 기본값이 채웁니다.");
      const actions = el("div", "db-value-actions");
      const stage = button("담기", "db-btn db-btn-primary", "변경 목록에 담습니다. 적용을 눌러야 서버에 들어갑니다");
      const cancel = button("취소", "db-btn db-btn-quiet");
      actions.append(el("span", "db-result-spacer", null), cancel, stage);
      card.append(head, grid, el("p", "db-value-sql-note", "이 문장이 실행됩니다 — 값은 문장에 붙여 넣지 않고 따로 보냅니다."),
        preview, actions, note);
      modal.append(card);
      document.body.append(modal);

      const fields = [];
      (info.columns || []).forEach((column) => {
        const extra = String(column.extra || "").toUpperCase();
        const auto = extra.indexOf("AUTO_INCREMENT") >= 0 || extra.indexOf("GENERATED") >= 0;
        const row = el("div", "db-insert-row");
        const label = el("label", "db-insert-label", column.name);
        const type = el("span", "db-insert-type",
          String(column.type || "") + (column.nullable ? "" : " · NOT NULL") + (auto ? " · 자동" : ""));
        const mode = document.createElement("select");
        mode.className = "db-insert-mode";
        [["default", "기본값"], ["value", "값"], ["null", "NULL"]].forEach(([value, text]) => {
          const option = new Option(text, value);
          if (value === "null" && !column.nullable) option.disabled = true;
          mode.append(option);
        });
        const field = input("text", "", column.default == null ? "" : String(column.default));
        field.className = "db-insert-value";
        // 값을 꼭 적어야 하는 컬럼(NOT NULL · 기본값 없음 · 자동 아님)은 처음부터 `값` 으로 연다.
        const required = !column.nullable && column.default == null && !auto;
        mode.value = required ? "value" : "default";
        if (auto) mode.disabled = true;
        label.setAttribute("for", "");
        row.append(label, type, mode, field);
        grid.append(row);
        fields.push({ name:column.name, mode, field, auto, required });
      });

      const collect = () => fields.filter(item => !item.auto && item.mode.value !== "default")
        .map(item => ({ column:item.name, value:item.field.value, isNull:item.mode.value === "null" }));
      const refresh = () => {
        fields.forEach((item) => { item.field.disabled = item.auto || item.mode.value !== "value"; });
        preview.textContent = rowInsertPreview({ database:plan.database, table:plan.table }, collect());
      };
      fields.forEach((item) => {
        item.mode.addEventListener("change", refresh);
        item.field.addEventListener("input", refresh);
      });
      refresh();

      const forceClose = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
      };
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        forceClose();
      };
      close.addEventListener("click", forceClose);
      cancel.addEventListener("click", forceClose);
      modal.addEventListener("click", event => { if (event.target === modal) forceClose(); });
      window.addEventListener("keydown", onKey, true);
      stage.addEventListener("click", () => {
        const missing = fields.filter(item => item.required && item.mode.value === "default").map(item => item.name);
        if (missing.length){
          note.textContent = "값이 필요한 컬럼이 있습니다 — " + missing.join(", ");
          return;
        }
        stageInsert(collect());
        forceClose();
      });
      const first = fields.find(item => !item.auto);
      if (first) first.mode.focus({ preventScroll:true });
    };

    addRowButton.addEventListener("click", openInsertModal);
    deleteRowButton.addEventListener("click", () => {
      const rows = selectedRows();
      if (!rows.length){ toast("지울 행을 먼저 골라 주세요. 왼쪽 번호 칸을 누르면 그 행 전체가 골라집니다.", 3000); return; }
      stageDeleteRows(rows);
    });
    previewChangesButton.addEventListener("click", openChangesModal);
    applyChangesButton.addEventListener("click", applyStaged);
    discardChangesButton.addEventListener("click", async () => {
      if (!stagedCount()) return;
      if (typeof confirmDialog === "function"){
        const ok = await confirmDialog("담아 둔 변경 " + stagedCount() + "건을 모두 버립니다.", "버리기", "취소");
        if (!ok) return;
      }
      discardStaged();
      toast("담아 둔 변경을 모두 버렸어요.", 2000);
    });

    /* 담아 둔 변경이 있는데 표를 다시 그리면 그 변경은 갈 곳이 없어진다. 먼저 묻는다. */
    const confirmLosingStaged = async () => {
      if (!stagedCount()) return true;
      if (typeof confirmDialog !== "function"){ discardStaged(); return true; }
      const ok = await confirmDialog(
        "적용하지 않은 변경 " + stagedCount() + "건이 있습니다.\n다시 조회하면 그 변경은 사라집니다.",
        "버리고 진행", "취소");
      if (!ok) return false;
      discardStaged();
      return true;
    };

    // 고치기 전에 값 전체를 서버에서 다시 읽는다. 표의 값은 500자에서 잘려 있을 수 있고,
    // 그 글자를 그대로 담으면 서버의 값이 잘린 채로 덮인다.
    const readFullCell = async (edit) => {
      const parts = [edit.target.database || "", edit.target.table, edit.column];
      pushKeys(parts, edit.keys);
      const response = await jsonOf(await fetch("/db-cell?id=" + encodeURIComponent(sessionId), {
        method:"POST", headers:{ "Content-Type":"application/octet-stream" }, body:encodeStrings(parts)
      }));
      if (!response.ok) throw new Error(messageFor(response.info));
      return response.info;
    };

    const openValueModal = (columnName, text, note, isNull, edit) => {
      if (closeValueModal) closeValueModal();
      const modal = el("div", "modal db-value-modal");
      const card = el("div", "modal-card db-value-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", columnName + " 값");

      const head = el("div", "db-value-head");
      const title = el("strong", "db-value-title", columnName);
      const editButton = button("값 고치기", "db-btn db-btn-quiet", "이 칸의 값을 고칩니다");
      const copy = button("값 복사", "db-btn db-btn-quiet");
      const close = button("", "db-table-modal-close", "닫기");
      close.setAttribute("aria-label", "닫기");
      close.innerHTML = uiIcon("close");
      copy.disabled = !!isNull;
      editButton.hidden = !(edit && edit.editable);
      head.append(title, el("span", "db-result-spacer", null), editButton, copy, close);

      const body = el("pre", "db-value-body", text);
      body.tabIndex = 0;
      body.classList.toggle("db-value-null", !!isNull);

      /* 고치는 자리. 만들어만 두고 숨긴다 — `값 고치기`를 누른 뒤에야 보인다. */
      const editWrap = el("div", "db-value-edit");
      editWrap.hidden = true;
      const input = el("textarea", "db-value-body db-value-input");
      input.setAttribute("aria-label", columnName + " 값 고치기");
      const nullBox = el("input");
      nullBox.type = "checkbox";
      const nullLabel = el("label", "db-value-null-toggle");
      nullLabel.append(nullBox, el("span", null, "빈 값(NULL)으로 두기"));
      const preview = el("code", "db-value-sql", "");
      const actions = el("div", "db-value-actions");
      const save = button("담기", "db-btn db-btn-primary",
        "변경 목록에 담습니다. 위의 ‘적용’을 눌러야 서버에 반영됩니다");
      const cancel = button("취소", "db-btn db-btn-quiet");
      actions.append(nullLabel, el("span", "db-result-spacer", null), cancel, save);
      editWrap.append(input,
        el("p", "db-value-sql-note", "이 문장이 실행됩니다 — 값은 문장에 붙여 넣지 않고 따로 보냅니다."),
        preview, actions);

      const noteLine = el("p", "db-value-note", note);
      card.append(head, body, editWrap, noteLine);
      modal.append(card);
      document.body.append(modal);
      if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

      let editing = false;
      const forceClose = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
        closeValueModal = null;
      };
      const stopEdit = () => {
        editing = false;
        editWrap.hidden = true;
        body.hidden = false;
        editButton.hidden = false;
        noteLine.textContent = note;
        body.focus({ preventScroll:true });
      };
      // 위에 다른 창이 떠 있으면 그 창이 먼저 닫혀야 한다(ERD·테이블 정보 모달과 같은 규칙).
      // 고치던 중이면 창보다 고치기를 먼저 접는다 — 쓰던 값이 Esc 한 번에 사라지지 않게 한다.
      const onKey = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (editing) stopEdit();
        else forceClose();
      };
      closeValueModal = forceClose;
      close.addEventListener("click", forceClose);
      modal.addEventListener("click", event => { if (event.target === modal && !editing) forceClose(); });
      window.addEventListener("keydown", onKey, true);
      copy.addEventListener("click", () => {
        if (typeof copyDocumentMenuText === "function") copyDocumentMenuText(text, "셀 값을 복사했어요.");
        else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("셀 값을 복사했어요.", 1800));
      });

      /* 고치기 ------------------------------------------------------------- */

      const refreshPreview = () => {
        const value = input.value;
        // 미리보기는 사람이 읽는 것이라 긴 값은 줄여 보여 준다(저장되는 값은 줄이지 않는다).
        const shown = value.length > 160 ? value.slice(0, 160) + "…" : value;
        preview.textContent = cellUpdatePreview(edit.target, edit.column, edit.keys, shown, nullBox.checked);
      };
      const startEdit = async () => {
        editButton.disabled = true;
        let current = edit.staged
          ? { value:edit.staged.value, isNull:edit.staged.isNull }
          : { value:isNull ? "" : text, isNull:!!isNull };
        if (!edit.staged && (edit.clipped || isNull)){
          // 잘려 온 값과 NULL 은 표의 글자를 믿을 수 없다. 서버에서 원본을 다시 읽는다.
          noteLine.textContent = "값을 읽는 중…";
          try { current = await readFullCell(edit); }
          catch(error){
            noteLine.textContent = String((error && error.message) || error);
            editButton.disabled = false;
            return;
          }
        }
        editButton.disabled = false;
        editing = true;
        input.value = current.isNull ? "" : String(current.value == null ? "" : current.value);
        nullBox.checked = !!current.isNull;
        input.disabled = nullBox.checked;
        body.hidden = true;
        editButton.hidden = true;
        editWrap.hidden = false;
        let hint = edit.column + (edit.type ? " · " + edit.type : "")
          + (edit.nullable ? " · NULL 허용" : " · NULL 불가");
        if (current.clipped) hint += " · 값이 너무 길어 앞부분만 읽었습니다(그대로 저장하면 뒷부분이 사라집니다)";
        noteLine.textContent = hint;
        refreshPreview();
        input.focus({ preventScroll:true });
        input.setSelectionRange(input.value.length, input.value.length);
      };
      editButton.addEventListener("click", startEdit);
      cancel.addEventListener("click", stopEdit);
      input.addEventListener("input", refreshPreview);
      nullBox.addEventListener("change", () => {
        input.disabled = nullBox.checked;
        refreshPreview();
      });
      // 여러 줄 값도 다루므로 Enter 는 줄바꿈이다. 저장은 Ctrl+Enter 로 한다(편집기와 같은 규칙).
      input.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter"){ event.preventDefault(); save.click(); }
      });
      save.addEventListener("click", () => {
        if (nullBox.checked && !edit.nullable){
          noteLine.textContent = "이 컬럼은 빈 값(NULL)을 받지 않습니다.";
          return;
        }
        if (!stagedUpdate(edit.row, edit.col) && stagedCount() >= MAX_STAGED){
          noteLine.textContent = "한 번에 담을 수 있는 변경은 " + MAX_STAGED + "건까지입니다. 먼저 적용해 주세요.";
          return;
        }
        const kept = stageUpdate(edit, input.value, nullBox.checked);
        forceClose();
        toast(kept ? "변경 목록에 담았어요. 위의 ‘적용’을 눌러야 서버에 반영됩니다."
                   : "원래 값과 같아 담지 않았어요.", 2800);
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
    let gridCaret = null;        // 지금 칸(방향키·타자가 여기서 시작한다). 고른 범위의 끝이다.
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

    const refreshMemoButton = (bounds) => {
      const selected = !!bounds;
      memoButton.textContent = selected ? "선택 메모로" : "전체 메모로";
      memoButton.title = selected
        ? "선택한 결과 칸과 컬럼명을 메모 표로 보냅니다"
        : "현재 결과 표 전체와 컬럼명을 메모로 보냅니다";
    };

    const refreshSelectInfo = (bounds) => {
      refreshMemoButton(bounds);
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
      gridCaret = null;
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

    /* 표 안에서 바로 고치기 --------------------------------------------------
       칸을 고르고 F2 나 글자를 치면 그 자리가 입력칸이 된다. Enter 는 담고 아래로,
       Tab 은 담고 다음 고칠 수 있는 칸으로, Esc 는 되돌린다. 담기는 값 창과 같은 길을 쓴다 —
       입력하는 자리만 다를 뿐 무엇이 담기는지·언제 서버에 가는지는 하나다.

       한 줄짜리 입력칸이라 여러 줄 값과 잘려 온 값은 여기서 고치지 않는다. 값 창으로 보낸다 —
       input 은 값에 든 줄바꿈을 조용히 지우므로 그대로 담으면 줄이 사라진다. */

    let inlineEdit = null;       // { row, col, node, input, before, context }

    const focusGrid = () => { if (currentGrid) currentGrid.table.focus({ preventScroll:true }); };

    const cancelInlineEdit = () => {
      if (!inlineEdit) return;
      const { node, before } = inlineEdit;
      inlineEdit = null;                       // blur 로 다시 들어오지 않게 먼저 지운다
      node.classList.remove("db-cell-editing");
      node.textContent = before.text;
    };

    const commitInlineEdit = () => {
      if (!inlineEdit) return;
      const { node, before, context, input } = inlineEdit;
      const value = input.value;
      inlineEdit = null;
      node.classList.remove("db-cell-editing");
      node.textContent = before.text;          // 담기가 다시 칠하므로 원래 모습으로 돌려놓고 넘긴다
      // NULL 칸을 빈 채로 두고 나가면 아무 일도 하지 않는다. 빈 문자열은 NULL 과 다른 값이라
      // "그냥 지나갔다"를 "빈 문자열로 바꿔라"로 읽으면 안 된다(빈 문자열은 값 창에서 넣는다).
      if (before.isNull && value === "") return;
      stageUpdate(context, value, false);
    };

    const inlineEditableCol = (col) => {
      const plan = currentGrid && currentGrid.edit;
      if (!plan || !plan.editable) return false;
      const cell = (plan.cells || [])[col];
      return !!(cell && cell.editable);
    };

    const nextEditableCol = (col, step) => {
      for (let index = col + step; index >= 0 && index < gridColumnCount(); index += step){
        if (inlineEditableCol(index)) return index;
      }
      return -1;
    };

    // 돌려주는 값: 시작했으면 null, 못 했으면 그 까닭({ note, modal })
    const startInlineEdit = (row, col, initial) => {
      commitInlineEdit();
      const node = gridCellAt(row, col);
      if (!node) return { note:"" };
      const clipped = node.classList.contains("db-clipped");
      const context = cellEditContext(row, col, clipped);
      if (!context.editable) return { note:context.note };
      const isNull = node.classList.contains("db-null");
      const text = isNull ? "" : node.textContent;
      if (clipped || /[\r\n]/.test(text))
        return { note:"여러 줄 값과 잘려 온 값은 값 창에서 고칩니다.", modal:true };

      const before = { text:node.textContent, isNull };
      const input = document.createElement("input");
      input.type = "text";
      input.className = "db-cell-input";
      input.value = initial == null ? text : initial;
      input.setAttribute("aria-label", (currentGrid.columns[col] || "값") + " 고치기");
      node.textContent = "";
      node.classList.add("db-cell-editing");
      node.append(input);
      inlineEdit = { row, col, node, input, before, context };
      input.focus({ preventScroll:true });
      if (initial == null) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);

      // 입력칸 안의 키·끌기는 표의 단축키와 칸 고르기에 넘기지 않는다.
      input.addEventListener("pointerdown", event => event.stopPropagation());
      input.addEventListener("blur", () => { if (inlineEdit && inlineEdit.input === input) commitInlineEdit(); });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape"){ event.preventDefault(); cancelInlineEdit(); focusGrid(); return; }
        if (event.key === "Enter"){
          event.preventDefault();
          commitInlineEdit();
          focusGrid();
          moveCaret(1, 0, false);
          return;
        }
        if (event.key === "Tab"){
          event.preventDefault();
          const from = inlineEdit ? inlineEdit.col : col;
          commitInlineEdit();
          focusGrid();
          const next = nextEditableCol(from, event.shiftKey ? -1 : 1);
          if (next < 0) return;
          selectCell(row, next);
          startInlineEdit(row, next);
        }
      });
      return null;
    };

    const selectCell = (row, col) => {
      gridCaret = { row, col };
      applyGridRange("cell", gridCaret, gridCaret, null, "replace");
      const node = gridCellAt(row, col);
      if (node && node.scrollIntoView) node.scrollIntoView({ block:"nearest", inline:"nearest" });
    };

    const moveCaret = (rowStep, colStep, extend) => {
      const from = gridCaret || (gridSelection && gridSelection.anchor);
      if (!from || !gridRowCount() || !gridColumnCount()) return;
      const row = Math.max(0, Math.min(gridRowCount() - 1, from.row + rowStep));
      const col = Math.max(0, Math.min(gridColumnCount() - 1, from.col + colStep));
      if (extend && gridSelection && gridSelection.anchor){
        gridCaret = { row, col };
        applyGridRange("cell", gridSelection.anchor, gridCaret, null, "replace");
        const node = gridCellAt(row, col);
        if (node && node.scrollIntoView) node.scrollIntoView({ block:"nearest", inline:"nearest" });
        return;
      }
      selectCell(row, col);
    };

    /* 칸을 여는 길은 하나다 — 고칠 수 있으면 그 자리에서 고치고, 아니면 값 창을 연다.
       값 창은 긴 값·여러 줄 값·NULL 을 다루는 자리이자 고치지 못하는 까닭을 밝히는 자리다.
       두 번 누르기·F2·타자가 모두 이 길을 타므로 "어떨 때 무엇이 열리는지" 를 하나로 설명할 수 있다. */
    const openCellAt = (row, col, initial) => {
      if (!currentGrid) return;
      if (!startInlineEdit(row, col, initial)) return;        // null = 그 자리에서 열렸다
      const node = gridCellAt(row, col);
      if (!node) return;
      showCellValue(currentGrid.columns[col] || "",
        node.classList.contains("db-null") ? null : node.textContent,
        node.classList.contains("db-clipped"), { row, col });
    };

    const attachGridSelection = (table) => {
      table.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !grid) return;
        if (event.target.closest(".db-sort-btn")) return;      // 정렬 버튼은 정렬만 한다
        if (event.target.closest(".db-cell-input")) return;    // 고치는 중인 칸은 글자를 고르는 자리다
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
        if (point.kind === "cell") gridCaret = { row:point.row, col:point.col };
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

      /* 클릭은 고르는 일, 더블클릭은 그 칸을 여는 일 — 고칠 수 있으면 그 자리에서 고치고
         아니면 값 창이 열린다(F2 와 같은 길이다).
         target 을 믿지 않고 좌표로 셀을 찾는다 — 더블클릭의 target 은 두 번의 누름·뗌이
         공유하는 조상이라 셀이 아니라 <table> 이 될 수 있다. */
      table.addEventListener("dblclick", (event) => {
        if (event.target.closest && event.target.closest(".db-sort-btn")) return;
        if (event.target.closest && event.target.closest(".db-cell-input")) return;   // 이미 고치는 중이다
        const node = document.elementFromPoint(event.clientX, event.clientY);
        const point = gridPointFrom(node) || gridPointFrom(event.target);
        if (!point || point.kind !== "cell" || !currentGrid) return;
        if (!gridCellAt(point.row, point.col)) return;
        gridCaret = { row:point.row, col:point.col };
        openCellAt(point.row, point.col);
      });

      table.addEventListener("keydown", (event) => {
        const key = String(event.key || "").toLowerCase();
        const modified = event.ctrlKey || event.metaKey || event.altKey;
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
        const steps = { arrowup:[-1, 0], arrowdown:[1, 0], arrowleft:[0, -1], arrowright:[0, 1] };
        if (steps[key] && !event.ctrlKey && !event.metaKey){
          // 방향키가 표 안에서 칸을 옮긴다. 그러지 않으면 결과 영역만 스크롤되고 지금 칸이 어디인지 잃는다.
          if (!gridCaret && !gridSelection) selectCell(0, 0);
          else moveCaret(steps[key][0], steps[key][1], event.shiftKey);
          event.preventDefault();
          return;
        }
        const caret = gridCaret || (gridSelection && gridSelection.anchor);
        if (caret && !modified && !event.isComposing && (key === "f2" || key === "enter")){
          event.preventDefault();
          openCellAt(caret.row, caret.col);
          return;
        }
        /* 글자를 치면 그 글자로 고치기가 시작된다(엑셀·표 편집기와 같은 규칙).
           ⚠ 한글 IME 는 keydown 이 Process(229) 로 온다. 그때는 preventDefault 하지 않고
           입력칸만 열어 조합이 그 칸에서 시작되게 한다 — 막으면 첫 글자 조합이 끊긴다.
           (스프레드시트 뷰어가 같은 이유로 같은 방식을 쓴다.) */
        const ime = event.key === "Process" || event.keyCode === 229;
        const printable = String(event.key || "").length === 1;
        if (caret && !modified && !event.isComposing && (ime || printable)){
          if (!inlineEditableCol(caret.col)) return;
          if (!ime) event.preventDefault();
          openCellAt(caret.row, caret.col, ime ? "" : event.key);
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

    /* 현재 결과를 메모 표 블록으로 옮긴다. 선택이 있으면 선택 경계만 보내고, Ctrl 로 띄엄띄엄
       고른 영역의 선택하지 않은 칸은 빈칸으로 둔다. 메모 표 상한(20열·3,000칸)을 넘으면
       행과 열을 나눈 여러 표 블록으로 보내 전체 값이 조용히 잘리지 않게 한다. */
    const memoRowsFromGrid = () => {
      if (!currentGrid || !currentGrid.columns.length) return null;
      const columnCount = gridColumnCount();
      const bounds = gridSelection && grid
        ? grid.gridSelectionBoundsFromKeys(gridSelection.keys, columnCount) : null;
      const row1 = bounds ? bounds.row1 : 0;
      const row2 = bounds ? bounds.row2 : Math.max(0, gridRowCount() - 1);
      const col1 = bounds ? bounds.col1 : 0;
      const col2 = bounds ? bounds.col2 : columnCount - 1;
      const rows = [currentGrid.columns.slice(col1, col2 + 1)];
      for (let row = row1; row <= row2; row++){
        const values = [];
        for (let col = col1; col <= col2; col++){
          const selected = !bounds || gridSelection.keys.has(row * columnCount + col);
          const cell = selected ? gridCellAt(row, col) : null;
          values.push(cell ? cell.textContent : "");
        }
        rows.push(values);
      }
      return { rows, selected:!!bounds, cells:bounds ? bounds.count : gridRowCount() * columnCount };
    };

    const memoTableChunks = (rows) => {
      if (!Array.isArray(rows) || !rows.length) return [];
      const header = rows[0], body = rows.slice(1), chunks = [];
      const maxColumns = 20, maxCells = 3000, maxRows = 200;
      for (let col = 0; col < header.length; col += maxColumns){
        const width = Math.min(maxColumns, header.length - col);
        const dataRowsPerTable = Math.max(1, Math.min(maxRows - 1, Math.floor(maxCells / width) - 1));
        if (!body.length){ chunks.push([header.slice(col, col + width)]); continue; }
        for (let row = 0; row < body.length; row += dataRowsPerTable){
          chunks.push([
            header.slice(col, col + width),
            ...body.slice(row, row + dataRowsPerTable).map(values => values.slice(col, col + width))
          ]);
        }
      }
      return chunks;
    };

    memoButton.addEventListener("click", () => {
      if (typeof window.addTableToScratchpad !== "function"){
        toast("메모 기능을 불러오지 못했습니다.", 2400);
        return;
      }
      const source = memoRowsFromGrid();
      if (!source || source.rows.length < 2){ toast("메모로 보낼 결과 행이 없습니다.", 2000); return; }
      const chunks = memoTableChunks(source.rows);
      let added = 0;
      for (const rows of chunks){
        const result = window.addTableToScratchpad(rows);
        if (!result) break;
        added++;
      }
      if (!added){ toast("결과를 메모로 보내지 못했습니다.", 2400); return; }
      const subject = source.selected ? "선택한 결과" : "현재 결과 전체";
      toast(subject + "를 메모 표 " + added.toLocaleString() + "개로 보냈어요.", 3000);
    });

    // 행을 tbody 에 채운다. startIndex 는 화면에 매기는 번호의 시작(더 보기로 이어 붙일 때 쓴다).
    // 고칠 수 있는 열. 판정은 워커가 하고 화면은 그 결과만 옮긴다(계산식·조인 열은 빠진다).
    const editableColumns = () => {
      const plan = currentGrid && currentGrid.edit;
      const set = new Set();
      if (!plan || !plan.editable) return set;
      (plan.cells || []).forEach((cell, index) => { if (cell && cell.editable) set.add(index); });
      return set;
    };

    const fillRows = (bodyEl, columns, rows, clippedCells, startIndex) => {
      const clipped = new Set((clippedCells || []).map(pair => pair[0] + "," + pair[1]));
      const editable = editableColumns();
      rows.forEach((row, rowIndex) => {
        const tr = el("tr");
        tr.append(el("td", "db-grid-index", String(startIndex + rowIndex + 1)));
        row.forEach((value, columnIndex) => {
          const td = el("td");
          const isClipped = clipped.has(rowIndex + "," + columnIndex);
          if (value === null){ td.classList.add("db-null"); td.textContent = "NULL"; }
          else td.textContent = String(value);
          if (isClipped) td.classList.add("db-clipped");
          if (editable.has(columnIndex)) td.classList.add("db-cell-editable");
          td.title = editable.has(columnIndex)
            ? "두 번 누르거나 F2·타자로 바로 고칩니다 (긴 값·NULL 은 값 창이 열립니다)"
            : "누르면 이 칸을 고르고, 두 번 누르면 값 전체를 봅니다";
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

    const renderRows = (columns, rows, truncated, clippedCells, sortable, editInfo) => {
      cancelInlineEdit();
      clearGridSelection();
      dropStaged();                  // 새로 그린 표에는 앞의 변경을 되돌릴 자리가 없다
      const edit = editInfo ? editInfo.plan : null;
      resultHost.innerHTML = "";
      closeValuePanel();
      lastRows = null;
      memoButton.hidden = true;
      exportCsvButton.hidden = true;
      openSheetButton.hidden = true;
      if (!columns.length){
        notice(resultHost, "결과 열이 없습니다", "", "");
        return;
      }
      const table = el("table", "db-grid");
      table.tabIndex = 0;
      table.setAttribute("aria-label",
        "결과 표. 방향키로 칸을 옮기고 Ctrl+C 로 복사합니다. 고칠 수 있는 결과에서는 F2 나 두 번 누르기로 그 자리에서 고칩니다.");
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
      currentGrid = { body:bodyEl, columns:columns.slice(), table, headRow, indexHead, headCells,
        edit:edit || null, reload:(editInfo && editInfo.reload) || null };
      attachGridSelection(table);
      fillRows(bodyEl, columns, rows, clippedCells, 0);
      if (truncated && !rows.length){
        resultHost.append(el("p", "db-truncated", "표시할 행이 없습니다."));
      }
      // 고칠 수 있는 결과는 그렇다고 밝힌다. 두 번 눌러야 열리는 일은 알려 주지 않으면 아무도 찾지 못한다.
      const editable = !!(currentGrid.edit && currentGrid.edit.editable);
      addRowButton.hidden = !editable;
      deleteRowButton.hidden = !editable;
      if (editable && rows.length){
        resultHost.append(el("p", "db-edit-hint",
          "이 결과는 " + currentGrid.edit.table + " 을(를) 고칠 수 있습니다 — 칸을 두 번 누르거나 F2,"
            + " 또는 바로 타자를 치면 그 자리에서 고칩니다(Enter 아래로 · Tab 옆으로 · Esc 취소)."
            + " 긴 값·여러 줄 값·NULL 은 값 창이 대신 열립니다. 행을 골라 ‘행 삭제’, 새 행은 ‘행 추가’ 로 담고,"
            + " 담은 변경은 ‘적용’ 을 눌러야 서버에 갑니다."));
      }
      lastRows = [columns.slice()].concat(rows.map(row => row.map(value => value === null ? "" : String(value))));
      memoButton.hidden = false;
      refreshMemoButton(null);
      exportCsvButton.hidden = false;
      openSheetButton.hidden = false;
    };

    const clearResult = () => {
      cancelInlineEdit();
      resultHost.innerHTML = "";
      clearGridSelection();
      dropStaged();
      addRowButton.hidden = true;
      deleteRowButton.hidden = true;
      currentGrid = null;
      resultTabs.innerHTML = "";
      resultTabs.hidden = true;
      resultSets = [];
      closeValuePanel();
      lastRows = null;
      memoButton.hidden = true;
      exportCsvButton.hidden = true;
      openSheetButton.hidden = true;
    };

    const showResultSet = (index) => {
      const entry = resultSets[index];
      Array.from(resultTabs.children).forEach((node, position) =>
        node.classList.toggle("active", position === index));
      if (!entry) return;
      if (entry.kind === "rows"){
        renderRows(entry.columns, entry.rows, entry.truncated, entry.clippedCells, sortableFor(entry),
          { plan:entry.edit, reload:reloadFor(entry) });
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
      memoButton.hidden = true;
      exportCsvButton.hidden = true;
      openSheetButton.hidden = true;
      addRowButton.hidden = true;
      deleteRowButton.hidden = true;
      const sql = entry.sql ? previewOf(entry.sql, 200) : "";
      if (entry.kind === "error"){
        const where = Number.isInteger(entry.scriptLine) ? "스크립트 " + entry.scriptLine + "행 · " : "";
        notice(resultHost, where + messageFor(entry), sql, "error");
        return;
      }
      const affected = Number(entry.affected) || 0;
      const insertId = Number(entry.insertId) || 0;
      notice(resultHost, (entry.keyword || "").toUpperCase() + " — " + affected.toLocaleString() + "행 반영",
        sql + (insertId ? " · 새 자동 증가 값 " + insertId : ""), "");
    };

    /* 적용한 뒤에는 다시 조회한다. 지운 행·넣은 행까지 화면에 맞추는 가장 정직한 방법이고,
       문장이 잘려 왔으면(sqlTruncated) 다시 물을 수 없으므로 그때는 사용자에게 맡긴다. */
    const reloadFor = (entry) => {
      if (!entry || !entry.sql || entry.sqlTruncated) return null;
      return () => runQuery({ sql:entry.sql, label:"다시 조회", quiet:true, skipRiskConfirm:true });
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
      const statement = Number.isInteger(entry.statement) ? entry.statement + 1 : index + 1;
      const result = Number(entry.resultIndex) > 0 ? "." + (Number(entry.resultIndex) + 1) : "";
      const head = statement + result + " · " + (previewOf(entry.sql || "", 34) || (entry.keyword || "").toUpperCase());
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
        ? ((Number.isInteger(failure.failedStatement) ? failure.failedStatement + 1 : resultSets.length)
            + "번째 문장에서 멈춤"
            + (Number.isInteger(failure.scriptLine) ? " (스크립트 " + failure.scriptLine + "행)" : "")
            + " — " + messageFor(failure))
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
      { type:"event", label:"Events", icon:"event" },
      { type:"trigger", label:"Triggers", icon:"trigger" }
    ];
    const expandedSchemaGroups = new Set(["table", "view"]);
    const expandedTables = new Set();
    const expandedTableSections = new Set();
    let selectedSchemaKey = "";
    let selectedSchemaItem = null;
    let tableContextMenu = null;
    let schemaDeletePending = false;
    let closeErdModal = null;

    const schemaIcon = (kind, className) => {
      const icon = el("span", className || "db-schema-icon");
      icon.innerHTML = uiIcon(kind);
      return icon;
    };

    const schemaKey = (item) => String(item.type || "table") + ":" + String(item.table || "") + ":" + String(item.name || "");

    const setSchemaSelection = (item) => {
      selectedSchemaKey = item ? schemaKey(item) : "";
      selectedSchemaItem = item ? { ...item } : null;
      tableList.querySelectorAll("[data-schema-key]").forEach((node) =>
        node.classList.toggle("selected", node.dataset.schemaKey === selectedSchemaKey));
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

    const openRelatedDependency = (dependency) => {
      const tableName = String(dependency && dependency.table || "");
      if (!tableName) return;
      const tableItem = schemaObjects.find(item => (item.type === "table" || item.type === "view")
        && item.name === tableName);
      if (tableItem) setSchemaSelection(tableItem);
      const tab = dependency.kind === "foreignKey" ? "foreignKeys"
        : dependency.kind === "index" ? "indexes" : dependency.kind === "column" ? "columns" : "overview";
      openTableInfoModal(tableName, tab);
    };

    const requestSchemaDelete = async (item) => {
      if (!item || schemaDeletePending) return;
      if (readOnly){ toast("읽기 전용 접속에서는 스키마 객체를 삭제할 수 없습니다.", 3000); return; }
      if (runningJob){ toast("실행 중인 쿼리가 끝난 뒤 삭제해 주세요.", 2600); return; }
      const sql = schemaDropSql(item, currentDatabase);
      if (!sql){ toast("이 트리 항목은 직접 삭제할 수 없습니다.", 2600); return; }
      const label = schemaObjectLabel(item);
      const qualified = currentDatabase + "." + (item.table ? item.table + "." : "") + item.name;
      schemaDeletePending = true;
      try {
        const url = "/db-dependencies?id=" + encodeURIComponent(sessionId)
          + "&kind=" + encodeURIComponent(item.type)
          + "&name=" + encodeURIComponent(item.name)
          + "&table=" + encodeURIComponent(item.table || "")
          + "&database=" + encodeURIComponent(currentDatabase);
        const response = await jsonOf(await fetch(url, { cache:"no-store" }));
        if (!response.ok){ toast(messageFor(response.info), 4000); return; }
        const info = response.info || {};
        const dependencies = Array.isArray(info.dependencies) ? info.dependencies : [];
        if (dependencies.length){
          const lines = dependencies.slice(0, 8).map(dependency => "· " + (dependency.detail
            || schemaObjectLabel({ type:dependency.kind }) + " " + dependency.name)).join("\n");
          const more = dependencies.length > 8 ? "\n· 그 밖 " + (dependencies.length - 8) + "개" : "";
          const related = dependencies.find(dependency => dependency.table);
          const message = label + " ‘" + qualified + "’을(를) 삭제할 수 없습니다.\n\n"
            + lines + more + "\n\n먼저 위 객체의 참조를 변경하거나 삭제해 주세요.";
          if (typeof confirmDialog === "function"){
            const open = await confirmDialog(message, related ? "관련 테이블 열기" : "확인", "닫기");
            if (open && related) openRelatedDependency(related);
          } else toast("다른 객체가 사용 중이라 삭제할 수 없습니다.", 4200);
          return;
        }
        const warnings = Array.isArray(info.warnings) ? info.warnings : [];
        const warningText = warnings.length ? "\n\n함께 확인할 내용:\n"
          + warnings.slice(0, 5).map(message => "· " + message).join("\n") : "";
        const dataWarning = item.type === "table" || item.type === "column"
          ? "\n\n저장된 데이터도 사라집니다." : "";
        const ok = typeof confirmDialog !== "function" || await confirmDialog(
          label + " ‘" + qualified + "’을(를) 삭제할까요?\n\n실행 SQL:\n" + sql
            + dataWarning + warningText
            + "\n\nMySQL 구조 변경은 즉시 확정되며 롤백하기 어렵습니다.",
          label + " 삭제", "취소");
        if (!ok) return;
        await runQuery({
          sql, label:label + " 삭제", skipRiskConfirm:true,
          onComplete:(success, failure) => {
            if (success){
              setSchemaSelection(null);
              toast(label + " ‘" + item.name + "’을(를) 삭제했습니다.", 2600);
              return;
            }
            if (failure && failure.code === "dependency" && typeof confirmDialog === "function")
              confirmDialog("다른 객체가 사용 중이라 삭제할 수 없습니다.\n\n" + String(failure.detail || ""), "확인", "닫기");
          }
        });
      } catch(error){
        toast(launcherMessage(error), 4000);
      } finally {
        schemaDeletePending = false;
      }
    };

    const openTableContextMenu = (item, x, y) => {
      closeTableContextMenu();
      const menu = el("div", "db-table-context-menu");
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", item.name + " 작업");
      const childTab = item.type === "column" ? "columns"
        : item.type === "index" ? "indexes" : item.type === "foreignKey" ? "foreignKeys" : "";
      const tableTarget = item.type === "table" || item.type === "view" || childTab;
      const infoItem = button("", "db-table-context-item",
        tableTarget ? "테이블 구조와 컬럼 정보를 봅니다" : "객체 정의를 봅니다");
      infoItem.setAttribute("role", "menuitem");
      infoItem.append(schemaIcon("info", "db-table-context-icon"),
        document.createTextNode(tableTarget ? "테이블 정보" : "정의 보기"));
      infoItem.addEventListener("click", () => {
        closeTableContextMenu();
        setSchemaSelection(item);
        if (tableTarget) openTableInfoModal(item.table || item.name, childTab);
        else openObjectInfoModal(item);
      });
      const label = schemaObjectLabel(item);
      const deleteItem = button("", "db-table-context-item danger", label + " 삭제");
      deleteItem.setAttribute("role", "menuitem");
      deleteItem.append(schemaIcon("delete", "db-table-context-icon"), document.createTextNode(label + " 삭제"));
      deleteItem.disabled = readOnly;
      if (readOnly) deleteItem.title = "읽기 전용 접속입니다.";
      deleteItem.addEventListener("click", () => {
        closeTableContextMenu();
        requestSchemaDelete(item);
      });
      menu.append(infoItem);
      // 덤프는 객체 자체를 대상으로 삼는다. 컬럼·인덱스·외래키처럼 테이블에 딸린 것을
      // 눌렀다면 그 테이블을 고른 채로 연다.
      const dumpKind = DUMP_KINDS_FROM_TREE[item.type] || (childTab ? "table" : "");
      const dumpName = childTab ? (item.table || item.name) : item.name;
      if (dumpKind && dumpName){
        const dumpItem = button("", "db-table-context-item",
          "이 객체를 CREATE·INSERT 문이 든 .sql 파일로 내보냅니다");
        dumpItem.setAttribute("role", "menuitem");
        dumpItem.append(schemaIcon("save", "db-table-context-icon"),
          document.createTextNode("SQL로 내보내기"));
        dumpItem.addEventListener("click", () => {
          closeTableContextMenu();
          setSchemaSelection(item);
          openDumpModal([dumpKind + ":" + dumpName]);
        });
        menu.append(dumpItem);
      }
      menu.append(deleteItem);
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

    const bindSchemaObjectNode = (node, item, activate, marker) => {
      const selectedNode = marker || node;
      selectedNode.dataset.schemaKey = schemaKey(item);
      selectedNode.classList.toggle("selected", selectedSchemaKey === schemaKey(item));
      node.setAttribute("aria-haspopup", "menu");
      node.addEventListener("focus", () => setSchemaSelection(item));
      node.addEventListener("click", () => {
        setSchemaSelection(item);
        if (activate) activate();
      });
      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        setSchemaSelection(item);
        openTableContextMenu(item, event.clientX, event.clientY);
      });
      node.addEventListener("keydown", (event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const bounds = node.getBoundingClientRect();
        setSchemaSelection(item);
        openTableContextMenu(item, bounds.left + 18, bounds.bottom - 2);
      });
    };

    tableList.addEventListener("keydown", (event) => {
      if (event.key !== "Delete" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!event.target.closest(".db-table-item,.db-column-item") || !selectedSchemaItem) return;
      event.preventDefault();
      requestSchemaDelete(selectedSchemaItem);
    });

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
          const child = { ...column, type:"column", table:item.name };
          const node = button("", "db-column-item",
            column.name + " " + column.type + (column.nullable ? "" : " NOT NULL")
              + (column.comment ? " — " + column.comment : ""));
          if (column.key === "PRI") node.classList.add("db-column-key");
          node.append(schemaIcon(column.key === "PRI" ? "key" : "column", "db-column-icon"),
            el("span", "db-column-name", column.name), el("span", "db-column-type", column.type));
          bindSchemaObjectNode(node, child, () => insertIntoEditor(identifierFor(column.name)));
          return node;
        };
        const indexNode = (index) => {
          const child = { ...index, type:"index", table:item.name };
          const columns = (index.columns || []).map(column => column.name || "함수식").join(", ");
          const node = button("", "db-column-item", index.name + " — " + columns);
          node.append(schemaIcon(index.name === "PRIMARY" ? "key" : "index", "db-column-icon"),
            el("span", "db-column-name", index.name),
            el("span", "db-column-type", (index.unique ? "UNIQUE · " : "") + index.type + " · " + columns));
          bindSchemaObjectNode(node, child, () => openTableInfoModal(item.name, "indexes"));
          return node;
        };
        const foreignKeyNode = (foreignKey) => {
          const child = { ...foreignKey, type:"foreignKey", table:item.name };
          const local = (foreignKey.columns || []).map(column => column.local).join(", ");
          const referenced = (foreignKey.columns || []).map(column => column.referenced).join(", ");
          const detail = local + " · " + foreignKey.referencedDatabase + "." + foreignKey.referencedTable + "(" + referenced + ")";
          const node = button("", "db-column-item", foreignKey.name + " — " + detail);
          node.append(schemaIcon("foreignKey", "db-column-icon"), el("span", "db-column-name", foreignKey.name),
            el("span", "db-column-type", detail));
          bindSchemaObjectNode(node, child, () => openTableInfoModal(item.name, "foreignKeys"));
          return node;
        };
        const triggerNode = (trigger) => {
          const child = { ...trigger, type:"trigger", table:item.name };
          const node = button("", "db-column-item", trigger.name + " — " + trigger.timing + " " + trigger.event);
          node.append(schemaIcon("trigger", "db-column-icon"), el("span", "db-column-name", trigger.name),
            el("span", "db-column-type", trigger.timing + " " + trigger.event));
          bindSchemaObjectNode(node, child, () => openObjectInfoModal(child));
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
            if (item.type === "trigger" && item.table) name.append(el("span", "db-table-object-meta", item.table));
            bindSchemaObjectNode(name, item, () => {
              if (item.type === "table" || item.type === "view") showTable(item.name);
              else openObjectInfoModal(item);
            }, row);

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
        ...(Array.isArray(info.events) ? info.events : []),
        ...(Array.isArray(info.triggers) ? info.triggers : [])
      ];
      tableChildrenCache.clear();
      if (previousDatabase !== currentDatabase){
        selectedSchemaKey = "";
        selectedSchemaItem = null;
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

    /* 객체 정의 창 — 프로시저·함수·이벤트·트리거를 테이블 정보와 같은 모달로 보여 준다.
       편집기 Ctrl+클릭과 트리의 "정의 보기"가 같은 창을 쓴다. 결과 패널에 그리던 예전 방식과 달리
       실행 결과를 지우지 않는다 — 둘 다 "잠깐 들여다보기"라서 보던 조회 결과가 사라지면 곤란하다.
       모달 클래스를 테이블 정보와 공유해 창이 겹쳐 뜨지 않게 한다. */
    const openObjectInfoModal = async (item) => {
      const kind = String(item && item.type || "");
      if (!sessionId || !DEFINITION_OBJECT_KINDS[kind]) return;
      if (document.querySelector(".db-table-modal")) return;
      const label = schemaObjectLabel(item);
      const modal = el("div", "modal db-table-modal db-object-modal");
      const card = el("div", "modal-card db-table-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-label", item.name + " " + label + " 정보");
      const head = el("div", "db-table-modal-head");
      const headIcon = schemaIcon(kind, "db-table-modal-icon");
      const heading = el("div", "db-table-modal-heading");
      const title = el("h3", null, item.name);
      const subtitle = el("p", "sub", label + " 정의를 읽는 중…");
      heading.append(title, subtitle);
      const closeButton = button("", "db-table-modal-close", "닫기");
      closeButton.setAttribute("aria-label", "닫기");
      closeButton.innerHTML = uiIcon("close");
      head.append(headIcon, heading, closeButton);
      const body = el("div", "db-table-modal-body");
      body.append(el("p", "db-table-modal-loading", label + " 정의를 읽는 중…"));
      card.append(head, body);
      modal.append(card);
      document.body.append(modal);
      if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

      const close = () => {
        window.removeEventListener("keydown", onKey, true);
        modal.remove();
      };
      const onKey = (event) => {
        if (event.key === "Escape" && !document.querySelector(".db-value-modal")){
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      };
      window.addEventListener("keydown", onKey, true);
      closeButton.addEventListener("click", close);
      modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

      try {
        const url = "/db-object?id=" + encodeURIComponent(sessionId)
          + "&kind=" + encodeURIComponent(kind) + "&name=" + encodeURIComponent(item.name)
          + "&database=" + encodeURIComponent(currentDatabase);
        const response = await jsonOf(await fetch(url, { cache:"no-store" }));
        if (!response.ok) throw new Error(messageFor(response.info));
        const ddl = String(response.info.ddl || "");
        const parameters = routineParameters(ddl, kind);
        body.innerHTML = "";
        const hasParameters = kind === "procedure" || kind === "function";
        subtitle.textContent = label + " · " + (currentDatabase || "현재 데이터베이스")
          + (kind === "trigger" && item.table ? " · 테이블 " + item.table : "")
          + (hasParameters ? " · 매개변수 " + parameters.length + "개" : "")
          + (kind === "function" && item.dataType ? " · 반환 " + item.dataType : "");

        const tabs = el("div", "db-table-modal-tabs");
        const overviewTab = button("개요", "db-table-modal-tab active");
        // 이벤트·트리거는 매개변수를 받지 않으므로 탭 자체를 만들지 않는다.
        const paramsTab = hasParameters
          ? button("매개변수 " + parameters.length, "db-table-modal-tab") : null;
        const ddlTab = button("정의", "db-table-modal-tab");
        tabs.append(overviewTab, ...(paramsTab ? [paramsTab] : []), ddlTab);

        const panels = el("div", "db-table-modal-panels");
        const overviewPanel = el("section", "db-table-modal-panel");
        const paramsPanel = paramsTab ? el("section", "db-table-modal-panel") : null;
        const ddlPanel = el("section", "db-table-modal-panel");
        if (paramsPanel) paramsPanel.hidden = true;
        ddlPanel.hidden = true;
        panels.append(overviewPanel, ...(paramsPanel ? [paramsPanel] : []), ddlPanel);

        const pairs = [[overviewTab, overviewPanel],
          ...(paramsTab ? [[paramsTab, paramsPanel]] : []), [ddlTab, ddlPanel]];
        const switchTab = (tab) => pairs.forEach((pair) => {
          pair[0].classList.toggle("active", pair[0] === tab);
          pair[1].hidden = pair[0] !== tab;
        });
        pairs.forEach((pair) => pair[0].addEventListener("click", () => switchTab(pair[0])));

        const facts = el("dl", "db-table-facts");
        const rows = [["종류", label], ["데이터베이스", currentDatabase || "—"]];
        if (kind === "function") rows.push(["반환 자료형", item.dataType || "—"]);
        if (hasParameters) rows.push(["매개변수", String(parameters.length) + "개"]);
        if (kind === "event"){
          const interval = (item.intervalValue ? item.intervalValue + " " + (item.intervalField || "") : "").trim();
          rows.push(["상태", item.status || "—"], ["주기", item.eventType || "—"],
            ["실행 간격", interval || "—"], ["실행 시각", item.executeAt || "—"]);
        }
        if (kind === "trigger"){
          rows.push(["대상 테이블", item.table || "—"], ["시점", item.timing || "—"],
            ["동작", item.event || "—"], ["적용 단위", item.orientation || "—"]);
        }
        // 트리거는 information_schema 에 설명 칸이 없다.
        if (kind !== "trigger") rows.push(["설명", item.comment || "—"]);
        rows.forEach((pair) => facts.append(el("dt", null, pair[0]), el("dd", null, pair[1])));
        overviewPanel.append(facts);

        if (paramsPanel){
          if (!parameters.length){
            paramsPanel.append(el("p", "db-empty", ddl
              ? "매개변수가 없습니다." : "정의문을 읽지 못해 매개변수를 보여 줄 수 없습니다."));
          } else {
            const table = el("table", "db-routine-params");
            const headRow = el("tr", null, null);
            ["이름", "방향", "자료형"].forEach((text) => headRow.append(el("th", null, text)));
            const thead = el("thead", null, null);
            thead.append(headRow);
            const tbody = el("tbody", null, null);
            parameters.forEach((parameter) => {
              const row = el("tr", null, null);
              // 함수 매개변수에는 IN/OUT 구분이 없다. 프로시저에서만 방향을 보여 준다.
              row.append(el("td", "db-routine-param-name", parameter.name),
                el("td", "db-routine-param-dir", kind === "function" ? "—" : parameter.direction),
                el("td", "db-routine-param-type", parameter.type || "—"));
              tbody.append(row);
            });
            table.append(thead, tbody);
            paramsPanel.append(table);
          }
        }

        const ddlTools = el("div", "db-table-ddl-tools");
        const copyButton = button("정의 복사", "db-btn db-btn-quiet");
        copyButton.disabled = !ddl;
        const editScript = button("교체 스크립트 편집", "db-btn db-btn-quiet",
          "현재 객체를 DROP한 뒤 편집한 정의로 다시 만드는 DELIMITER 스크립트를 편집기에 넣습니다");
        editScript.disabled = !ddl || readOnly;
        if (readOnly) editScript.title = "읽기 전용 접속입니다.";
        const ddlActions = el("div", "db-table-constraint-toolbar-actions");
        ddlActions.append(editScript, copyButton);
        ddlTools.append(el("p", null, "서버가 돌려준 현재 CREATE 문입니다."), ddlActions);
        ddlPanel.append(ddlTools, el("pre", "db-table-ddl", ddl || "정의문이 없습니다."));
        copyButton.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(ddl); toast("정의를 복사했어요.", 1800); }
          catch(_){ toast("정의를 복사하지 못했습니다.", 2200); }
        });
        editScript.addEventListener("click", async () => {
          const script = routineEditScript(item, ddl, currentDatabase);
          if (!script) return;
          if (editor.getValue().trim() && typeof confirmDialog === "function"){
            const ok = await confirmDialog(
              "편집기에 쓰던 SQL 이 있습니다.\n" + item.name + " 교체 스크립트로 바꿀까요?"
                + "\n\n현재 편집기 내용은 사라집니다(저장하지 않았다면 되돌릴 수 없습니다).",
              "바꾸기", "취소");
            if (!ok) return;
          }
          close();
          editor.setValue(script);
          const createAt = script.indexOf(ddl.trim());
          editor.ta.setSelectionRange(Math.max(0, createAt), Math.max(0, createAt));
          editor.ta.focus();
          refreshRunLabel();
          toast("DROP+CREATE 교체 스크립트를 넣었습니다. 실행 전에 정의를 확인해 주세요.", 3400);
        });

        body.append(tabs, panels);
        requestAnimationFrame(() => overviewTab.focus());
      } catch(error){
        body.innerHTML = "";
        subtitle.textContent = label;
        notice(body, label + " 정의를 읽지 못했습니다", launcherMessage(error), "error");
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
      if (!await confirmLosingStaged()) return;
      resultStatus.textContent = name + " 를 읽는 중…";
      try {
        const url = "/db-table?id=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(name);
        const response = await jsonOf(await fetch(url, { cache:"no-store" }));
        if (!response.ok){ resultStatus.textContent = messageFor(response.info); clearResult(); return; }
        const info = response.info;
        renderRows(info.displayColumns || [], info.rows || [], info.truncated, info.clippedCells,
          null, { plan:info.edit, reload:() => showTable(name) });
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

    const schemaChangingScript = (sql) => splitStatements(sql).some((statement) =>
      ["create", "alter", "drop", "rename", "truncate"].includes(firstKeyword(statement)));

    const refreshSchemaAfterRun = () => {
      if (!schemaChangingScript(runningSql)) return;
      loadSchema().catch(() => { /* 실행 결과는 이미 표시했다. 스키마 새로고침 실패만으로 덮지 않는다. */ });
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
            refreshSchemaAfterRun();
            return;
          }
          if (!runningQuiet) rememberQuery(runningSql, response.info.ms, true);
          applyTxState(response.info);
          renderStatements(response.info.statements || [], runningLabel, formatMs(response.info.ms));
          const complete = runningComplete; runningComplete = null;
          if (complete) complete(true, response.info);
          refreshSchemaAfterRun();
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
      if (!await confirmLosingStaged()) return false;

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
      const base = target.displaySql || target.sql;
      const sql = firstKeyword(base) === "explain" ? base : "EXPLAIN " + base;
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
      const note = /^\s*DELIMITER\b/im.test(text) ? " · DELIMITER 복합문을 인식했습니다" : "";
      toast(file.name + " 을 불러왔습니다 — 문장 " + statementRanges(text).length + "개" + note, 3600);
    };

    /* SQL 덤프 -------------------------------------------------------------
       창은 별도 모듈(MNDbDump)이 그린다. 여기서는 지금 화면이 알고 있는 것 —
       세션·데이터베이스·트리에 그려진 객체 목록 — 만 넘긴다. 목록을 그대로 넘기므로
       덤프 창이 스키마를 서버에 다시 묻지 않는다. */
    const openDumpModal = (preselect) => {
      if (!sessionId){
        toast("먼저 데이터베이스에 연결해 주세요.", 2600);
        return;
      }
      if (typeof MNDbDump === "undefined"){
        toast("내보내기 창을 불러오지 못했습니다.", 3000);
        return;
      }
      if (!schemaObjects.length){
        toast("내보낼 스키마 객체가 없습니다.", 2600);
        return;
      }
      MNDbDump.open({
        sessionId,
        database: currentDatabase,
        schemaObjects,
        preselect: preselect || [],
        doc
      });
    };

    dumpButton.addEventListener("click", () => openDumpModal([]));

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
        applySidebarCollapsed();
        setSidebarWidth(readSidebarWidth() || SIDEBAR_DEFAULT, false);
        setEditorHeight(readEditorHeight() || EDITOR_DEFAULT, false);
        setEditorWidth(readEditorWidth() || EDITOR_WIDTH_DEFAULT, false);
        applyResultLayout();
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
      // 담아 두기만 하고 적용하지 않은 변경도 연결과 함께 사라진다.
      if (!silent && stagedCount() && typeof confirmDialog === "function"){
        const ok = await confirmDialog("적용하지 않은 변경 " + stagedCount()
          + "건이 있습니다.\n연결을 끊으면 그 변경은 사라집니다. 계속할까요?", "연결 끊기", "취소");
        if (!ok) return;
      }
      stopPolling();
      dropStaged();
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
    doc.cleanupFns.push(() => {
      compactQueryLayout.removeEventListener("change", onCompactQueryLayout);
      resultThemeObserver.disconnect();
      if (typeof unregisterEditorFont === "function"){
        unregisterEditorFont(editor.host);
        unregisterEditorFont(resultHost);
      }
      try { editor.destroy(); } catch(_){}
    });
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

  return { COLORS, COLOR_LABELS, emptyProfile, parseProfile, serializeProfile, encodeStrings,
    statementRanges, splitStatements, statementAt, firstKeyword, compoundExecutionScript, riskyStatements, formatSqlText,
    chooseScriptDelimiter, wrapDelimitedStatement,
    identifierFor, ddlIdentifier, ddlString, routineEditScript, routineParameters, schemaObjectLabel, schemaDropSql, editBlockNote,
    cellUpdatePreview, rowDeletePreview, rowInsertPreview,
    defaultDraft, columnDraft, indexDraft, foreignKeyDraft, tableAlterPlan,
    erdLayout, aliasMap, sqlDefinitionTargetAt, orderBySpot, applyOrderBy, orderByState, messageFor, mount };
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
