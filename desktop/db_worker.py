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
import datetime
import decimal
import json
import os
import queue
import re
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
MAX_EDIT_CHARS = 100000    # 셀을 고칠 때 다시 읽어 오는 값의 상한(표시용 500자와 다르다)
MAX_META_CACHE = 200       # 편집 판정에 쓰는 테이블 메타데이터 캐시 항목 수
MAX_BATCH_CHANGES = 500    # 한 번에 모아 적용할 수 있는 변경 수
MAX_INSERT_VALUES = 512    # 행 하나에 넣을 수 있는 값의 수
MAX_RESULT_SETS = 128      # CALL 하나가 결과 집합을 끝없이 내보내 응답을 부풀리지 않게 한다
MAX_IMPORT_ROWS = 10000    # CSV·엑셀 적재 한 번의 행 상한(런처도 같은 값으로 거른다)
MAX_IMPORT_CELLS = 100000  # 같은 목적의 셀 상한(넓은 표에서 행 수보다 먼저 걸린다)
IMPORT_CHUNK = 500         # executemany 한 번에 보낼 행. 실패하면 이 범위만 한 행씩 다시 짚는다
IMPORT_MODES = ("insert", "ignore", "update")
MAX_DUMP_OBJECTS = 500     # 한 번에 내보낼 스키마 객체 수 상한(런처도 같은 값으로 거른다)
MAX_DUMP_NAME = 128        # 객체 이름 길이 상한
DUMP_RULE = "-- " + "-" * 68   # 파일 안에서 객체 사이를 나누는 줄
# 작은따옴표 리터럴 안에서 뜻이 달라지는 글자. mysqldump 와 같은 표기를 쓴다.
SQL_ESCAPES = {"\\": "\\\\", "'": "\\'", "\0": "\\0", "\n": "\\n", "\r": "\\r", "\x1a": "\\Z"}
# 덤프에서 객체를 적는 순서. 참조하는 쪽이 뒤에 오게 고정한다(뷰끼리의 순서는 따로 푼다).
DUMP_KINDS = ("table", "view", "procedure", "function", "trigger", "event")
DUMP_LABELS = {"table": "테이블", "view": "뷰", "procedure": "프로시저",
               "function": "함수", "trigger": "트리거", "event": "이벤트"}
# 본문에 세미콜론이 들어가는 객체. 통째로 한 문장이라 DELIMITER 로 감싸야 복원된다.
DUMP_COMPOUND = ("procedure", "function", "trigger", "event")
DUMP_MODES = ("structure", "data", "both")
DUMP_INSERT_ROWS = 200             # INSERT 한 문장에 담을 최대 행
# INSERT 한 문장의 최대 길이. 복원하는 서버의 max_allowed_packet 을 넘으면 문장 하나가
# 통째로 거절된다. 글자 수로 세므로 한글만 든 최악의 경우에도 3MB 안쪽이다(기본값은 4MB 이상).
DUMP_INSERT_CHARS = 1024 * 1024
DUMP_INSERT_FORMS = {"insert": "INSERT INTO", "ignore": "INSERT IGNORE INTO", "replace": "REPLACE INTO"}
DUMP_PROGRESS_SECONDS = 0.5        # 진행 보고 사이의 최소 간격
# SHOW CREATE 의 문법과, 그 결과에서 정의문이 실려 오는 열 이름.
OBJECT_KEYWORDS = {"procedure": "PROCEDURE", "function": "FUNCTION",
                   "event": "EVENT", "trigger": "TRIGGER"}
OBJECT_DDL_COLUMNS = {"procedure": "create procedure", "function": "create function",
                      "event": "create event", "trigger": "sql original statement"}
# CHECK 제약을 읽는 문장. 서버마다 표 모양이 달라 앞에서부터 되는 것을 쓴다.
# 1) MariaDB 10.2+ — CHECK_CONSTRAINTS 에 TABLE_NAME 이 있다. 제약 이름이 테이블마다 따로
#    놀 수 있어(스키마 안에서 유일하지 않다) 반드시 TABLE_NAME 까지 걸러야 남의 제약을 끌어오지 않는다.
# 2) MySQL 8.0.16+ — CHECK_CONSTRAINTS 에 TABLE_NAME 이 없어 TABLE_CONSTRAINTS 로 테이블을 찾는다.
#    ENFORCED 는 MySQL 에만 있는 칸이라 1) 쪽에서는 물어보지 않는다.
# 둘 다 실패하면 CHECK 를 모르는 서버(MySQL 5.7·MariaDB 10.1 이하)다 — 지원 안 함으로 본다.
CHECK_CONSTRAINT_QUERIES = (
    "SELECT CONSTRAINT_NAME, CHECK_CLAUSE, 'YES' FROM information_schema.CHECK_CONSTRAINTS "
    "WHERE CONSTRAINT_SCHEMA = %s AND TABLE_NAME = %s ORDER BY CONSTRAINT_NAME",
    "SELECT t.CONSTRAINT_NAME, c.CHECK_CLAUSE, t.ENFORCED "
    "FROM information_schema.TABLE_CONSTRAINTS t "
    "JOIN information_schema.CHECK_CONSTRAINTS c "
    "ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME "
    "WHERE t.TABLE_SCHEMA = %s AND t.TABLE_NAME = %s AND t.CONSTRAINT_TYPE = 'CHECK' "
    "ORDER BY t.CONSTRAINT_NAME",
)
# 이진 컬레이션 번호. ⚠ 숫자·날짜 컬럼도 이 번호로 오므로 이것만 보고 "이진"이라 하면
# INT·DATETIME 이 전부 고칠 수 없는 칸이 된다. 반드시 자료형과 함께 봐야 한다.
BINARY_CHARSET = 63
# 이진 컬레이션일 때 BLOB·BINARY 가 되는 자료형(VARCHAR·TEXT·BLOB 계열)
BINARY_STRING_TYPES = (15, 249, 250, 251, 252, 253, 254)
BINARY_TYPES = (16, 255)   # BIT · GEOMETRY — 언제나 바이트로 온다

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
          "auto_commit": True, "pending": False, "table_meta": {}, "dump": None, "import": None,
          "server_version": ""}


def write_response(payload):
    """응답 한 줄 = 상태 문자('+' 성공 / '-' 실패) + base64(JSON).

    런처(C#)에는 JSON 파서가 없다. 상태를 첫 글자로 못박아 두면 런처가 본문을 열어 보지 않고
    성공 여부만 판단해 그대로 브라우저에 넘길 수 있다.
    """
    encoded = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    with _stdout_lock:
        sys.__stdout__.write(("+" if payload.get("ok") else "-") + encoded + "\n")
        sys.__stdout__.flush()


def write_progress(payload):
    """진행 보고 한 줄 = '*' + base64(JSON).

    최종 응답('+' / '-')과 접두 문자로 갈라 둔다. 런처는 '*' 줄을 작업의 진행 상태에
    반영하고 계속 읽으므로 "요청 하나에 응답 하나"라는 규약은 그대로다. 오래 걸리는
    작업이 살아 있다는 신호이기도 해서, 런처는 이 줄이 올 때마다 기다리는 시간을 새로 잡는다.
    """
    encoded = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
    with _stdout_lock:
        sys.__stdout__.write("*" + encoded + "\n")
        sys.__stdout__.flush()


def progress_reporter():
    """진행 보고가 너무 잦지 않게 시간으로 눌러 준다(마지막 보고는 force 로 반드시 낸다)."""
    state = {"at": 0.0}
    def report(payload, force=False):
        now = time.monotonic()
        if not force and now - state["at"] < DUMP_PROGRESS_SECONDS:
            return
        state["at"] = now
        write_progress(payload)
    return report


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


def escape_sql_text(text):
    """작은따옴표 리터럴 안에 넣을 수 있게 문자열을 바꾼다.

    백슬래시 표기를 쓰므로 덤프 머리글에서 sql_mode 를 함께 지정한다. 대상 서버가
    NO_BACKSLASH_ESCAPES 로 돌고 있으면 이 표기가 데이터 자체가 되어 버리기 때문이다.
    """
    return "".join(SQL_ESCAPES.get(ch, ch) for ch in text)


def time_literal(delta):
    """TIME 컬럼(드라이버가 timedelta 로 준다)을 MySQL 시간 리터럴로 적는다.

    str(timedelta) 를 그대로 쓰면 24시간을 넘는 값이 '1 day, 2:03:04' 가 되어 복원되지 않는다.
    MySQL 의 TIME 은 -838:59:59 까지 담을 수 있으므로 시간 자리를 그대로 늘려 적는다.
    """
    total = delta.total_seconds()
    sign = "-" if total < 0 else ""
    total = abs(total)
    seconds = int(total)
    micro = int(round((total - seconds) * 1000000))
    text = "%s%02d:%02d:%02d" % (sign, seconds // 3600, (seconds % 3600) // 60, seconds % 60)
    if micro:
        text += ".%06d" % micro
    return "'" + text + "'"


def sql_literal(value):
    """값 하나를 덤프 파일에 적을 SQL 리터럴로 바꾼다.

    ⚠ 표시용 cell() 과 섞어 쓰지 않는다. cell() 은 500자에서 자르고 BLOB 을 설명 문구로
    바꾸므로, 그 값을 덤프에 실으면 복원한 데이터가 말없이 달라진다.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):                               # bool 은 int 의 하위형이라 먼저 본다
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # NaN·무한대는 MySQL 리터럴로 적을 수 없다. 복원이 문법 오류로 멈추는 것보다
        # NULL 로 적고 요약에 남기는 편이 낫다.
        if value != value or value in (float("inf"), float("-inf")):
            return "NULL"
        return repr(value)
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return "0x" + raw.hex() if raw else "''"
    if isinstance(value, datetime.timedelta):
        return time_literal(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return "'" + str(value) + "'"
    return "'" + escape_sql_text(str(value)) + "'"


def elapsed_ms(started):
    """서버에서 실제로 걸린 시간. 프런트가 재면 폴링 간격(300ms)이 섞여 빠른 쿼리가 느리게 보인다."""
    return int(round((time.perf_counter() - started) * 1000))


def quote_identifier(name):
    return "`" + str(name).replace("`", "``") + "`"


def statement_records(sql):
    """MySQL CLI의 DELIMITER까지 해석해 실행 문장과 원문 위치를 돌려준다.

    DELIMITER 줄은 클라이언트 지시어라 서버에 보내지 않는다. 사용자 지정 구분자가 켜진
    동안에는 BEGIN ... END 안의 세미콜론을 그대로 두므로 저장 루틴 전체가 한 문장이 된다.
    """
    text = str(sql or "")
    length = len(text)
    delimiter = ";"
    bounds = []
    segment_start = 0
    index = 0
    has_code = False

    while index < length:
        at_line_start = index == 0 or text[index - 1] == "\n"
        if at_line_start and not has_code:
            line_end = text.find("\n", index)
            directive_end = length if line_end < 0 else line_end + 1
            line = text[index:length if line_end < 0 else line_end].rstrip("\r")
            match = re.match(r"^\s*DELIMITER[ \t]+(\S+)[ \t]*$", line, re.IGNORECASE)
            if match:
                delimiter = match.group(1)
                segment_start = directive_end
                index = directive_end
                has_code = False
                continue

        char = text[index]
        if char in ("'", '"', "`"):
            has_code = True
            quote = char
            index += 1
            while index < length:
                current = text[index]
                if current == "\\" and quote != "`":
                    index += 2
                    continue
                if current == quote:
                    if index + 1 < length and text[index + 1] == quote:
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            continue
        if char == "-" and text.startswith("--", index) and (index + 2 >= length or text[index + 2] in " \t\r\n"):
            newline = text.find("\n", index)
            index = length if newline < 0 else newline
            continue
        if char == "#":
            newline = text.find("\n", index)
            index = length if newline < 0 else newline
            continue
        if char == "/" and text.startswith("/*", index):
            end = text.find("*/", index + 2)
            index = length if end < 0 else end + 2
            continue
        if text.startswith(delimiter, index):
            bounds.append((segment_start, index))
            index += len(delimiter)
            segment_start = index
            has_code = False
            continue
        if not char.isspace():
            has_code = True
        index += 1

    bounds.append((segment_start, length))
    records = []
    for start, end in bounds:
        raw = text[start:end]
        stripped = raw.strip()
        if not stripped:
            continue
        actual_start = start + raw.find(stripped)
        actual_end = actual_start + len(stripped)
        records.append({
            "text": stripped,
            "start": actual_start,
            "end": actual_end,
            "line": text.count("\n", 0, actual_start) + 1,
            "endLine": text.count("\n", 0, actual_end) + 1,
        })
    return records


def split_statements(sql):
    return [item["text"] for item in statement_records(sql)]


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
        1217: "dependency",
        1317: "cancelled",
        1553: "dependency",       # 외래키에 필요한 인덱스
        1792: "read-only",
        1828: "dependency",       # 외래키에 필요한 컬럼
        1833: "dependency",       # 외래키에 쓰이는 컬럼 변경
        2002: "refused",
        2003: "refused",
        2005: "unknown-host",
        2006: "connection-lost",
        2013: "connection-lost",
        # 2059 = 서버가 요구한 인증 플러그인을 드라이버가 못 쓴다(Windows GSSAPI, unix_socket 등).
        # 비밀번호 문제가 아니라 계정의 인증 방식 문제라 안내가 달라야 한다.
        2059: "auth-plugin",
        3730: "dependency",       # 다른 테이블 외래키가 참조 중
        3752: "dependency",       # 생성 컬럼이 참조 중
        3819: "check-violated",   # CHECK 제약을 어긴 값(MySQL 8.0.16+)
        3940: "check-constraint", # 이름으로 지정한 제약을 찾을 수 없다
        3959: "check-constraint", # CHECK 제약이 쓰는 컬럼이라 지우거나 이름을 바꿀 수 없다
        4025: "check-violated",   # 같은 뜻의 MariaDB 오류(CONSTRAINT %s failed)
    }
    if errno in mapping:
        return mapping[errno], detail, errno
    # CHECK 관련 오류 번호는 서버·판올림마다 갈린다(이름 중복·없는 컬럼 참조 등).
    # 번호로 못 짚은 것은 메시지로 한 번 더 걸러 "그냥 SQL 오류"로 흘려보내지 않는다.
    if "check constraint" in lowered:
        return ("check-violated" if "violated" in lowered else "check-constraint"), detail, errno
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
            # 버전 문자열은 라벨용만이 아니다. CHECK 제약을 지우는 문법이 갈래마다 달라 여기서 들고 있는다.
            _state["server_version"] = str(row[1] or "")
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
    _state["table_meta"] = {}
    return {"ok": True, "readOnly": read_only, "autoCommit": auto_commit, "pending": False, **info}


def check_constraint_syntax():
    """CHECK 제약을 지우는 문법과 검사 여부(ENFORCED)를 끌 수 있는지.

    MariaDB 는 DROP CONSTRAINT 만 알고 검사 여부를 끄는 기능이 없다.
    MySQL 8 은 DROP CHECK 를 쓴다(DROP CONSTRAINT 는 8.0.19 부터라 더 좁다).
    """
    if "mariadb" in str(_state.get("server_version") or "").lower():
        return "CONSTRAINT", False
    return "CHECK", True


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


def field_sources(cursor):
    """결과의 각 열이 서버에서 어느 테이블 어느 컬럼으로 왔는지 그대로 읽는다.

    열 이름(cursor.description)만으로는 별칭·조인·계산식을 가릴 수 없다. 드라이버가 서버에서
    받아 둔 필드 메타데이터를 쓰면 "고칠 수 있는 결과인가"를 프런트가 짐작하지 않아도 된다.
    커서에 다른 질의를 실행하면 이 메타데이터가 덮이므로 execute 직후에 불러야 한다.
    """
    result = getattr(cursor, "_result", None)
    fields = getattr(result, "fields", None) or []
    sources = []
    for field in fields:
        database = getattr(field, "db", "")
        if isinstance(database, (bytes, bytearray, memoryview)):
            database = bytes(database).decode("utf-8", "replace")
        charset = int(getattr(field, "charsetnr", 0) or 0)
        type_code = int(getattr(field, "type_code", 0) or 0)
        sources.append({
            "database": str(database or ""),
            "table": str(getattr(field, "org_table", "") or ""),
            "column": str(getattr(field, "org_name", "") or ""),
            "binary": (charset == BINARY_CHARSET and type_code in BINARY_STRING_TYPES)
                      or type_code in BINARY_TYPES,
        })
    return sources


def table_meta(connection, database, name):
    """편집 판정에 쓰는 테이블 메타데이터. 결과 표마다 다시 묻지 않도록 접속이 들고 있는다."""
    key = (database, name)
    cached = _state["table_meta"].get(key)
    if cached is not None:
        return cached
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
            (database, name))
        row = cursor.fetchone()
        kind = str(row[0] or "").upper() if row else ""
        cursor.execute(
            "SELECT COLUMN_NAME, COLUMN_KEY, EXTRA, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION", (database, name))
        columns, keys = {}, []
        for item in cursor.fetchall():
            column = str(item[0])
            extra = str(item[2] or "").upper()
            columns[column] = {
                # 생성 컬럼(GENERATED)은 값을 직접 넣을 수 없다. 서버가 거절하기 전에 화면에서 잠근다.
                "generated": "GENERATED" in extra,
                "nullable": str(item[3] or "").upper() == "YES",
                "type": str(item[4] or ""),
            }
            if str(item[1] or "").upper() == "PRI":
                keys.append(column)
    meta = {"base": kind == "BASE TABLE", "columns": columns, "keys": keys}
    if len(_state["table_meta"]) < MAX_META_CACHE:
        _state["table_meta"][key] = meta
    return meta


def edit_plan(connection, sources, columns):
    """이 결과 표의 칸을 고칠 수 있는지 판정한다.

    기준은 하나다 — 한 행을 정확히 짚을 수 있는가. 한 베이스 테이블에서 온 결과이고
    그 테이블의 기본키가 결과에 모두 실려 있어야 짚을 수 있다. 하나라도 어긋나면
    이유를 붙여 잠근다(조인·뷰·집계는 여기서 걸린다).

    기본키 칸 자체는 고치지 않는다. 행을 짚는 근거를 바꾸는 일이라 값 수정과 다른 이야기다.
    """
    if _state["read_only"]:
        return {"editable": False, "reason": "read-only"}
    if not sources or len(sources) != len(columns):
        return {"editable": False, "reason": "no-source"}
    tables = set((item["database"], item["table"]) for item in sources if item["table"])
    if not tables:
        return {"editable": False, "reason": "no-source"}
    if len(tables) > 1:
        return {"editable": False, "reason": "multi-table"}
    database, name = tables.pop()
    if not database:
        with connection.cursor() as cursor:
            database = current_schema(cursor, "")
    meta = table_meta(connection, database, name)
    if not meta["base"]:
        return {"editable": False, "reason": "view"}
    if not meta["keys"]:
        return {"editable": False, "reason": "no-key"}
    positions = {}
    for index, item in enumerate(sources):
        if item["table"] == name and item["column"] in meta["keys"] and item["column"] not in positions:
            positions[item["column"]] = index
    missing = [column for column in meta["keys"] if column not in positions]
    if missing:
        return {"editable": False, "reason": "key-missing", "detail": ", ".join(missing)}
    cells = []
    for item in sources:
        column = item["column"]
        info = meta["columns"].get(column) or {}
        if item["table"] != name or not column:
            cells.append({"editable": False, "reason": "no-source"})
        elif column in meta["keys"]:
            cells.append({"editable": False, "reason": "key", "column": column})
        elif item["binary"]:
            cells.append({"editable": False, "reason": "binary", "column": column})
        elif info.get("generated"):
            cells.append({"editable": False, "reason": "generated", "column": column})
        else:
            cells.append({"editable": True, "column": column,
                          "nullable": bool(info.get("nullable")), "type": str(info.get("type") or "")})
    return {"editable": True, "database": database, "table": name,
            "keys": [{"name": column, "index": positions[column]} for column in meta["keys"]],
            "cells": cells}


def safe_edit_plan(connection, sources, columns):
    """편집 판정이 실패해도 결과 자체는 그대로 보여 준다(고치지 못할 뿐이다)."""
    try:
        return edit_plan(connection, sources, columns)
    except Exception:                                         # noqa: BLE001
        return {"editable": False, "reason": "unknown"}


def run_statements(sql, driver):
    connection = require_connection()
    records = statement_records(sql)
    if not records:
        return {"ok": True, "statements": [], "ms": 0, **tx_state()}
    if _state["read_only"]:
        for record in records:
            statement = record["text"]
            keyword = first_keyword(statement)
            if keyword in WRITE_KEYWORDS:
                return {"ok": False, "code": "read-only-blocked", "detail": keyword.upper()}

    _state["pages"] = {}
    results = []
    budget = MAX_CELLS
    for statement_index, record in enumerate(records):
        statement = record["text"]
        keyword = first_keyword(statement)
        base_entry = {
            "sql": statement[:4000], "keyword": keyword, "sqlTruncated": len(statement) > 4000,
            "statement": statement_index, "line": record["line"], "endLine": record["endLine"],
        }
        entry = dict(base_entry, resultIndex=0)
        first_result = len(results)
        result_index = 0
        edit_candidates = []
        started = time.perf_counter()
        try:
            with connection.cursor() as cursor:
                cursor.execute(statement)
                while True:
                    if len(results) >= MAX_RESULT_SETS:
                        raise RuntimeError("too-many-result-sets")
                    entry = dict(base_entry, resultIndex=result_index)
                    if cursor.description:
                        # 열의 출처는 다음 결과 집합으로 넘어가기 전에 붙잡아 둔다(편집 판정에 쓴다).
                        sources = field_sources(cursor)
                        columns, kept_rows, more, clipped = read_rows(cursor, KEEP_ROWS, KEEP_CELLS)
                        width = max(1, len(columns))
                        send = max(0, min(MAX_ROWS, budget // width, len(kept_rows)))
                        budget = max(0, budget - send * width)
                        result_set = len(results)
                        if len(kept_rows) > send or more:
                            if len(_state["pages"]) < MAX_KEPT_SETS:
                                _state["pages"][result_set] = {
                                    "columns": columns, "rows": kept_rows, "clipped": clipped, "more": more}
                        page = slice_page(
                            {"columns": columns, "rows": kept_rows, "clipped": clipped, "more": more}, 0, send)
                        entry.update({"kind": "rows", "columns": columns, "rows": page["rows"],
                                      "truncated": page["hasMore"], "clippedCells": page["clippedCells"],
                                      "loaded": len(kept_rows), "hasMore": page["hasMore"],
                                      "serverHasMore": more, "set": result_set,
                                      "edit": {"editable": False, "reason": "unknown"}})
                        # CALL의 다음 결과 집합이 남아 있는 동안 같은 커넥션으로 메타데이터를
                        # 조회하면 드라이버가 남은 결과를 버릴 수 있다. nextset()을 끝까지 읽은
                        # 뒤에만 편집 가능 여부를 판정한다.
                        edit_candidates.append((entry, sources, columns))
                        if not page["rows"] and len(kept_rows):
                            entry["budgetExhausted"] = True
                    else:
                        affected = max(0, int(getattr(cursor, "rowcount", 0) or 0))
                        entry.update({"kind": "affected", "affected": affected,
                                      "insertId": int(getattr(cursor, "lastrowid", 0) or 0)})
                    warnings = getattr(cursor, "_warnings", None)
                    if warnings:
                        entry["warnings"] = int(warnings)
                    next_set = getattr(cursor, "nextset", None)
                    has_next = bool(callable(next_set) and next_set())
                    # MySQL/PyMySQL은 CALL의 실제 결과 집합을 모두 보낸 뒤 빈 완료 결과를
                    # 하나 더 붙인다. 앞에 실제 결과가 있고, 마지막 결과가 경고·반영·삽입
                    # 정보 없는 0행 상태일 때만 숨긴다. 일반 UPDATE 0행은 그대로 보인다.
                    trailing_call_status = (
                        keyword == "call" and result_index > 0 and not has_next
                        and entry.get("kind") == "affected" and entry.get("affected") == 0
                        and entry.get("insertId") == 0 and not entry.get("warnings")
                    )
                    if not trailing_call_status:
                        results.append(entry)
                    if not has_next:
                        break
                    result_index += 1
            for result_entry, sources, columns in edit_candidates:
                result_entry["edit"] = safe_edit_plan(connection, sources, columns)
        except Exception as exc:                              # noqa: BLE001 - 드라이버 예외 전부를 코드로 옮긴다
            # 여기까지의 문장은 이미 서버에서 실행됐다(자동 커밋이면 확정된 상태다).
            # 실패했다고 앞의 결과까지 버리면 무엇이 반영되고 무엇이 안 됐는지 알 길이 없어진다.
            failure = error_payload(exc, driver, "query")
            detail = str(failure.get("detail") or "")
            line_match = re.search(r"\bat line\s+(\d+)\b", detail, re.IGNORECASE)
            script_line = record["line"] + (max(1, int(line_match.group(1))) - 1 if line_match else 0)
            entry = dict(base_entry, resultIndex=result_index)
            entry.update({"kind": "error", "ms": elapsed_ms(started),
                          "code": str(failure.get("code") or ""),
                          "detail": detail, "scriptLine": script_line})
            results.append(entry)
            failure["statements"] = results
            failure["failedAt"] = len(results) - 1
            failure["failedStatement"] = statement_index
            failure["scriptLine"] = script_line
            failure["ms"] = sum(item.get("ms", 0) for item in results)
            failure.update(tx_state())
            return failure
        # 수동 커밋 모드에서만 "커밋하지 않은 변경"을 센다. 암묵적 커밋 문장은 그 표시를 지운다.
        # 구조가 바뀌었을 수 있으면 편집 판정에 쓰던 메타데이터를 버린다(기본키·생성 컬럼이 달라진다).
        if keyword in IMPLICIT_COMMIT_KEYWORDS:
            _state["table_meta"] = {}
        if not _state["auto_commit"]:
            if keyword in IMPLICIT_COMMIT_KEYWORDS:
                _state["pending"] = False
            elif keyword in DATA_CHANGE_KEYWORDS:
                _state["pending"] = True
        # CALL의 여러 결과에 같은 시간을 반복해 더하지 않는다. 첫 결과에 문장 전체 시간을 둔다.
        if first_result < len(results):
            results[first_result]["ms"] = elapsed_ms(started)
    return {"ok": True, "statements": results, "ms": sum(item.get("ms", 0) for item in results),
            **tx_state()}


def load_schema():
    connection = require_connection()
    payload = {"ok": True, "databases": [], "tables": [], "routines": [], "events": [],
               "triggers": [], "current": ""}
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
            cursor.execute(
                "SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORIENTATION "
                "FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = %s "
                "ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, TRIGGER_NAME LIMIT %s",
                (payload["current"], MAX_SCHEMA_OBJECTS),
            )
            payload["triggers"] = [{
                "name": str(item[0]), "type": "trigger", "table": str(item[1] or ""),
                "timing": str(item[2] or ""), "event": str(item[3] or ""),
                "orientation": str(item[4] or ""),
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


def check_constraint_definitions(cursor, name, schema):
    """CHECK 제약. 돌려주는 값은 (서버가 CHECK 를 아는가, 제약 목록).

    표가 없어서 빈 목록인 것과 제약을 안 건 것을 화면에서 구분해야 해서 지원 여부를 함께 준다.
    MySQL 은 문장 하나가 실패해도 트랜잭션을 접지 않으므로 다음 문장을 그대로 이어 쓸 수 있다.
    """
    rows = None
    for statement in CHECK_CONSTRAINT_QUERIES:
        try:
            cursor.execute(statement, (schema, name))
            rows = cursor.fetchall()
            break
        except Exception as exc:                              # noqa: BLE001 - 서버별 information_schema 차이를 가른다
            args = getattr(exc, "args", ()) or ()
            errno = args[0] if args and isinstance(args[0], int) else None
            # 첫 문장의 TABLE_NAME 이 없거나 CHECK_CONSTRAINTS 표 자체가 없는 경우만
            # 호환성 차이로 본다. 연결 끊김·권한·시간 초과까지 "미지원"으로 숨기면 안 된다.
            if errno not in (1054, 1109, 1146):
                raise
            continue
    if rows is None:
        return False, []
    found = {}
    for item in rows:
        constraint_name = str(item[0] or "")
        if constraint_name in found:
            continue
        found[constraint_name] = {
            "name": constraint_name,
            "clause": str(item[1] or ""),
            # MariaDB 에는 끄는 기능이 없어 언제나 켜진 것으로 본다.
            "enforced": str(item[2] or "YES").upper() != "NO",
        }
    return True, list(found.values())


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


def show_create_table(cursor, name, schema=""):
    """SHOW CREATE TABLE — 뷰에도 그대로 쓸 수 있다(CREATE VIEW 문을 돌려준다)."""
    target = quote_identifier(name)
    if schema:
        target = quote_identifier(schema) + "." + target
    cursor.execute("SHOW CREATE TABLE " + target)
    row = cursor.fetchone()
    return str(row[1]) if row and len(row) > 1 else ""


def show_create_object(cursor, kind, name, schema):
    """프로시저·함수·이벤트·트리거의 SHOW CREATE 결과에서 정의문만 골라낸다."""
    target = quote_identifier(schema) + "." + quote_identifier(name)
    cursor.execute("SHOW CREATE " + OBJECT_KEYWORDS[kind] + " " + target)
    row = cursor.fetchone()
    labels = [str(item[0] or "").strip().lower() for item in (cursor.description or [])]
    wanted = OBJECT_DDL_COLUMNS[kind]
    if row and wanted in labels:
        return str(row[labels.index(wanted)] or "")
    if row:
        return next((str(value) for value in row if isinstance(value, str)
                     and value.lstrip().upper().startswith("CREATE ")), "")
    return ""


def load_ddl(name, database=""):
    connection = require_connection()
    with connection.cursor() as cursor:
        ddl = show_create_table(cursor, name, database)
    return {"ok": True, "name": name, "ddl": ddl}


def load_object_ddl(kind, name, database=""):
    normalized = str(kind or "").lower()
    if normalized not in OBJECT_KEYWORDS:
        return {"ok": False, "code": "unknown-object-kind", "detail": normalized}
    connection = require_connection()
    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)
        ddl = show_create_object(cursor, normalized, name, schema)
    return {"ok": True, "database": schema, "kind": normalized, "name": name, "ddl": ddl}


def load_dependencies(kind, name, table="", database=""):
    """트리 객체 삭제 전에 확인 가능한 의존성을 구조화해 돌려준다.

    외래키와 뷰 사용 관계는 MySQL 데이터 사전이 보장하는 정보만 쓴다. 저장 루틴 본문의
    동적 SQL처럼 서버도 정적 관계를 갖고 있지 않은 참조는 여기서 추측하지 않고, 실제 DDL
    실행 오류가 마지막 안전망이 된다.
    """
    normalized = str(kind or "").lower()
    allowed = {"table", "view", "column", "index", "foreignkey",
               "procedure", "function", "trigger", "event"}
    if normalized not in allowed:
        return {"ok": False, "code": "unknown-object-kind", "detail": normalized}
    if not name:
        return {"ok": False, "code": "unknown-object", "detail": ""}
    if normalized in {"column", "index", "foreignkey"} and not table:
        return {"ok": False, "code": "unknown-table", "detail": ""}

    connection = require_connection()
    dependencies = []
    warnings = []
    seen = set()

    def add_dependency(dep_kind, dep_name, dep_table, detail):
        key = (dep_kind, dep_name, dep_table, detail)
        if key in seen:
            return
        seen.add(key)
        dependencies.append({"kind": dep_kind, "name": dep_name,
                             "table": dep_table, "detail": detail})

    with connection.cursor() as cursor:
        schema = current_schema(cursor, database)

        # 테이블이나 뷰를 사용하는 다른 뷰를 지우지 않은 채 원본만 없애면 MySQL은
        # 깨진 뷰를 남길 수 있다. VIEW_TABLE_USAGE로 그 관계를 먼저 차단한다.
        if normalized in {"table", "view"}:
            try:
                cursor.execute(
                    "SELECT VIEW_SCHEMA, VIEW_NAME FROM information_schema.VIEW_TABLE_USAGE "
                    "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY VIEW_SCHEMA, VIEW_NAME",
                    (schema, name),
                )
                for row in cursor.fetchall():
                    view_schema, view_name = str(row[0] or ""), str(row[1] or "")
                    if view_schema == schema and view_name == name:
                        continue
                    add_dependency("view", view_name, view_name if view_schema == schema else "",
                                   "뷰 " + view_schema + "." + view_name + "에서 사용 중")
            except Exception:                                 # noqa: BLE001 - 구형 MySQL에는 usage 뷰가 없을 수 있다
                warnings.append("이 서버에서는 뷰 참조 관계를 미리 확인하지 못했습니다.")

        if normalized == "table":
            cursor.execute(
                "SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME "
                "FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = %s "
                "AND REFERENCED_TABLE_NAME = %s AND REFERENCED_TABLE_NAME IS NOT NULL "
                "AND NOT (TABLE_SCHEMA = %s AND TABLE_NAME = %s) "
                "ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
                (schema, name, schema, name),
            )
            for row in cursor.fetchall():
                constraint, child_schema, child_table = str(row[0]), str(row[1]), str(row[2])
                detail = ("외래키 " + constraint + " · " + child_schema + "." + child_table
                          + "." + str(row[3]) + " → " + schema + "." + name + "." + str(row[4]))
                add_dependency("foreignKey", constraint, child_table if child_schema == schema else "", detail)
            cursor.execute(
                "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS "
                "WHERE TRIGGER_SCHEMA = %s AND EVENT_OBJECT_TABLE = %s ORDER BY TRIGGER_NAME",
                (schema, name),
            )
            trigger_names = [str(row[0]) for row in cursor.fetchall()]
            if trigger_names:
                warnings.append("테이블과 함께 트리거도 삭제됩니다: " + ", ".join(trigger_names))

        elif normalized == "column":
            cursor.execute(
                "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = %s "
                "AND TABLE_NAME = %s AND COLUMN_NAME = %s ORDER BY INDEX_NAME, SEQ_IN_INDEX",
                (schema, table, name),
            )
            for row in cursor.fetchall():
                index_name = str(row[0])
                add_dependency("index", index_name, table, "인덱스 " + index_name + "에서 사용 중")
            cursor.execute(
                "SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, "
                "REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME "
                "FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL AND "
                "((TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s) OR "
                "(REFERENCED_TABLE_SCHEMA = %s AND REFERENCED_TABLE_NAME = %s AND REFERENCED_COLUMN_NAME = %s)) "
                "ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
                (schema, table, name, schema, table, name),
            )
            for row in cursor.fetchall():
                constraint, child_schema, child_table = str(row[0]), str(row[1]), str(row[2])
                detail = ("외래키 " + constraint + " · " + child_schema + "." + child_table
                          + "." + str(row[3]) + " → " + str(row[4]) + "." + str(row[5]) + "." + str(row[6]))
                add_dependency("foreignKey", constraint, child_table if child_schema == schema else "", detail)
            cursor.execute(
                "SELECT COLUMN_NAME, GENERATION_EXPRESSION FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME <> %s "
                "AND GENERATION_EXPRESSION IS NOT NULL AND GENERATION_EXPRESSION <> ''",
                (schema, table, name),
            )
            quoted = "`" + name.replace("`", "``") + "`"
            word = re.compile(r"(?<![0-9A-Za-z_$])" + re.escape(name) + r"(?![0-9A-Za-z_$])", re.IGNORECASE)
            for row in cursor.fetchall():
                expression = str(row[1] or "")
                if quoted in expression or word.search(expression):
                    generated = str(row[0])
                    add_dependency("column", generated, table,
                                   "생성 컬럼 " + generated + "의 식에서 사용 중")

        elif normalized == "index":
            cursor.execute(
                "SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS "
                "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME IS NOT NULL "
                "ORDER BY INDEX_NAME, SEQ_IN_INDEX",
                (schema, table),
            )
            indexes = {}
            for row in cursor.fetchall():
                indexes.setdefault(str(row[0]), []).append(str(row[1]))
            selected_columns = indexes.get(name, [])
            cursor.execute(
                "SELECT CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE "
                "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND REFERENCED_TABLE_NAME IS NOT NULL "
                "ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION",
                (schema, table),
            )
            foreign_columns = {}
            for row in cursor.fetchall():
                foreign_columns.setdefault(str(row[0]), []).append(str(row[1]))
            for constraint, columns in foreign_columns.items():
                selected_covers = selected_columns[:len(columns)] == columns
                alternative = any(index_name != name and values[:len(columns)] == columns
                                  for index_name, values in indexes.items())
                if selected_covers and not alternative:
                    add_dependency("foreignKey", constraint, table,
                                   "외래키 " + constraint + " 유지에 필요한 인덱스")

        elif normalized == "function":
            try:
                cursor.execute(
                    "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.VIEW_ROUTINE_USAGE "
                    "WHERE SPECIFIC_SCHEMA = %s AND SPECIFIC_NAME = %s ORDER BY TABLE_SCHEMA, TABLE_NAME",
                    (schema, name),
                )
                for row in cursor.fetchall():
                    view_schema, view_name = str(row[0]), str(row[1])
                    add_dependency("view", view_name, view_name if view_schema == schema else "",
                                   "뷰 " + view_schema + "." + view_name + "에서 함수를 사용 중")
            except Exception:                                 # noqa: BLE001
                warnings.append("이 서버에서는 뷰의 함수 사용 관계를 미리 확인하지 못했습니다.")

    return {"ok": True, "database": schema, "kind": normalized, "name": name, "table": table,
            "dependencies": dependencies, "warnings": warnings}


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
        checks_supported, checks = check_constraint_definitions(cursor, name, schema)
    check_drop_keyword, check_enforcement = check_constraint_syntax()
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
        "checkConstraints": checks,
        "checkConstraintsSupported": checks_supported,
        "checkDropKeyword": check_drop_keyword,
        "checkEnforcement": check_enforcement,
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
        sources = field_sources(cursor)
        columns, rows, more, clipped = read_rows(cursor, PREVIEW_ROWS, MAX_CELLS)
        payload.update({"displayColumns": columns, "rows": rows, "truncated": more, "clippedCells": clipped,
                        "ms": elapsed_ms(started)})
    payload["edit"] = safe_edit_plan(connection, sources, columns)
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


def key_where(keys):
    """기본키 조건. 값은 SQL 에 이어 붙이지 않고 자리표시자로만 보낸다."""
    clauses, params = [], []
    for item in (keys or []):
        name = str(item.get("name") or "")
        if not name or item.get("null"):
            # 기본키는 NULL 일 수 없다. 그런 값이 왔다면 행을 짚을 근거가 없는 것이다.
            raise RuntimeError("bad-cell-key")
        clauses.append(quote_identifier(name) + " = %s")
        params.append(str(item.get("value") or ""))
    if not clauses:
        raise RuntimeError("bad-cell-key")
    return " AND ".join(clauses), params


def table_target(request):
    """고칠 테이블이 어디인지. 이름은 전부 인용한다(값은 어디서도 SQL 에 붙이지 않는다)."""
    table = str(request.get("table") or "")
    if not table:
        raise RuntimeError("bad-cell-target")
    target = quote_identifier(table)
    database = str(request.get("database") or "")
    if database:
        target = quote_identifier(database) + "." + target
    return target


def cell_target(request):
    """고칠 칸이 어디인지(테이블 + 컬럼)."""
    column = str(request.get("column") or "")
    if not column:
        raise RuntimeError("bad-cell-target")
    return table_target(request), column


def read_cell(request):
    """편집을 시작할 때 값 전체를 다시 읽는다.

    표에 실린 값은 500자에서 잘려 있을 수 있다. 그 글자를 그대로 저장하면 서버의 값이
    잘린 채로 덮인다. 고치기 전에 원본을 다시 읽는 이유가 이것이다.
    """
    connection = require_connection()
    target, column = cell_target(request)
    where, params = key_where(request.get("keys"))
    with connection.cursor() as cursor:
        cursor.execute("SELECT " + quote_identifier(column) + " FROM " + target
                       + " WHERE " + where + " LIMIT 1", params)
        row = cursor.fetchone()
    if row is None:
        return {"ok": False, "code": "row-gone", "detail": ""}
    value = row[0]
    if value is None:
        return {"ok": True, "isNull": True, "value": "", "clipped": False}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"ok": False, "code": "binary-cell", "detail": str(len(bytes(value)))}
    text = str(value)
    return {"ok": True, "isNull": False, "value": text[:MAX_EDIT_CHARS], "clipped": len(text) > MAX_EDIT_CHARS}


def row_exists(cursor, target, where, params):
    """그 행이 아직 있는가. 반영 0행이 '값이 같았다'인지 '행이 사라졌다'인지 가르는 데만 쓴다."""
    cursor.execute("SELECT 1 FROM " + target + " WHERE " + where + " LIMIT 1", params)
    return cursor.fetchone() is not None


def insert_sql(target, values):
    """행 하나를 넣는 문장. 적지 않은 컬럼은 서버의 기본값이 채운다."""
    if len(values) > MAX_INSERT_VALUES:
        raise RuntimeError("too-many-values")
    columns, params = [], []
    for item in values:
        name = str(item.get("column") or "")
        if not name:
            raise RuntimeError("bad-cell-target")
        columns.append(quote_identifier(name))
        params.append(None if item.get("null") else str(item.get("value") or ""))
    if not columns:
        # 값을 하나도 적지 않은 행 = 전부 기본값. MySQL 이 받는 문장이다.
        return "INSERT INTO " + target + " () VALUES ()", []
    return ("INSERT INTO " + target + " (" + ", ".join(columns) + ") VALUES ("
            + ", ".join(["%s"] * len(columns)) + ")", params)


def change_plans(target, changes):
    """모아 온 변경을 실행할 문장으로 옮긴다. 값은 언제나 자리표시자로만 나간다."""
    plans = []
    for change in changes:
        kind = str(change.get("kind") or "")
        if kind == "update":
            column = str(change.get("column") or "")
            if not column:
                raise RuntimeError("bad-cell-target")
            where, params = key_where(change.get("keys"))
            value = None if change.get("valueNull") else str(change.get("value") or "")
            plans.append(("update", "UPDATE " + target + " SET " + quote_identifier(column)
                          + " = %s WHERE " + where, [value] + params, where, params))
        elif kind == "delete":
            where, params = key_where(change.get("keys"))
            plans.append(("delete", "DELETE FROM " + target + " WHERE " + where, params, where, params))
        elif kind == "insert":
            sql, params = insert_sql(target, change.get("values") or [])
            plans.append(("insert", sql, params, "", []))
        else:
            raise RuntimeError("bad-change-kind")
    # 고치기 → 지우기 → 넣기 순서로 돌린다. 지운 기본키를 같은 묶음에서 다시 넣을 수 있다.
    order = {"update": 0, "delete": 1, "insert": 2}
    plans.sort(key=lambda item: order[item[0]])
    return plans


def apply_edits(request):
    """모아 둔 변경을 한 번에 적용한다. 하나라도 실패하면 이 묶음만 통째로 되돌린다.

    ⚠ 수동 커밋 모드에서 connection.rollback() 을 부르면 안 된다 — 사용자가 앞서 쌓아 둔
    커밋하지 않은 변경까지 함께 사라진다. 세이브포인트를 걸어 이 묶음만 되돌린다.
    자동 커밋 모드에서는 문장마다 확정되므로 세이브포인트가 뜻이 없다. 묶음을 트랜잭션으로 연다.

    사라진 행을 고치라는 요청은 실패로 본다(말없이 아무 일도 일어나지 않는 것이 제일 나쁘다).
    사라진 행을 지우라는 요청은 뜻이 이미 이루어진 것이므로 몇 건인지만 알린다.
    """
    connection = require_connection()
    if _state["read_only"]:
        return {"ok": False, "code": "read-only-blocked", "detail": "UPDATE"}
    changes = request.get("changes") or []
    if not changes:
        return {"ok": False, "code": "no-changes", "detail": ""}
    if len(changes) > MAX_BATCH_CHANGES:
        return {"ok": False, "code": "too-many-changes", "detail": str(len(changes))}
    target = table_target(request)
    plans = change_plans(target, changes)

    manual = not _state["auto_commit"]
    counts = {"update": 0, "delete": 0, "insert": 0, "unchanged": 0, "missing": 0}
    insert_ids = []
    started = time.perf_counter()
    with connection.cursor() as cursor:
        if manual:
            cursor.execute("SAVEPOINT classdock_edit")
        else:
            connection.begin()
        try:
            for kind, sql, params, where, key_params in plans:
                affected = int(cursor.execute(sql, params) or 0)
                if kind == "insert":
                    counts["insert"] += 1
                    insert_ids.append(int(getattr(cursor, "lastrowid", 0) or 0))
                elif affected:
                    counts[kind] += 1
                elif kind == "delete":
                    counts["missing"] += 1
                elif row_exists(cursor, target, where, key_params):
                    counts["unchanged"] += 1
                else:
                    raise RuntimeError("row-gone")
        except Exception as exc:                              # noqa: BLE001
            try:
                if manual:
                    cursor.execute("ROLLBACK TO SAVEPOINT classdock_edit")
                else:
                    connection.rollback()
            except Exception:                                 # noqa: BLE001
                pass
            if isinstance(exc, RuntimeError):
                failure = {"ok": False, "code": str(exc), "detail": str(exc)}
            else:
                failure = error_payload(exc, import_driver(), "apply")
            # 되돌렸으므로 반영된 것은 하나도 없다. 절반만 들어갔다고 오해하게 두지 않는다.
            failure["applied"] = 0
            failure.update(tx_state())
            return failure
        if manual:
            cursor.execute("RELEASE SAVEPOINT classdock_edit")
        else:
            connection.commit()
    if manual:
        _state["pending"] = True
    return {"ok": True, "ms": elapsed_ms(started), "changes": len(plans), "counts": counts,
            "insertIds": insert_ids, **tx_state()}


def import_sql(target, columns, mode):
    """적재 문장 하나. 값은 언제나 자리표시자로만 나간다(파일의 글자가 SQL 에 붙지 않는다).

    컬럼 이름은 프런트가 고른 것이 아니라 테이블 정의에 있는 이름이고, 여기서 전부 인용한다.
    `ON DUPLICATE KEY UPDATE c = VALUES(c)` 의 VALUES() 는 MySQL 8.0.20 에서 권장이 바뀌었지만
    5.7·8.x·MariaDB 가 모두 받는 표기라 그대로 쓴다(새 별칭 문법은 옛 서버가 못 읽는다).
    """
    if not columns:
        raise RuntimeError("import-no-columns")
    if len(columns) > MAX_INSERT_VALUES:
        raise RuntimeError("too-many-values")
    names = [quote_identifier(name) for name in columns]
    head = "INSERT IGNORE INTO " if mode == "ignore" else "INSERT INTO "
    sql = (head + target + " (" + ", ".join(names) + ") VALUES ("
           + ", ".join(["%s"] * len(names)) + ")")
    if mode == "update":
        sql += " ON DUPLICATE KEY UPDATE " + ", ".join(n + " = VALUES(" + n + ")" for n in names)
    return sql


def import_params(rows, width):
    """행 목록을 드라이버에 넘길 튜플 목록으로 옮긴다. null 은 JSON null 로 와서 그대로 None 이 된다."""
    params = []
    for index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != width:
            raise RuntimeError("import-bad-row")
        params.append(tuple(None if value is None else str(value) for value in row))
    return params


def find_failing_row(cursor, sql, chunk, offset):
    """청크 하나가 실패했을 때 몇 번째 행 때문인지 짚는다.

    한 행씩 다시 넣어 보되 세이브포인트 안에서만 하고 끝나면 되돌린다 — 짚는 동안 넣은 것이
    남으면 안 된다. 부르기 전에 그 청크가 부분적으로 넣은 것을 이미 되돌려 두어야 첫 행이
    "중복 키"로 잘못 걸리지 않는다(그래서 청크마다 세이브포인트를 미리 잡는다).
    """
    cursor.execute("SAVEPOINT classdock_probe")
    found = None
    try:
        for index, params in enumerate(chunk):
            try:
                cursor.execute(sql, params)
            except Exception as exc:                          # noqa: BLE001
                found = (offset + index, exc)
                break
    finally:
        try:
            cursor.execute("ROLLBACK TO SAVEPOINT classdock_probe")
            cursor.execute("RELEASE SAVEPOINT classdock_probe")
        except Exception:                                     # noqa: BLE001
            pass
    return found


def import_rows(request, driver):
    """CSV·엑셀에서 읽은 행을 한 테이블에 넣는다. 하나라도 실패하면 전부 되돌린다.

    붙여넣기(apply-edits)와 나누어 두는 이유는 규모다. 수천 행을 변경 목록에 담으면 미리보기도
    되돌리기도 뜻을 잃는다. 여기서는 executemany 로 묶어 보내고 진행만 흘려 보고한다.

    ⚠ 되돌리기 규칙은 apply_edits 와 같아야 한다 — 수동 커밋 모드에서 connection.rollback() 을
    부르면 사용자가 앞서 쌓아 둔 커밋하지 않은 변경까지 사라진다. 세이브포인트로 이 적재만 되돌린다.
    """
    connection = require_connection()
    if _state["read_only"]:
        return {"ok": False, "code": "read-only-blocked", "detail": "INSERT"}
    mode = str(request.get("mode") or "insert")
    if mode not in IMPORT_MODES:
        return {"ok": False, "code": "import-bad-mode", "detail": mode}
    columns = [str(name) for name in (request.get("columns") or [])]
    rows = request.get("rows") or []
    if not rows:
        return {"ok": False, "code": "no-changes", "detail": ""}
    if len(rows) > MAX_IMPORT_ROWS:
        return {"ok": False, "code": "import-too-many-rows", "detail": str(len(rows))}
    if columns and len(rows) * len(columns) > MAX_IMPORT_CELLS:
        return {"ok": False, "code": "import-too-many-cells", "detail": str(len(rows) * len(columns))}
    target = table_target(request)
    sql = import_sql(target, columns, mode)
    params = import_params(rows, len(columns))

    manual = not _state["auto_commit"]
    total = len(params)
    done = 0
    affected = 0
    started = time.perf_counter()
    _state["import"] = {"cancel": False}
    report = progress_reporter()
    try:
        with connection.cursor() as cursor:
            if manual:
                cursor.execute("SAVEPOINT classdock_import")
            else:
                connection.begin()
            try:
                for start in range(0, total, IMPORT_CHUNK):
                    if import_cancelled():
                        raise ImportCancelled()
                    chunk = params[start:start + IMPORT_CHUNK]
                    # 청크마다 세이브포인트를 잡아 둔다. 실패한 청크가 절반만 넣은 상태로 남으면
                    # 어느 행이 문제인지 짚을 때 멀쩡한 행까지 중복 키로 걸린다.
                    cursor.execute("SAVEPOINT classdock_chunk")
                    try:
                        affected += int(cursor.executemany(sql, chunk) or 0)
                    except Exception as exc:                  # noqa: BLE001
                        cursor.execute("ROLLBACK TO SAVEPOINT classdock_chunk")
                        # KILL QUERY 로 executemany 가 깨어난 취소를 잘못된 파일 행으로 보고하지 않는다.
                        if import_cancelled():
                            raise ImportCancelled()
                        found = find_failing_row(cursor, sql, chunk, start)
                        raise ImportRowFailed(found[0] if found else start,
                                              found[1] if found else exc)
                    cursor.execute("RELEASE SAVEPOINT classdock_chunk")
                    done += len(chunk)
                    report({"done": done, "total": total}, force=done >= total)
                # 마지막 청크가 끝난 직후 들어온 취소도 COMMIT 전에 한 번 더 잡는다.
                if import_cancelled():
                    raise ImportCancelled()
            except BaseException as exc:                      # noqa: BLE001
                try:
                    if manual:
                        cursor.execute("ROLLBACK TO SAVEPOINT classdock_import")
                    else:
                        connection.rollback()
                except Exception:                             # noqa: BLE001
                    pass
                if isinstance(exc, ImportCancelled):
                    return {"ok": False, "code": "cancelled",
                            "detail": "적재를 중단했습니다.", "rows": 0, **tx_state()}
                if isinstance(exc, ImportRowFailed):
                    failure = error_payload(exc.cause, driver, "import")
                    # 몇 번째 행인지까지 말해야 사용자가 파일에서 그 줄을 찾을 수 있다.
                    failure["row"] = exc.row
                    failure["rows"] = 0
                    failure.update(tx_state())
                    return failure
                if isinstance(exc, RuntimeError):
                    return {"ok": False, "code": str(exc), "detail": str(exc), "rows": 0, **tx_state()}
                raise
            if manual:
                cursor.execute("RELEASE SAVEPOINT classdock_import")
            else:
                connection.commit()
    finally:
        _state["import"] = None
    if manual:
        _state["pending"] = True
    return {"ok": True, "rows": total, "affected": affected, "mode": mode,
            "table": str(request.get("table") or ""), "ms": elapsed_ms(started), **tx_state()}


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
    _state["table_meta"] = {}
    return {"ok": True, "database": name}


def kill_query(connection_id):
    """그 커넥션에서 도는 문장을 끊는다. 실행 중인 커넥션은 응답을 기다리느라 명령을 받을 수
    없으므로 같은 자격으로 새 커넥션을 열어 KILL QUERY 를 보낸다."""
    driver = import_driver()
    credentials = _state.get("credentials")
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


def cancel_running_query():
    kill_query(_state.get("connection_id"))


def cancel_running_dump():
    """덤프에 멈추라고 표시하고, 서버에서 돌고 있는 SELECT 도 끊는다.

    cancel_running_query() 로는 덤프가 멈추지 않는다. 그쪽은 세션 커넥션의 번호를 죽이는데
    덤프는 전용 커넥션에서 돌기 때문이다. 그 번호를 따로 들고 있다가 함께 끊는다.
    """
    dump = _state.get("dump")
    if not dump:
        return
    dump["cancel"] = True
    kill_query(dump.get("connectionId"))


def cancel_running_import():
    """적재에 멈추라고 표시한다.

    적재는 세션 커넥션에서 도므로 실행 중인 문장은 cancel_running_query() 가 이미 끊는다.
    여기서는 청크 사이에서 멈출 표시만 남긴다 — 마지막 청크가 막 끝난 순간에 들어온 취소도
    다음 청크를 시작하기 전에 잡힌다.
    """
    running = _state.get("import")
    if running:
        running["cancel"] = True


def import_cancelled():
    running = _state.get("import")
    return bool(running and running.get("cancel"))


class ImportCancelled(Exception):
    """적재를 사용자가 멈췄다. 여기까지 넣은 행은 통째로 되돌린다."""


class ImportRowFailed(Exception):
    """적재 도중 한 행이 서버에 거절당했다. 몇 번째 행인지 함께 들고 올라간다."""

    def __init__(self, row, cause):
        super(ImportRowFailed, self).__init__(str(cause))
        self.row = row
        self.cause = cause


def dump_cancelled():
    dump = _state.get("dump")
    return bool(dump and dump.get("cancel"))


class DumpCancelled(Exception):
    """덤프를 사용자가 멈췄다. 여기까지 적은 임시 파일은 지운다."""


def choose_script_delimiter(text, preferred=""):
    """본문에 없는 구분자를 고른다. 프런트의 chooseScriptDelimiter 와 같은 규칙이어야
    편집기에서 보던 스크립트와 덤프 파일이 같은 모양이 된다."""
    for token in [preferred, "$$", "//", ";;", "@@", "§§"]:
        if token and token != ";" and token not in text:
            return token
    return "§§"


def wrap_delimited_statement(statement, preferred=""):
    """세미콜론이 든 복합문을 DELIMITER 로 감싼다(프런트 wrapDelimitedStatement 와 같은 규칙)."""
    body = str(statement or "").strip()
    if not body:
        return ""
    delimiter = choose_script_delimiter(body, preferred)
    return "DELIMITER " + delimiter + "\n" + body + delimiter + "\nDELIMITER ;"


def remove_quietly(path):
    try:
        os.remove(path)
    except OSError:                                           # noqa: BLE001 - 지울 것이 없으면 그만이다
        pass


def dump_comment(text):
    """주석 한 줄에 넣을 값. 줄바꿈을 지워 뒤 내용이 주석 밖으로 새지 않게 한다."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def order_views(views):
    """뷰가 다른 뷰를 쓰면 쓰이는 쪽을 먼저 적는다.

    정의문에 상대 이름이 백틱째 나오는지로만 판단한다(뷰 정의를 파싱하지 않는다).
    서로 물고 도는 관계가 남으면 이름순으로 이어 붙이고 그 목록을 함께 돌려준다 —
    복원이 한 번에 끝나지 않을 수 있어 파일과 요약에 사실대로 남겨야 한다.
    """
    names = set(item["name"] for item in views)
    ordered, placed, remaining = [], set(), list(views)
    while remaining:
        movable = [item for item in remaining
                   if not set(other for other in names
                              if other != item["name"] and ("`" + other + "`") in item["ddl"]) - placed]
        if not movable:
            break
        for item in movable:
            ordered.append(item)
            placed.add(item["name"])
            remaining.remove(item)
    cyclic = sorted(item["name"] for item in remaining)
    ordered.extend(sorted(remaining, key=lambda item: item["name"]))
    return ordered, cyclic


class DumpWriter(object):
    """파일에 적으면서 얼마나 적었는지 세는 얇은 껍데기.

    텍스트 파일의 tell() 은 부를 때마다 버퍼 상태를 인코딩해 값이 비싸다. 진행 보고에 쓸
    대략의 크기는 적은 글자 수로 충분하다(최종 크기는 다 쓴 파일에서 다시 잰다).
    """

    def __init__(self, stream):
        self.stream = stream
        self.chars = 0

    def write(self, text):
        self.stream.write(text)
        self.chars += len(text)


def insert_chunks(prefix, literals, max_rows=DUMP_INSERT_ROWS, max_chars=DUMP_INSERT_CHARS):
    """행 리터럴을 INSERT 문장 여러 개로 나눈다.

    행 수와 길이 두 가지로 끊는다. 길이를 함께 보는 이유는 복원하는 서버의
    max_allowed_packet 을 넘긴 문장은 통째로 거절되기 때문이다. 한 행이 그것만으로
    상한을 넘으면 그 행만 담은 문장을 만든다 — 행은 더 쪼갤 수 없다.

    literals 를 흘려 받아 문장 단위로 내보낸다. 큰 테이블을 통째로 메모리에 올리지 않는다.
    """
    batch, size = [], 0
    for value in literals:
        if batch and (len(batch) >= max_rows or size + len(value) + 2 > max_chars):
            yield prefix + ",\n".join(batch) + ";\n"
            batch, size = [], 0
        batch.append(value)
        size += len(value) + 2
    if batch:
        yield prefix + ",\n".join(batch) + ";\n"


def dump_data_columns(cursor, name, schema):
    """데이터로 옮길 컬럼을 고른다. → (옮길 컬럼 이름, 테이블 전체 컬럼 수)

    생성 컬럼(GENERATED)은 뺀다. 값을 직접 넣으면 서버가 거절한다 — 구조 덤프의
    CREATE TABLE 이 식을 이미 담고 있어 복원할 때 다시 계산된다.

    전체 개수를 함께 돌려주는 이유는 부르는 쪽이 "컬럼을 뺐는지" 알아야 하기 때문이다.
    컬럼 목록 없는 INSERT 는 모든 컬럼의 값을 요구한다.
    """
    columns = column_definitions(cursor, name, schema)
    movable = [column["name"] for column in columns
               if not column["generationExpression"] and "GENERATED" not in column["extra"].upper()]
    return movable, len(columns)


def dump_counts_text(counts):
    return " · ".join("%s %d" % (DUMP_LABELS[kind], counts[kind]) for kind in DUMP_KINDS if counts[kind])


def dump_header(credentials, schema, counts, cyclic, mode="structure"):
    """복원할 때 걸리는 것들을 미리 풀어 둔다.

    · sql_mode 를 통째로 지정하는 이유는 NO_BACKSLASH_ESCAPES 를 확실히 끄기 위해서다.
      값에 쓴 백슬래시 표기가 그 모드에서는 데이터 자체가 되어 버린다.
    · 외래키 검사를 끄면 테이블 순서를 위상 정렬하지 않아도 복원된다.

    데이터 쪽 SET(UNIQUE_CHECKS·AUTOCOMMIT)은 여기 두지 않는다. DDL 은 실행하는 순간
    커밋되므로 트랜잭션은 데이터 구간 바로 앞에서 열어야 뜻이 있다.
    """
    host = dump_comment("%s:%s" % (credentials.get("host", ""), credentials.get("port", "")))
    titles = {"structure": "구조", "data": "데이터", "both": "구조 + 데이터"}
    lines = [
        "-- ClassDock SQL 덤프 (%s)" % titles.get(mode, mode),
        "-- 서버: %s · 데이터베이스: %s" % (host, dump_comment(schema)),
        "-- 만든 시각: %s" % time.strftime("%Y-%m-%d %H:%M:%S"),
        "-- 대상: %s" % (dump_counts_text(counts) or "없음"),
        "-- 복원하기 전에 넣을 데이터베이스를 먼저 고르세요. 이 파일에는 USE 문이 없습니다.",
    ]
    if cyclic:
        lines.append("-- ⚠ 서로를 참조하는 뷰가 있어 순서를 정하지 못했습니다: "
                     + dump_comment(", ".join(cyclic)))
    lines += [
        "",
        "/*!40101 SET NAMES utf8mb4 */;",
        "SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
        "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;",
        "SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='+00:00';",
        "",
    ]
    return "\n".join(lines)


def dump_footer(counts, rows=0):
    tail = dump_counts_text(counts) or "없음"
    if rows:
        tail += " · %s행" % format(rows, ",")
    return "\n".join([
        "",
        "SET TIME_ZONE=@OLD_TIME_ZONE;",
        "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;",
        "SET SQL_MODE=@OLD_SQL_MODE;",
        "",
        "-- 끝 · %s" % tail,
        "",
    ])


def dump_object_block(kind, item, drop_first, if_not_exists):
    name = item["name"]
    ddl = str(item["ddl"]).strip()
    if kind == "table" and if_not_exists:
        ddl = re.sub(r"^CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", ddl)
    lines = ["", DUMP_RULE, "-- %s `%s`" % (DUMP_LABELS[kind], dump_comment(name)), DUMP_RULE, ""]
    if drop_first:
        lines.append("DROP %s IF EXISTS %s;" % (OBJECT_KEYWORDS.get(kind, kind.upper()),
                                                quote_identifier(name)))
    lines.append(wrap_delimited_statement(ddl) if kind in DUMP_COMPOUND else ddl + ";")
    lines.append("")
    return "\n".join(lines)


def open_dump_connection(driver, consistent):
    """덤프 전용 커넥션을 연다. 세션 커넥션을 쓰지 않는 이유가 셋 있다.

    · 사용자가 열어 둔 트랜잭션(pending)을 덤프가 건드리면 안 된다.
    · 서버사이드 커서는 다 읽을 때까지 그 커넥션으로 다른 질의를 낼 수 없다.
    · 여러 테이블을 한 시점으로 뽑으려면 덤프만의 트랜잭션이 있어야 한다.

    자격은 접속할 때 받아 둔 것을 그대로 쓴다(취소용 커넥션과 같은 방식).
    """
    credentials = _state.get("credentials") or {}
    connection = driver.connect(
        host=credentials.get("host", "127.0.0.1"), port=int(credentials.get("port") or 3306),
        user=credentials.get("user", ""), password=credentials.get("password", ""),
        charset="utf8mb4", connect_timeout=15, autocommit=True,
    )
    connection_id = None
    try:
        with connection.cursor() as cursor:
            # 덤프는 읽기만 한다. 서버가 걸어 주면 실수로 쓰는 일이 없다.
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            # TIMESTAMP 는 세션 시간대로 변환되어 오므로 UTC 로 읽어야 다른 시간대에서
            # 복원해도 같은 순간을 가리킨다. 복원 파일의 데이터 구간도 UTC 로 맞춘다.
            cursor.execute("SET SESSION TIME_ZONE = '+00:00'")
            if consistent:
                # InnoDB 에서 이 시점의 스냅샷을 잡는다. 테이블마다 시점이 어긋나지 않는다.
                cursor.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT")
            # 취소가 이 커넥션의 SELECT 를 끊을 수 있어야 한다(세션 커넥션과 번호가 다르다).
            cursor.execute("SELECT CONNECTION_ID()")
            row = cursor.fetchone()
            connection_id = row[0] if row else None
    except Exception:                                         # noqa: BLE001 - 커넥션을 흘리지 않는다
        try:
            connection.close()
        except Exception:                                     # noqa: BLE001
            pass
        raise
    return connection, connection_id


def close_dump_connection(connection):
    if connection is None:
        return
    try:
        connection.rollback()                                 # 읽기 전용 스냅샷을 닫는다
    except Exception:                                         # noqa: BLE001
        pass
    try:
        connection.close()
    except Exception:                                         # noqa: BLE001
        pass


def write_table_data(out, connection, driver, schema, name, options, report=None, seen=None):
    """테이블 하나의 데이터를 INSERT 문으로 적는다.

    서버사이드 커서(SSCursor)로 흘려 읽는다. 기본 커서는 결과를 전부 메모리에 올려
    큰 테이블에서 워커가 죽는다. 대신 다 읽을 때까지 이 커넥션으로 다른 질의를 낼 수 없어,
    컬럼 목록 같은 메타데이터는 먼저 받아 둔다.
    """
    with connection.cursor() as meta:
        columns, total = dump_data_columns(meta, name, schema)
    if not columns:
        return 0, "no-columns"

    target = quote_identifier(schema) + "." + quote_identifier(name) if schema else quote_identifier(name)
    column_sql = ",".join(quote_identifier(column) for column in columns)
    form = DUMP_INSERT_FORMS[options["insertForm"]]
    # 생성 컬럼을 뺐다면 컬럼 목록을 반드시 적는다. 목록이 없는 INSERT 는 테이블의 모든
    # 컬럼에 값을 요구하므로 개수가 어긋나 복원이 통째로 실패한다.
    if options["columnNames"] or len(columns) != total:
        prefix = "%s %s (%s) VALUES\n" % (form, quote_identifier(name), column_sql)
    else:
        prefix = "%s %s VALUES\n" % (form, quote_identifier(name))
    select = "SELECT " + column_sql + " FROM " + target
    if options["rowLimit"]:
        select += " LIMIT %d" % options["rowLimit"]

    counter = {"rows": 0}

    def literals(rows):
        for row in rows:
            counter["rows"] += 1
            yield "(" + ",".join(sql_literal(value) for value in row) + ")"

    with connection.cursor(driver.cursors.SSCursor) as cursor:
        cursor.execute(select)
        for statement in insert_chunks(prefix, literals(cursor)):
            # 문장 하나가 200행이라 반응은 충분히 빠르다. 서버에서 도는 SELECT 는
            # cancel_running_dump() 의 KILL 이 따로 끊는다.
            if dump_cancelled():
                raise DumpCancelled()
            out.write(statement)
            if report:
                # 문장 하나마다 부르되, 실제로 나가는 빈도는 reporter 가 시간으로 누른다.
                report({"phase": "data", "object": name, "done": (seen or {}).get("done", 0),
                        "total": (seen or {}).get("total", 0),
                        "rows": (seen or {}).get("rows", 0) + counter["rows"],
                        "bytes": getattr(out, "chars", 0)})
    return counter["rows"], ""


def write_all_table_data(out, connection, driver, schema, tables, options, skipped, report=None):
    """테이블 데이터 구간. 구조를 모두 적은 뒤에 온다."""
    if not tables:
        return 0
    out.write("\n" + DUMP_RULE + "\n-- 데이터\n" + DUMP_RULE + "\n")
    # DDL 은 실행하는 순간 커밋되므로 트랜잭션은 데이터 바로 앞에서 연다.
    out.write("\nSET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;\n"
              "SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT;\n"
              "SET AUTOCOMMIT=0;\nSTART TRANSACTION;\n")
    total = 0
    seen = {"done": 0, "total": len(tables), "rows": 0}
    for item in tables:
        if dump_cancelled():
            raise DumpCancelled()
        name = item["name"]
        out.write("\n-- %s 데이터\n" % quote_identifier(name))
        if report:
            report({"phase": "data", "object": name, "done": seen["done"], "total": seen["total"],
                    "rows": seen["rows"], "bytes": getattr(out, "chars", 0)}, True)
        # 서버사이드 커서는 이미 쓴 INSERT 뒤에서 실패할 수 있다. 이 오류를 한 테이블의
        # 건너뜀으로 삼으면 일부 행만 든 파일이 성공 덤프가 되므로 전체를 실패시킨다.
        try:
            rows, reason = write_table_data(out, connection, driver, schema, name, options, report, seen)
        except Exception as exc:                              # noqa: BLE001
            if dump_cancelled():
                raise DumpCancelled() from exc
            raise
        if reason:
            out.write("-- ⚠ 옮길 수 있는 컬럼이 없어 건너뛰었습니다 (%s).\n" % reason)
            skipped.append({"kind": "data", "name": name, "reason": reason})
            continue
        out.write("-- (비어 있음)\n" if not rows else "-- (%s행)\n" % format(rows, ","))
        total += rows
        seen["done"] += 1
        seen["rows"] = total
    out.write("\nCOMMIT;\nSET AUTOCOMMIT=@OLD_AUTOCOMMIT;\n"
              "SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;\n")
    return total


def read_dump_definitions(cursor, schema, targets):
    """적기 전에 정의문을 모두 읽어 둔다.

    뷰 순서를 풀려면 모든 뷰의 정의가 있어야 하고, 뒤에 붙을 데이터 덤프는 서버사이드 커서가
    커넥션을 잡고 있는 동안 다른 질의를 낼 수 없어 메타데이터를 미리 받아 두어야 한다.
    """
    loaded = dict((kind, []) for kind in DUMP_KINDS)
    skipped = []
    for target in targets:
        if dump_cancelled():
            raise DumpCancelled()
        kind, name = target["kind"], target["name"]
        try:
            ddl = (show_create_table(cursor, name, schema) if kind in ("table", "view")
                   else show_create_object(cursor, kind, name, schema))
        except Exception as exc:                              # noqa: BLE001 - 한 객체 때문에 덤프 전체를 접지 않는다
            # KILL QUERY 가 만든 드라이버 예외를 권한 오류처럼 건너뛰면 마지막 객체의
            # 취소가 성공 덤프로 바뀐다.
            if dump_cancelled():
                raise DumpCancelled() from exc
            # 드라이버 메시지에는 접속 정보가 섞여 나오는 경우가 있어 분류한 코드만 남긴다.
            skipped.append({"kind": kind, "name": name, "reason": classify_error(exc, None)[0]})
            continue
        if not str(ddl or "").strip():
            # 본문을 볼 권한이 없으면 SHOW CREATE 가 빈 값을 준다(오류가 아니다).
            skipped.append({"kind": kind, "name": name, "reason": "no-definition"})
            continue
        loaded[kind].append({"name": name, "ddl": str(ddl)})
    return loaded, skipped


def write_schema_dump(out, cursor, schema, targets, options, mode="structure", data_source=None,
                      driver=None, report=None):
    if report:
        report({"phase": "schema", "object": "", "done": 0, "total": len(targets),
                "rows": 0, "bytes": 0}, True)
    loaded, skipped = read_dump_definitions(cursor, schema, targets)
    if mode == "data":
        # 데이터만 뽑는 요청에 테이블 아닌 것이 섞였다. 조용히 빼지 않고 요약에 남긴다.
        for kind in DUMP_KINDS:
            if kind == "table":
                continue
            skipped.extend({"kind": kind, "name": item["name"], "reason": "data-only"}
                           for item in loaded[kind])
            loaded[kind] = []
    loaded["view"], cyclic = order_views(loaded["view"])
    counts = dict((kind, len(loaded[kind])) for kind in DUMP_KINDS)
    out.write(dump_header(_state.get("credentials") or {}, schema, counts, cyclic, mode))
    rows = 0
    for kind in DUMP_KINDS:
        if mode != "data":
            for item in loaded[kind]:
                out.write(dump_object_block(kind, item, options["dropIfExists"], options["createIfNotExists"]))
        # 구조를 모두 적은 뒤에 데이터가 온다(뷰·루틴은 데이터 뒤로 밀린다).
        if kind == "table" and data_source is not None:
            rows = write_all_table_data(out, data_source, driver, schema, loaded["table"], options,
                                        skipped, report)
    if skipped:
        out.write("\n-- ⚠ 아래 객체는 정의를 가져오지 못해 이 파일에 들어 있지 않습니다.\n")
        for item in skipped:
            out.write("--    %s `%s` (%s)\n"
                      % (DUMP_LABELS.get(item["kind"], item["kind"]), dump_comment(item["name"]),
                         item["reason"]))
    out.write(dump_footer(counts, rows))
    return {"counts": counts, "skipped": skipped, "cyclicViews": cyclic, "rows": rows}


def dump_targets(objects):
    """요청의 대상 목록을 검사해 (종류, 이름) 으로만 남긴다."""
    if not isinstance(objects, list) or not objects:
        return None, {"ok": False, "code": "dump-no-objects", "detail": "내보낼 객체가 없습니다."}
    if len(objects) > MAX_DUMP_OBJECTS:
        return None, {"ok": False, "code": "dump-too-many", "detail": str(len(objects))}
    targets = []
    for item in objects:
        kind = str((item or {}).get("kind") or "").lower()
        name = str((item or {}).get("name") or "")
        if kind not in DUMP_KINDS or not name or len(name) > MAX_DUMP_NAME:
            return None, {"ok": False, "code": "dump-bad-object", "detail": kind + ":" + name[:MAX_DUMP_NAME]}
        targets.append({"kind": kind, "name": name})
    return targets, None


def dump_options(raw):
    """요청 옵션에 기본값을 채운다. 모르는 값이 오면 가장 안전한 쪽으로 되돌린다."""
    raw = raw or {}
    form = str(raw.get("insertForm") or "insert").lower()
    if form not in DUMP_INSERT_FORMS:
        form = "insert"
    try:
        limit = max(0, int(raw.get("rowLimit") or 0))         # 0 = 전체
    except (TypeError, ValueError):
        limit = 0
    return {
        "dropIfExists": bool(raw.get("dropIfExists", True)),
        "createIfNotExists": bool(raw.get("createIfNotExists", False)),
        "insertForm": form,
        "columnNames": bool(raw.get("columnNames", True)),
        "rowLimit": limit,
        "consistent": bool(raw.get("consistent", True)),
    }


def dump_schema(request):
    """고른 스키마 객체를 SQL 파일 하나로 적는다.

    파일 경로는 런처가 정해서 넘긴다. 워커는 받은 경로에 쓰기만 한다 — 저장 위치 정책
    (SaveRoot 아래로 제한)은 런처가 쥐고 있어야 하고, 여기서 경로를 만들면 그 정책이 뚫린다.

    읽기 전용 접속에서도 할 수 있다. SELECT 와 SHOW 만 쓰기 때문이다.
    """
    connection = require_connection()
    path = str(request.get("path") or "")
    if not path.lower().endswith(".sql"):
        return {"ok": False, "code": "dump-bad-path", "detail": "덤프 파일 이름이 .sql 이 아닙니다."}
    mode = str(request.get("mode") or "structure")
    if mode not in DUMP_MODES:
        return {"ok": False, "code": "dump-mode-unsupported", "detail": mode}
    targets, failure = dump_targets(request.get("objects"))
    if failure:
        return failure
    options = dump_options(request.get("options"))
    needs_data = mode in ("data", "both")
    driver = import_driver()
    if driver is None:
        return {"ok": False, "code": "driver-missing", "detail": "pymysql 이 설치되어 있지 않습니다."}

    started = time.perf_counter()
    temp = path + ".part"
    dump_connection = None
    # 취소 요청은 stdin 리더 스레드가 처리한다(덤프 중에는 이 스레드가 막혀 있다).
    # 여기에 표시를 남겨야 그쪽에서 "지금 덤프가 돌고 있다"는 것을 알 수 있다.
    _state["dump"] = {"cancel": False, "connectionId": None, "temp": temp}
    try:
        # 구조만 뽑아도 전용 UTC 커넥션을 쓴다. TIMESTAMP 데이터뿐 아니라 EVENT 정의의
        # 시각도 같은 기준으로 읽고, 사용자가 열어 둔 세션 상태는 전혀 바꾸지 않는다.
        dump_connection, dump_id = open_dump_connection(driver, needs_data and options["consistent"])
        _state["dump"]["connectionId"] = dump_id
        source = dump_connection
        # 다 적은 뒤에만 진짜 이름으로 바꾼다. 중간에 끊겨도 반쪽짜리 파일이 정상 덤프처럼 남지 않는다.
        report = progress_reporter()
        with open(temp, "w", encoding="utf-8", newline="\n") as raw:
            out = DumpWriter(raw)
            with source.cursor() as cursor:
                schema = current_schema(cursor, str(request.get("database") or ""))
                summary = write_schema_dump(out, cursor, schema, targets, options, mode,
                                            dump_connection if needs_data else None, driver, report)
        # 마지막 서버 작업이 끝난 직후 들어온 취소도 정상 파일로 바꾸기 전에 한 번 더 잡는다.
        if dump_cancelled():
            raise DumpCancelled()
        os.replace(temp, path)
    except DumpCancelled:
        # 여기까지 적은 것은 반쪽짜리다. 파일을 남기지 않아야 "받다 만 백업"이 생기지 않는다.
        remove_quietly(temp)
        return {"ok": False, "code": "cancelled", "detail": "덤프를 취소했습니다.", "path": path}
    except OSError as exc:
        remove_quietly(temp)
        return {"ok": False, "code": "dump-write-failed", "detail": str(exc)}
    except BaseException:
        remove_quietly(temp)
        raise
    finally:
        _state["dump"] = None
        close_dump_connection(dump_connection)
    return {"ok": True, "path": path, "database": schema, "mode": mode,
            "bytes": os.path.getsize(path), "ms": elapsed_ms(started), **summary}


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
        if action == "dependencies":
            return load_dependencies(str(request.get("kind") or ""), str(request.get("name") or ""),
                                     str(request.get("table") or ""), str(request.get("database") or ""))
        if action == "schema-columns":
            return schema_columns(str(request.get("database") or ""))
        if action == "dump":
            return dump_schema(request)
        if action == "erd":
            return load_erd(str(request.get("database") or ""))
        if action == "page":
            return read_page(int(request.get("set") or 0), int(request.get("offset") or 0),
                             int(request.get("limit") or KEEP_PAGE))
        if action == "use":
            return use_database(str(request.get("name") or ""))
        if action == "query":
            return run_statements(str(request.get("sql") or ""), driver)
        if action == "cell-read":
            return read_cell(request)
        if action == "apply-edits":
            return apply_edits(request)
        if action == "import-rows":
            return import_rows(request, driver)
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
            cancel_running_dump()                             # 덤프는 전용 커넥션이라 따로 끊는다
            cancel_running_import()                           # 적재는 청크 사이에서 멈춘다
            continue
        if action == "close":
            # 실행 스레드는 daemon 이라 메인 루프가 바로 끝나면 finally 가 돌기 전에
            # 프로세스가 사라져 .part 파일이 남는다. 먼저 작업을 끊고 정리를 기다린다.
            cancel_running_query()
            cancel_running_dump()
            cancel_running_import()
            requests.put(None)
            break
        requests.put(request)
    connection = _state.get("connection")
    if connection is not None:
        try:
            connection.close()
        except Exception:                                     # noqa: BLE001
            pass
    worker.join(4.0)
    dump = _state.get("dump")
    if dump and dump.get("temp"):
        remove_quietly(dump.get("temp"))


if __name__ == "__main__":
    main()
