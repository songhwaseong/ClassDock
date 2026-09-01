"""ClassDock MySQL 워커 — 접속 하나당 상주 프로세스 하나.

노트북 커널(python_kernel.py)과 같은 규약을 쓴다. stdin 으로 base64(JSON) 한 줄을 받고
stdout 으로 base64(JSON) 한 줄을 돌려준다. 프로세스가 살아 있는 동안 커넥션을 물고 있어
트랜잭션·임시 테이블·세션 변수가 요청 사이에 유지된다.

응답 규약이 하나 다르다. cancel 은 응답을 내지 않는다(fire and forget).
실행 중인 쿼리는 stdin 을 읽지 못하므로 취소는 리더 스레드가 즉시 처리해야 하는데,
여기서 응답까지 내보내면 실행 중인 쿼리의 응답과 순서가 뒤섞인다. 취소 결과는
취소당한 쿼리 자신의 응답(cancelled)으로 드러나므로 별도 응답이 필요 없다.

비밀번호는 첫 connect 요청의 stdin 으로만 들어온다. 명령행·환경변수에 실리지 않는다.
"""

import base64
import json
import queue
import sys
import threading
import time
import traceback

MAX_ROWS = 1000            # 결과 한 집합의 최대 행
MAX_CELLS = 12000          # 한 요청이 만들어 낼 수 있는 전체 셀 수(SQLite 미리보기와 같은 예산)
MAX_CELL_CHARS = 500       # 셀 하나의 최대 글자 수
MAX_TABLES = 2000          # 스키마 트리에 싣는 최대 테이블 수
PREVIEW_ROWS = 200         # 테이블 미리보기 행 수
MAX_CLIPPED_MARKS = 2000   # "이 셀은 잘렸다" 좌표 목록의 상한
KEEP_ROWS = 5000           # "더 보기"용으로 워커가 들고 있을 최대 행
KEEP_CELLS = 100000        # 같은 목적의 셀 상한(넓은 표에서 행 수보다 먼저 걸린다)
KEEP_PAGE = 1000           # "더 보기" 한 번에 더 내려보내는 행
MAX_KEPT_SETS = 4          # 동시에 들고 있을 결과 집합 수
MAX_SCHEMA_COLUMNS = 5000  # 자동완성에 싣는 최대 컬럼 수
MAX_SCHEMA_OBJECTS = 2000  # 프로시저·함수·이벤트 등 스키마 객체별 상한
MAX_SCHEMA_RELATIONS = 5000  # ERD 외래키 관계 상한

# 읽기 전용 접속에서 미리 막아 친절한 메시지를 주는 낱말. 최종 판단은 서버의 READ ONLY 트랜잭션이 한다.
WRITE_KEYWORDS = ("insert", "update", "delete", "replace", "truncate", "drop", "create", "alter",
                  "rename", "grant", "revoke", "load", "lock", "unlock", "set", "flush", "reset", "import")
# 수동 커밋 모드에서 "아직 커밋하지 않은 변경"으로 세는 낱말. CALL 은 안에서 무엇을 하는지 알 수 없어
# 함께 센다(경고를 덜 내는 쪽보다 더 내는 쪽이 안전하다).
DATA_CHANGE_KEYWORDS = ("insert", "update", "delete", "replace", "call")
# MySQL 이 실행하는 순간 트랜잭션을 확정해 버리는 낱말(암묵적 커밋). 이 문장 뒤에는 롤백으로
# 되돌릴 것이 남지 않으므로 "커밋하지 않은 변경" 표시도 함께 지운다.
IMPLICIT_COMMIT_KEYWORDS = ("create", "alter", "drop", "rename", "truncate", "grant", "revoke",
                            "flush", "reset", "lock", "unlock", "analyze", "check", "optimize",
                            "repair", "install", "uninstall", "begin", "start")

_stdout_lock = threading.Lock()
_state = {"connection": None, "credentials": None, "read_only": True, "connection_id": None, "pages": {},
          "auto_commit": True, "pending": False}


def write_response(payload):
    """응답 한 줄 = 상태 문자('+' 성공 / '-' 실패) + base64(JSON).

    런처(C#)에는 JSON 파서가 없다. 상태를 첫 글자로 못박아 두면 런처가 본문을 열어 보지 않고
    성공 여부만 판단해 그대로 브라우저에 넘길 수 있다.
    """
    encoded = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    with _stdout_lock:
        sys.__stdout__.write(("+" if payload.get("ok") else "-") + encoded + "\n")
        sys.__stdout__.flush()


def import_driver():
    try:
        import pymysql
        return pymysql
    except ImportError:
        return None


def cell(value):
    """표에 실을 수 있는 형태로 값을 줄인다. (표시할 값, 잘렸는지) 를 함께 돌려준다.

    잘렸는지를 따로 알려 주는 이유는 화면이 거짓말을 하지 않게 하기 위해서다.
    값 보기 패널이 '이게 전부'인지 '서버에서 잘라 온 것'인지 구분해 말할 수 있어야 한다.
    """
    if value is None:
        return None, False
    if isinstance(value, bool):
        return ("1" if value else "0"), False
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "<BLOB %d bytes>" % len(bytes(value)), False
    text = str(value)
    if len(text) <= MAX_CELL_CHARS:
        return text, False
    return text[:MAX_CELL_CHARS] + "…", True


def elapsed_ms(started):
    """서버에서 실제로 걸린 시간. 프런트가 재면 폴링 간격(300ms)이 섞여 빠른 쿼리가 느리게 보인다."""
    return int(round((time.perf_counter() - started) * 1000))


def quote_identifier(name):
    return "`" + str(name).replace("`", "``") + "`"


def split_statements(sql):
    """세미콜론으로 문장을 나눈다. 따옴표·역따옴표·주석 안의 세미콜론은 구분자가 아니다.

    주석은 건너뛰되 버리지 않고 그대로 남긴다. MySQL 의 버전 주석(/*!40101 ... */)은
    실제로 실행되는 구문이라 지워 버리면 붙여넣은 덤프의 의미가 바뀐다.
    """
    statements = []
    buf = []
    index = 0
    length = len(sql)
    while index < length:
        char = sql[index]
        if char in ("'", '"', "`"):
            quote = char
            buf.append(char)
            index += 1
            while index < length:
                current = sql[index]
                if current == "\\" and quote != "`":
                    buf.append(current)
                    if index + 1 < length:
                        buf.append(sql[index + 1])
                        index += 2
                    else:
                        index += 1
                    continue
                if current == quote:
                    if index + 1 < length and sql[index + 1] == quote:   # '' 나 "" 로 쓴 이스케이프
                        buf.append(current)
                        buf.append(current)
                        index += 2
                        continue
                    buf.append(current)
                    index += 1
                    break
                buf.append(current)
                index += 1
            continue
        if char == "-" and sql.startswith("--", index) and (index + 2 >= length or sql[index + 2] in " \t\r\n"):
            while index < length and sql[index] != "\n":
                buf.append(sql[index])
                index += 1
            continue
        if char == "#":
            while index < length and sql[index] != "\n":
                buf.append(sql[index])
                index += 1
            continue
        if char == "/" and sql.startswith("/*", index):
            end = sql.find("*/", index + 2)
            end = length if end < 0 else end + 2
            buf.append(sql[index:end])
            index = end
            continue
        if char == ";":
            statements.append("".join(buf))
            buf = []
            index += 1
            continue
        buf.append(char)
        index += 1
    statements.append("".join(buf))
    return [item.strip() for item in statements if item.strip()]


def first_keyword(statement):
    """문장의 첫 낱말. 앞에 붙은 주석과 괄호는 건너뛴다."""
    index = 0
    length = len(statement)
    while index < length:
        char = statement[index]
        if char.isspace() or char == "(":
            index += 1
            continue
        if statement.startswith("--", index) or char == "#":
            newline = statement.find("\n", index)
            if newline < 0:
                return ""
            index = newline + 1
            continue
        if statement.startswith("/*", index):
            end = statement.find("*/", index + 2)
            if end < 0:
                return ""
            index = end + 2
            continue
        break
    word = []
    while index < length and (statement[index].isalpha() or statement[index] == "_"):
        word.append(statement[index])
        index += 1
    return "".join(word).lower()


def classify_error(exc, driver):
    """드라이버 예외를 화면에서 구분할 수 있는 코드로 옮긴다.

    예외 문자열을 그대로 흘리지 않는다. 드라이버가 접속 정보를 메시지에 섞어 내는 경우가 있어
    런처가 다듬은 메시지만 프런트로 넘기게 한다.
    """
    errno = None
    detail = ""
    args = getattr(exc, "args", ()) or ()
    if args and isinstance(args[0], int):
        errno = args[0]
    if len(args) > 1 and isinstance(args[1], str):
        detail = args[1]
    elif args and isinstance(args[0], str):
        detail = args[0]
    if not detail:
        detail = str(exc)

    if isinstance(exc, (TimeoutError,)):
        return "timeout", detail, errno
    if isinstance(exc, ConnectionRefusedError):
        return "refused", detail, errno
    if isinstance(exc, OSError) and getattr(exc, "errno", None) == 11001:
        return "unknown-host", detail, errno

    lowered = detail.lower()
    # MySQL 8 의 caching_sha2_password 는 TLS 가 아닌 연결에서 RSA 키 교환에 cryptography 를 쓴다.
    # 이 패키지가 없으면 계정·비밀번호가 맞아도 붙지 못하므로 "설치하면 된다"고 알려 줄 수 있어야 한다.
    if "cryptography is required" in lowered or "cryptography package is required" in lowered:
        return "auth-crypto", detail, errno
    # 이름 해석 실패는 errno 매핑보다 먼저 본다. pymysql 은 DNS 실패도 2003(연결 실패)으로 감싸는데,
    # 그대로 "연결 거부"라고 하면 주소가 틀린 사용자에게 포트와 서버 상태를 확인하라고 하게 된다.
    if ("getaddrinfo" in lowered or "11001" in lowered or "name or service not known" in lowered
            or "nodename nor servname" in lowered or "unknown server host" in lowered):
        return "unknown-host", detail, errno

    mapping = {
        1044: "denied",
        1045: "auth-failed",
        1049: "unknown-database",
        1142: "denied",
        1143: "denied",
        1317: "cancelled",
        1792: "read-only",
        2002: "refused",
        2003: "refused",
        2005: "unknown-host",
        2006: "connection-lost",
        2013: "connection-lost",
        # 2059 = 서버가 요구한 인증 플러그인을 드라이버가 못 쓴다(Windows GSSAPI, unix_socket 등).
        # 비밀번호 문제가 아니라 계정의 인증 방식 문제라 안내가 달라야 한다.
        2059: "auth-plugin",
    }
    if errno in mapping:
        return mapping[errno], detail, errno
    if "timed out" in lowered or "timeout" in lowered:
        return "timeout", detail, errno
    if "interrupted" in lowered:
        return "cancelled", detail, errno
    return "sql-error", detail, errno


def error_payload(exc, driver, action=""):
    code, detail, errno = classify_error(exc, driver)
    payload = {"ok": False, "code": code, "detail": detail}
    if errno is not None:
        payload["errno"] = errno
    if action:
        payload["action"] = action
    return payload


def connect(request):
    driver = import_driver()
    if driver is None:
        return {"ok": False, "code": "driver-missing", "detail": "pymysql 이 설치되어 있지 않습니다."}
    credentials = {
        "host": str(request.get("host") or "127.0.0.1"),
        "port": int(request.get("port") or 3306),
        "user": str(request.get("user") or ""),
        "password": str(request.get("password") or ""),
        "database": str(request.get("database") or "") or None,
    }
    read_only = bool(request.get("readOnly", True))
    # 자동 커밋을 끄면 쓰기 문장이 트랜잭션에 쌓이고 commit/rollback 으로만 확정된다.
    # 읽기 전용 접속은 쓸 것이 없으므로 언제나 자동 커밋으로 둔다.
    auto_commit = True if read_only else bool(request.get("autoCommit", True))
    try:
        connection = driver.connect(
            host=credentials["host"], port=credentials["port"], user=credentials["user"],
            password=credentials["password"], database=credentials["database"],
            charset="utf8mb4", connect_timeout=int(request.get("connectTimeout") or 15),
            autocommit=auto_commit,
        )
    except Exception as exc:                                  # noqa: BLE001 - 드라이버 예외 전부를 코드로 옮긴다
        return error_payload(exc, driver, "connect")

    info = {}
    try:
        with connection.cursor() as cursor:
            # 읽기 전용은 안내 문구가 아니라 서버가 건다. autocommit 이라도 각 문장이
            # 세션 기본 접근 모드를 물려받아 쓰기는 1792 로 거절된다.
            if read_only:
                cursor.execute("SET SESSION TRANSACTION READ ONLY")
            cursor.execute("SELECT CONNECTION_ID(), VERSION(), DATABASE()")
            row = cursor.fetchone() or (None, "", None)
            _state["connection_id"] = row[0]
            info = {"connectionId": row[0], "serverVersion": str(row[1] or ""), "database": row[2] or ""}
    except Exception as exc:                                  # noqa: BLE001
        try:
            connection.close()
        except Exception:                                     # noqa: BLE001
            pass
        return error_payload(exc, driver, "connect")

    _state["connection"] = connection
    _state["credentials"] = credentials
    _state["read_only"] = read_only
    _state["auto_commit"] = auto_commit
    _state["pending"] = False
    return {"ok": True, "readOnly": read_only, "autoCommit": auto_commit, "pending": False, **info}


def require_connection():
    connection = _state.get("connection")
    if connection is None:
        raise RuntimeError("not-connected")
    return connection


def read_rows(cursor, max_rows, max_cells):
    """커서에서 상한까지 읽는다.

    돌려주는 값: (컬럼, 행, 그 뒤로도 남았는지, 잘린 셀 좌표)
    잘린 셀 좌표는 [행, 열] 목록이다. 자르는 일은 드물어서 보통 빈 목록이고,
    이상하게 많으면 상한에서 멈춘다(목록 자체가 응답을 부풀리지 않게).
    """
    columns = [str(item[0]) for item in (cursor.description or [])]
    width = max(1, len(columns))
    limit = max(0, min(max_rows, max_cells // width))
    rows = []
    clipped = []
    while len(rows) < limit:
        row = cursor.fetchone()
        if row is None:
            break
        line = []
        for column_index, value in enumerate(row):
            text, was_clipped = cell(value)
            line.append(text)
            if was_clipped and len(clipped) < MAX_CLIPPED_MARKS:
                clipped.append([len(rows), column_index])
        rows.append(line)
    more = len(rows) >= limit and cursor.fetchone() is not None
    return columns, rows, more, clipped


def slice_page(kept, offset, limit):
    """보관해 둔 결과에서 한 페이지를 떼어 낸다. 잘린 셀 좌표도 그 페이지 기준으로 옮긴다."""
    rows = kept["rows"][offset:offset + limit]
    clipped = [[pair[0] - offset, pair[1]] for pair in kept["clipped"]
               if offset <= pair[0] < offset + len(rows)]
    return {
        "ok": True, "columns": kept["columns"], "rows": rows, "clippedCells": clipped,
        "offset": offset, "total": len(kept["rows"]),
        # hasMore = 보관분에 더 떼어 줄 행이 남았는가. 여기에 서버 사정을 섞으면
        # 보관분을 다 읽은 뒤에도 켜져 있어 아무것도 오지 않는 "더 보기"가 계속 붙는다.
        "hasMore": offset + len(rows) < len(kept["rows"]),
        # serverHasMore = 보관 상한을 넘겨 서버에 더 남아 있었는가(안내 문구용).
        "serverHasMore": kept["more"],
    }


def run_statements(sql, driver):
    connection = require_connection()
    statements = split_statements(sql)
    if not statements:
        return {"ok": True, "statements": [], "ms": 0, **tx_state()}
    if _state["read_only"]:
        for statement in statements:
            keyword = first_keyword(statement)
            if keyword in WRITE_KEYWORDS:
                return {"ok": False, "code": "read-only-blocked", "detail": keyword.upper()}

    _state["pages"] = {}
    results = []
    budget = MAX_CELLS
    for statement in statements:
        keyword = first_keyword(statement)
        # 문장이 잘려 왔으면 프런트가 ORDER BY 를 고쳐 쓸 수 없다(헤더 정렬을 끈다).
        entry = {"sql": statement[:4000], "keyword": keyword, "sqlTruncated": len(statement) > 4000}
        started = time.perf_counter()
        try:
            with connection.cursor() as cursor:
                affected = cursor.execute(statement)
                if cursor.description:
                    # 한 번에 보내는 양(첫 페이지)과 "더 보기"용으로 들고 있을 양을 따로 둔다.
                    columns, kept_rows, more, clipped = read_rows(cursor, KEEP_ROWS, KEEP_CELLS)
                    width = max(1, len(columns))
                    send = max(0, min(MAX_ROWS, budget // width, len(kept_rows)))
                    budget = max(0, budget - send * width)
                    if len(kept_rows) > send or more:
                        if len(_state["pages"]) < MAX_KEPT_SETS:
                            _state["pages"][len(results)] = {
                                "columns": columns, "rows": kept_rows, "clipped": clipped, "more": more}
                    page = slice_page({"columns": columns, "rows": kept_rows, "clipped": clipped, "more": more}, 0, send)
                    entry.update({"kind": "rows", "columns": columns, "rows": page["rows"],
                                  "truncated": page["hasMore"], "clippedCells": page["clippedCells"],
                                  "loaded": len(kept_rows), "hasMore": page["hasMore"],
                                  "serverHasMore": more, "set": len(results)})
                    # 앞의 결과가 예산을 다 써서 한 줄도 싣지 못한 경우를 "데이터가 없다"와 구분한다.
                    if not page["rows"] and len(kept_rows):
                        entry["budgetExhausted"] = True
                else:
                    entry.update({"kind": "affected", "affected": int(affected or 0),
                                  "insertId": int(getattr(cursor, "lastrowid", 0) or 0)})
                warnings = getattr(cursor, "_warnings", None)
                if warnings:
                    entry["warnings"] = int(warnings)
        except Exception as exc:                              # noqa: BLE001 - 드라이버 예외 전부를 코드로 옮긴다
            # 여기까지의 문장은 이미 서버에서 실행됐다(자동 커밋이면 확정된 상태다).
            # 실패했다고 앞의 결과까지 버리면 무엇이 반영되고 무엇이 안 됐는지 알 길이 없어진다.
            failure = error_payload(exc, driver, "query")
            entry.update({"kind": "error", "ms": elapsed_ms(started),
                          "code": str(failure.get("code") or ""),
                          "detail": str(failure.get("detail") or "")})
            results.append(entry)
            failure["statements"] = results
            failure["failedAt"] = len(results) - 1
            failure["ms"] = sum(item.get("ms", 0) for item in results)
            failure.update(tx_state())
            return failure
        # 수동 커밋 모드에서만 "커밋하지 않은 변경"을 센다. 암묵적 커밋 문장은 그 표시를 지운다.
        if not _state["auto_commit"]:
            if keyword in IMPLICIT_COMMIT_KEYWORDS:
                _state["pending"] = False
            elif keyword in DATA_CHANGE_KEYWORDS:
                _state["pending"] = True
        entry["ms"] = elapsed_ms(started)
        results.append(entry)
    return {"ok": True, "statements": results, "ms": sum(item.get("ms", 0) for item in results),
            **tx_state()}


def load_schema():
    connection = require_connection()
    payload = {"ok": True, "databases": [], "tables": [], "routines": [], "events": [], "current": ""}
    with connection.cursor() as cursor:
        cursor.execute("SELECT DATABASE()")
        row = cursor.fetchone()
        payload["current"] = (row[0] if row else "") or ""
        cursor.execute(
            "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA "
            "WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys') "
            "ORDER BY SCHEMA_NAME"
        )
        payload["databases"] = [str(item[0]) for item in cursor.fetchall()]
        if payload["current"]:
            cursor.execute(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = %s ORDER BY TABLE_TYPE, TABLE_NAME LIMIT %s",
                (payload["current"], MAX_TABLES),
            )
            payload["tables"] = [{
                "name": str(item[0]),
                "type": "view" if str(item[1] or "").upper().endswith("VIEW") else "table",
                # information_schema 의 TABLE_ROWS 는 InnoDB 에서 추정값이다. 정확한 수는 사용자가 따로 센다.
                "estimatedRows": None if item[2] is None else int(item[2]),
                "comment": str(item[3] or "")[:200],
            } for item in cursor.fetchall()]
            cursor.execute(
                "SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE, ROUTINE_COMMENT "
                "FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = %s "
                "ORDER BY ROUTINE_TYPE, ROUTINE_NAME LIMIT %s",
                (payload["current"], MAX_SCHEMA_OBJECTS),
            )
            payload["routines"] = [{
                "name": str(item[0]),
                "type": "function" if str(item[1] or "").upper() == "FUNCTION" else "procedure",
                "dataType": str(item[2] or ""),
                "comment": str(item[3] or "")[:200],
            } for item in cursor.fetchall()]
            cursor.execute(
                "SELECT EVENT_NAME, STATUS, EVENT_TYPE, EXECUTE_AT, INTERVAL_VALUE, INTERVAL_FIELD, EVENT_COMMENT "
                "FROM information_schema.EVENTS WHERE EVENT_SCHEMA = %s ORDER BY EVENT_NAME LIMIT %s",
                (payload["current"], MAX_SCHEMA_OBJECTS),
            )
            payload["events"] = [{
                "name": str(item[0]), "type": "event", "status": str(item[1] or ""),
                "eventType": str(item[2] or ""), "executeAt": str(item[3] or ""),
                "intervalValue": str(item[4] or ""), "intervalField": str(item[5] or ""),
                "comment": str(item[6] or "")[:200],
            } for item in cursor.fetchall()]
    return payload


def current_schema(cursor, database=""):
    if database:
        return database
    cursor.execute("SELECT DATABASE()")
    row = cursor.fetchone()
    return (row[0] if row else "") or ""


def column_definitions(cursor, name, schema):
    cursor.execute(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, "
        "CHARACTER_SET_NAME, COLLATION_NAME, GENERATION_EXPRESSION "
        "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION",
        (schema, name),
    )
    return [{
        "name": str(item[0]), "type": str(item[1] or ""), "nullable": str(item[2] or "").upper() == "YES",
        "key": str(item[3] or ""), "default": None if item[4] is None else str(item[4]),
        "extra": str(item[5] or ""), "comment": str(item[6] or ""),
        "characterSet": str(item[7] or ""), "collation": str(item[8] or ""),
        "generationExpression": str(item[9] or ""),
    } for item in cursor.fetchall()]


def index_definitions(cursor, name, schema):
    cursor.execute(
        "SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, COLLATION "
        "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s "
        "ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        (schema, name),
    )
    found = {}
    for item in cursor.fetchall():
        index_name = str(item[0] or "")
        entry = found.setdefault(index_name, {
            "name": index_name, "unique": not bool(item[1]),
            "type": str(item[2] or "BTREE").upper(), "columns": [],
        })
        entry["columns"].append({
            "name": str(item[4] or ""),
            "prefix": None if item[5] is None else int(item[5]),
            "order": "DESC" if str(item[6] or "").upper() == "D" else "ASC",
            "unsupported": item[4] is None,
        })
    return list(found.values())


def foreign_key_definitions(cursor, name, schema):
    cursor.execute(
        "SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, "
        "k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.ORDINAL_POSITION, "
        "r.UPDATE_RULE, r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k "
        "JOIN information_schema.REFERENTIAL_CONSTRAINTS r "
        "ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME "
        "AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME "
        "WHERE k.CONSTRAINT_SCHEMA = %s AND k.TABLE_NAME = %s "
        "AND k.REFERENCED_TABLE_NAME IS NOT NULL "
        "ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
        (schema, name),
    )
    found = {}
    for item in cursor.fetchall():
        constraint_name = str(item[0] or "")
        entry = found.setdefault(constraint_name, {
            "name": constraint_name, "referencedDatabase": str(item[2] or schema),
            "referencedTable": str(item[3] or ""),
            "updateRule": str(item[6] or "RESTRICT").upper(),
            "deleteRule": str(item[7] or "RESTRICT").upper(), "columns": [],
        })
        entry["columns"].append({"local": str(item[1] or ""), "referenced": str(item[4] or "")})
    return list(found.values())


def trigger_definitions(cursor, name, schema):
    cursor.execute(
        "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORIENTATION "
        "FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = %s AND EVENT_OBJECT_TABLE = %s "
        "ORDER BY ACTION_TIMING, EVENT_MANIPULATION, TRIGGER_NAME",
        (schema, name),
    )
    return [{
        "name": str(item[0]), "type": "trigger", "table": name,
        "timing": str(item[1] or ""), "event": str(item[2] or ""), "orientation": str(item[3] or ""),
    } for item in cursor.fetchall()]


def load_columns(name, database=""):
    """컬럼 정의만. 트리를 펼칠 때 미리보기 200행까지 함께 가져올 이유가 없다."""
    connection = require_connection()
    with connection.cursor() as cursor:
        columns = column_definitions(cursor, name, current_schema(cursor, database))
    return {"ok": True, "name": name, "columns": columns}


def load_table_children(name, database=""):
    """왼쪽 트리용 테이블 하위 객체. 데이터 행과 테이블 통계는 읽지 않는다."""
    connection = require_connection()
    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)
        columns = column_definitions(cursor, name, schema)
        indexes = index_definitions(cursor, name, schema)
        foreign_keys = foreign_key_definitions(cursor, name, schema)
        triggers = trigger_definitions(cursor, name, schema)
    return {"ok": True, "name": name, "columns": columns, "indexes": indexes,
            "foreignKeys": foreign_keys, "triggers": triggers}


def schema_columns(database=""):
    """현재 데이터베이스의 모든 컬럼 이름. 편집기 자동완성이 쓴다.

    테이블마다 따로 물으면 자동완성이 느려지고, 아직 펼쳐 보지 않은 테이블은 후보에 들어오지도 못한다.
    """
    connection = require_connection()
    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)
        if not schema:
            return {"ok": True, "columns": [], "truncated": False}
        cursor.execute(
            "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT %s",
            (schema, MAX_SCHEMA_COLUMNS + 1),
        )
        found = cursor.fetchall()
    more = len(found) > MAX_SCHEMA_COLUMNS
    return {
        "ok": True, "truncated": more,
        "columns": [{"table": str(item[0]), "name": str(item[1]), "type": str(item[2] or "")}
                    for item in found[:MAX_SCHEMA_COLUMNS]],
    }


def load_erd(database=""):
    """현재 데이터베이스의 ERD용 테이블·컬럼·외래키를 일괄 조회한다."""
    connection = require_connection()
    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)
        if not schema:
            return {"ok": True, "database": "", "tables": [], "relationships": [], "truncated": False}
        cursor.execute(
            "SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME LIMIT %s",
            (schema, MAX_TABLES + 1),
        )
        table_rows = cursor.fetchall()
        table_more = len(table_rows) > MAX_TABLES
        tables = {str(item[0]): {"name": str(item[0]), "comment": str(item[1] or "")[:200], "columns": []}
                  for item in table_rows[:MAX_TABLES]}
        cursor.execute(
            "SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_KEY, c.COLUMN_COMMENT "
            "FROM information_schema.COLUMNS c JOIN information_schema.TABLES t "
            "ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME "
            "WHERE c.TABLE_SCHEMA = %s AND t.TABLE_TYPE = 'BASE TABLE' "
            "ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION LIMIT %s",
            (schema, MAX_SCHEMA_COLUMNS + 1),
        )
        column_rows = cursor.fetchall()
        column_more = len(column_rows) > MAX_SCHEMA_COLUMNS
        for item in column_rows[:MAX_SCHEMA_COLUMNS]:
            table = tables.get(str(item[0]))
            if table is not None:
                table["columns"].append({
                    "name": str(item[1]), "type": str(item[2] or ""),
                    "nullable": str(item[3] or "").upper() == "YES",
                    "key": str(item[4] or ""), "comment": str(item[5] or "")[:200],
                })
        cursor.execute(
            "SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, "
            "k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.ORDINAL_POSITION, "
            "r.UPDATE_RULE, r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k "
            "JOIN information_schema.REFERENTIAL_CONSTRAINTS r "
            "ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME "
            "AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME "
            "WHERE k.CONSTRAINT_SCHEMA = %s AND k.REFERENCED_TABLE_NAME IS NOT NULL "
            "ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION LIMIT %s",
            (schema, MAX_SCHEMA_RELATIONS + 1),
        )
        relation_rows = cursor.fetchall()
        relation_more = len(relation_rows) > MAX_SCHEMA_RELATIONS
        relation_map = {}
        for item in relation_rows[:MAX_SCHEMA_RELATIONS]:
            relation_key = (str(item[1]), str(item[0]))
            entry = relation_map.setdefault(relation_key, {
                "name": str(item[0]), "sourceTable": str(item[1]),
                "targetDatabase": str(item[3] or schema), "targetTable": str(item[4] or ""),
                "updateRule": str(item[7] or "RESTRICT").upper(),
                "deleteRule": str(item[8] or "RESTRICT").upper(), "columns": [],
            })
            entry["columns"].append({"source": str(item[2] or ""), "target": str(item[5] or "")})
    return {
        "ok": True, "database": schema, "tables": list(tables.values()),
        "relationships": list(relation_map.values()),
        "truncated": table_more or column_more or relation_more,
        "truncatedTables": table_more, "truncatedColumns": column_more, "truncatedRelationships": relation_more,
    }


def read_page(index, offset, limit):
    kept = (_state.get("pages") or {}).get(index)
    if kept is None:
        return {"ok": False, "code": "page-gone", "detail": "결과를 더 가지고 있지 않습니다."}
    return slice_page(kept, max(0, offset), max(1, min(KEEP_PAGE, limit)))


def load_ddl(name, database=""):
    """SHOW CREATE TABLE — 뷰에도 그대로 쓸 수 있다(CREATE VIEW 문을 돌려준다)."""
    connection = require_connection()
    target = quote_identifier(name)
    if database:
        target = quote_identifier(database) + "." + target
    with connection.cursor() as cursor:
        cursor.execute("SHOW CREATE TABLE " + target)
        row = cursor.fetchone()
    return {"ok": True, "name": name, "ddl": str(row[1]) if row and len(row) > 1 else ""}


def load_object_ddl(kind, name, database=""):
    """프로시저·함수·이벤트·트리거의 SHOW CREATE 결과를 열 이름으로 찾는다."""
    normalized = str(kind or "").lower()
    keywords = {"procedure": "PROCEDURE", "function": "FUNCTION", "event": "EVENT", "trigger": "TRIGGER"}
    preferred = {
        "procedure": "create procedure", "function": "create function",
        "event": "create event", "trigger": "sql original statement",
    }
    if normalized not in keywords:
        return {"ok": False, "code": "unknown-object-kind", "detail": normalized}
    connection = require_connection()
    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)
        target = quote_identifier(schema) + "." + quote_identifier(name)
        cursor.execute("SHOW CREATE " + keywords[normalized] + " " + target)
        row = cursor.fetchone()
        labels = [str(item[0] or "").strip().lower() for item in (cursor.description or [])]
    ddl = ""
    wanted = preferred[normalized]
    if row and wanted in labels:
        ddl = str(row[labels.index(wanted)] or "")
    elif row:
        ddl = next((str(value) for value in row if isinstance(value, str)
                    and value.lstrip().upper().startswith("CREATE ")), "")
    return {"ok": True, "database": schema, "kind": normalized, "name": name, "ddl": ddl}


def load_table_info(name, database=""):
    """테이블 구조 편집창용 메타데이터. 미리보기 행은 읽지 않는다."""
    connection = require_connection()
    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)
        cursor.execute(
            "SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, TABLE_ROWS, TABLE_COMMENT, "
            "CREATE_TIME, UPDATE_TIME FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
            (schema, name),
        )
        row = cursor.fetchone()
        if not row:
            return {"ok": False, "code": "unknown-table", "detail": name}
        columns = column_definitions(cursor, name, schema)
        indexes = index_definitions(cursor, name, schema)
        foreign_keys = foreign_key_definitions(cursor, name, schema)
    return {
        "ok": True,
        "database": schema,
        "name": str(row[0]),
        "type": "view" if str(row[1] or "").upper().endswith("VIEW") else "table",
        "engine": str(row[2] or ""),
        "collation": str(row[3] or ""),
        "estimatedRows": None if row[4] is None else int(row[4]),
        "comment": str(row[5] or ""),
        "created": str(row[6] or ""),
        "updated": str(row[7] or ""),
        "columns": columns,
        "indexes": indexes,
        "foreignKeys": foreign_keys,
    }


def load_table(name, database=""):
    connection = require_connection()
    target = quote_identifier(name)
    if database:
        target = quote_identifier(database) + "." + target
    payload = {"ok": True, "name": name, "columns": [], "rows": [], "displayColumns": [], "truncated": False}
    with connection.cursor() as cursor:
        payload["columns"] = column_definitions(cursor, name, current_schema(cursor, database))
        started = time.perf_counter()
        cursor.execute("SELECT * FROM " + target + " LIMIT %s", (PREVIEW_ROWS,))
        columns, rows, more, clipped = read_rows(cursor, PREVIEW_ROWS, MAX_CELLS)
        payload.update({"displayColumns": columns, "rows": rows, "truncated": more, "clippedCells": clipped,
                        "ms": elapsed_ms(started)})
    return payload


def count_table(name, database=""):
    connection = require_connection()
    target = quote_identifier(name)
    if database:
        target = quote_identifier(database) + "." + target
    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM " + target)
        row = cursor.fetchone()
    return {"ok": True, "name": name, "rowCount": int(row[0]) if row else 0}


def tx_state():
    """프런트가 커밋·롤백 버튼과 미커밋 배지를 그리는 데 쓰는 상태."""
    return {"autoCommit": bool(_state["auto_commit"]), "pending": bool(_state["pending"])}


def set_auto_commit(request):
    connection = require_connection()
    wanted = bool(request.get("on", True))
    if _state["read_only"] and not wanted:
        return {"ok": False, "code": "read-only", "detail": "읽기 전용 접속입니다.", **tx_state()}
    if wanted == _state["auto_commit"]:
        return {"ok": True, **tx_state()}
    # 자동 커밋을 켜는 순간 서버는 열려 있던 트랜잭션을 확정한다. 사용자가 모르는 사이에
    # 커밋되지 않도록, 남은 변경이 있으면 먼저 커밋·롤백을 고르게 한다.
    if wanted and _state["pending"]:
        return {"ok": False, "code": "tx-pending",
                "detail": "커밋하지 않은 변경이 있습니다.", **tx_state()}
    connection.autocommit(wanted)
    _state["auto_commit"] = wanted
    if wanted:
        _state["pending"] = False
    return {"ok": True, **tx_state()}


def finish_transaction(commit):
    connection = require_connection()
    if _state["auto_commit"]:
        return {"ok": False, "code": "tx-auto-commit",
                "detail": "자동 커밋 상태입니다.", **tx_state()}
    started = time.perf_counter()
    if commit:
        connection.commit()
    else:
        connection.rollback()
    _state["pending"] = False
    _state["pages"] = {}
    return {"ok": True, "committed": bool(commit), "ms": elapsed_ms(started), **tx_state()}


def use_database(name):
    connection = require_connection()
    with connection.cursor() as cursor:
        cursor.execute("USE " + quote_identifier(name))
    credentials = _state.get("credentials") or {}
    credentials["database"] = name
    return {"ok": True, "database": name}


def cancel_running_query():
    """실행 중인 쿼리를 끊는다. 그 커넥션은 응답을 기다리는 중이라 명령을 받을 수 없으므로
    같은 자격으로 새 커넥션을 열어 KILL QUERY 를 보낸다."""
    driver = import_driver()
    credentials = _state.get("credentials")
    connection_id = _state.get("connection_id")
    if driver is None or not credentials or not connection_id:
        return
    try:
        killer = driver.connect(
            host=credentials["host"], port=credentials["port"], user=credentials["user"],
            password=credentials["password"], charset="utf8mb4", connect_timeout=10, autocommit=True,
        )
    except Exception:                                         # noqa: BLE001 - 취소는 실패해도 조용히 넘어간다
        return
    try:
        with killer.cursor() as cursor:
            cursor.execute("KILL QUERY %s" % int(connection_id))
    except Exception:                                         # noqa: BLE001
        pass
    finally:
        try:
            killer.close()
        except Exception:                                     # noqa: BLE001
            pass


def handle(request):
    action = str(request.get("action") or "")
    driver = import_driver()
    try:
        if action == "connect":
            return connect(request)
        if action == "schema":
            return load_schema()
        if action == "table":
            return load_table(str(request.get("name") or ""), str(request.get("database") or ""))
        if action == "count":
            return count_table(str(request.get("name") or ""), str(request.get("database") or ""))
        if action == "columns":
            return load_columns(str(request.get("name") or ""), str(request.get("database") or ""))
        if action == "children":
            return load_table_children(str(request.get("name") or ""), str(request.get("database") or ""))
        if action == "ddl":
            return load_ddl(str(request.get("name") or ""), str(request.get("database") or ""))
        if action == "info":
            return load_table_info(str(request.get("name") or ""), str(request.get("database") or ""))
        if action == "object-ddl":
            return load_object_ddl(str(request.get("kind") or ""), str(request.get("name") or ""),
                                   str(request.get("database") or ""))
        if action == "schema-columns":
            return schema_columns(str(request.get("database") or ""))
        if action == "erd":
            return load_erd(str(request.get("database") or ""))
        if action == "page":
            return read_page(int(request.get("set") or 0), int(request.get("offset") or 0),
                             int(request.get("limit") or KEEP_PAGE))
        if action == "use":
            return use_database(str(request.get("name") or ""))
        if action == "query":
            return run_statements(str(request.get("sql") or ""), driver)
        if action == "autocommit":
            return set_auto_commit(request)
        if action == "commit":
            return finish_transaction(True)
        if action == "rollback":
            return finish_transaction(False)
        if action == "tx":
            require_connection()
            return {"ok": True, **tx_state()}
        if action == "ping":
            require_connection().ping(reconnect=False)
            return {"ok": True}
        return {"ok": False, "code": "unknown-action", "detail": action}
    except RuntimeError as exc:
        return {"ok": False, "code": str(exc), "detail": str(exc), "action": action}
    except Exception as exc:                                  # noqa: BLE001
        return error_payload(exc, driver, action)


def worker_loop(requests):
    while True:
        request = requests.get()
        if request is None:
            return
        try:
            write_response(handle(request))
        except BaseException:                                 # noqa: BLE001 - 워커 스레드는 어떤 경우에도 죽지 않는다
            write_response({"ok": False, "code": "worker-failed", "detail": traceback.format_exc(limit=3)})


def main():
    requests = queue.Queue()
    worker = threading.Thread(target=worker_loop, args=(requests,))
    worker.daemon = True
    worker.start()
    for line in sys.__stdin__:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(base64.b64decode(line).decode("utf-8"))
        except Exception:                                     # noqa: BLE001
            write_response({"ok": False, "code": "bad-request", "detail": "요청을 읽지 못했습니다."})
            continue
        action = str(request.get("action") or "")
        # 취소와 종료는 큐를 거치지 않는다. 쿼리가 실행 중이면 워커 스레드가 막혀 있기 때문이다.
        if action == "cancel":
            cancel_running_query()                            # 응답 없음 — 결과는 취소당한 쿼리 자신이 보고한다
            continue
        if action == "close":
            break
        requests.put(request)
    connection = _state.get("connection")
    if connection is not None:
        try:
            connection.close()
        except Exception:                                     # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
