# DB 클라이언트 — 결과 표 붙여넣기 · CSV/엑셀 데이터 적재 설계

> 검토 대상: (1) 결과 그리드 붙여넣기, (2) CSV·엑셀 → 테이블 적재(import).
> 기준 코드는 `src/js/db-client.js`(5,473줄) · `desktop/launcher.cs` · `desktop/db_worker.py` 현재 상태다.
> 상위 설계는 `docs/DB클라이언트-설계.md` 를 따르고, 그 문서의 원칙(값은 SQL 에 이어 붙이지 않는다 ·
> 문장은 언제나 워커가 만든다 · 읽기 전용은 서버에서 건다)을 이 두 기능도 그대로 지킨다.

## 0. 검토 결론

두 기능 모두 **할 만하다.** 다만 성격이 완전히 다르므로 하나의 기능으로 묶지 않는다.

| | 붙여넣기 | CSV/엑셀 적재 |
|---|---|---|
| 대상 | 이미 조회된 행의 **기존 값 고치기**(UPDATE) | **새 행 넣기**(INSERT) |
| 규모 | 수십~수백 칸 | 수천~수만 행 |
| 경로 | 기존 변경 목록(`staged`) → `/db-apply` | 새 적재 작업 → `/db-import` |
| 서버 변경 | **없음** (프런트만) | 런처 + 워커 신규 |
| 되돌리기 | 적용 전 `모두 취소` | 실패 시 전체 롤백 |

역할이 이렇게 갈리면 사용자에게 설명할 문장도 한 줄로 떨어진다 —
**"고치는 것은 붙여넣기, 넣는 것은 적재."** 붙여넣기로 대량 적재를 시도하는 길(변경 500건 상한)은
막아 두고 그때 적재 창을 안내한다.

### 붙여넣기 — 왜 쉬운가

이미 있는 것을 조립하기만 하면 된다.

- 선택 계산: `MNGridSelection.gridSelectionBoundsFromKeys` (`grid-selection.js`)
- 클립보드 표 파싱: `parseClipboardTable` (`spreadsheet-viewer.js:1514`, 전역 함수 · 모듈 export 도 되어 있음)
- 칸별 편집 가능 판정: `cellEditContext(row, col)` (`db-client.js:1963`)
- 변경 담기: `stageUpdate(edit, value, isNull)` (`db-client.js:2084`)
- 미리보기·적용·되돌리기: 변경 바 · `openChangesModal` · `applyStaged` 전부 그대로

즉 새로 쓸 것은 **"붙여넣은 격자를 선택 좌상단부터 칸에 대응시키고 `stageUpdate` 를 반복 호출하는 루프"**
하나와 그 결과 보고뿐이다. 서버·런처·워커는 한 줄도 건드리지 않는다.

### 적재 — 왜 프런트만으로는 안 되는가

"편집기에 INSERT 문을 붙여 넣는다"는 손쉬운 길이 있지만 쓰지 않는다. 이유가 셋이다.

1. **값을 SQL 에 이어 붙이게 된다.** 설계 문서가 명시적으로 금지한 것이다. 따옴표·NULL·숫자·날짜 구분을
   프런트가 떠맡는 순간 `O'Brien` 한 줄에 무너지고, 그게 곧 SQL 주입 경로가 된다.
2. **편집기가 버틴다는 보장이 없다.** 1만 행이면 INSERT 텍스트가 수 MB다. `SQL_IMPORT_WARN`(1MB)에서
   이미 "편집기가 느려집니다"라고 묻고 있는 크기다.
3. **되돌릴 수 없다.** 편집기 실행은 문장 단위라 중간에 실패하면 앞의 5천 행만 들어간 채로 남는다.

그래서 적재는 `/db-apply` 와 같은 규약 — **이름과 값만 실어 보내고 문장은 워커가 만든다** — 위에
장시간 작업 규약(`/db-dump` 의 job + 폴링 + 취소)을 얹는다. 새로 만드는 구조가 아니라 이미 있는
두 구조의 교집합이다.

---

# 기능 A. 결과 표 붙여넣기

## A-1. 무엇을 한다 / 하지 않는다

**한다**

- 엑셀·구글시트·다른 결과 표에서 복사한 TSV 블록을 선택 좌상단부터 칸에 채워 **변경 목록에 담는다.**
- 값 하나만 복사했으면 선택한 칸 **전체를 그 값으로 채운다**(엑셀과 같은 규칙).
- 담긴 칸은 기존과 똑같이 노랗게 칠하고, 미리보기에 `UPDATE` 문장이 그대로 나온다.

**하지 않는다**

- **행을 늘리지 않는다.** 표 아래로 넘친 행은 버리고 몇 행을 버렸는지 알린다.
  결과 표의 행은 서버의 행이지 시트의 칸이 아니다. 넘친 만큼 INSERT 를 만들면 기본키를 프런트가
  지어내야 하고, "붙여넣었더니 행이 생겼다"는 것은 되돌리기 어려운 결과다. 행을 넣는 길은 `행 추가` 와 적재다.
- **열을 늘리지 않는다.** 오른쪽으로 넘친 열도 같은 규칙으로 버린다.
- **바로 서버에 보내지 않는다.** 붙여넣기는 언제나 "담기"까지다.

## A-2. 값 규칙

| 입력 | 결과 | 까닭 |
|---|---|---|
| 보통 글자 | 그 값으로 UPDATE | |
| 빈 칸 | **빈 문자열** | 엑셀의 빈 칸은 빈 문자열이다. NULL 로 바꾸면 되돌릴 수 없는 뜻을 추측하는 셈이다 |
| `NULL` 이라는 글자 | 글자 `NULL` | 마법을 넣지 않는다. 값으로 `NULL` 을 넣고 싶은 사람이 진짜로 있다 |
| `Ctrl+Shift+V` | 빈 칸을 **NULL** 로 | `복사(Ctrl+C)` 가 NULL 을 빈칸으로 내보내므로, 되돌려 붙이는 길을 하나 둔다 |
| 원래 값과 같음 | 담지 않음 | `stageUpdate` 가 이미 그렇게 동작한다 |

붙여넣기 뒤 토스트에 규칙을 함께 적는다 —
`24칸을 담았어요 · 빈 칸 3개는 빈 문자열입니다(Ctrl+Shift+V 는 NULL)`.

## A-3. 건너뛰는 칸

한 칸이라도 막히면 붙여넣기 전체를 실패시키지 않는다. **담을 수 있는 칸만 담고 나머지는 세어서 보고한다.**
막히는 사유는 이미 `cellEditContext` 가 문장으로 돌려주므로 사유별 첫 문장만 토스트에 싣는다.

- 고칠 수 없는 열(조인·계산식·뷰) — `cellPlan.editable === false`
- 지우려고 담아 둔 행 — `stagedDelete(row)`
- 기본키 값을 짚지 못하는 행 — `rowKeyValues(row).error`
- 잘려 온 기본키(`db-clipped`)

보고 문장: `24칸 담기 · 6칸 건너뜀(고칠 수 없는 열입니다)`.
담긴 칸이 0이면 담지 않고 사유만 띄운다.

## A-4. 한도

- 붙여넣기로 새로 담기는 칸 + 이미 담아 둔 변경이 **500건**(`MAX_STAGED`, 워커의 `MAX_BATCH_CHANGES` 와 같은 값)을 넘으면
  **하나도 담지 않고** 거절한다. 절반만 담기면 사용자가 어디까지 들어갔는지 알 수 없다.
- 거절 문구는 대안을 함께 말한다:
  `한 번에 담을 수 있는 변경은 500건까지입니다(붙여넣으려는 칸 1,240개). 먼저 적용하거나, 새 행을 넣는 것이라면 데이터 적재를 써 주세요.`
- 붙여넣기 격자가 100행을 넘으면 담기 전에 한 번 확인한다(`stageDeleteRows` 가 10행에서 묻는 것과 같은 이유).

## A-5. 흐름

```text
결과 표에 포커스 → Ctrl+V
  │
  ├─ 쓰기 허용 접속인가 · plan.editable 인가        아니면 → 사유 토스트
  ├─ clipboardData 텍스트 → parseClipboardTable()   → 격자
  ├─ 값 1개 격자면 선택 전체 채우기로 확장
  ├─ 선택 좌상단(bounds.row1, col1) 기준으로 잘라내기(표 밖 버림)
  ├─ 담을 칸 수 + stagedCount() > 500 → 전부 거절
  ├─ 100행 초과면 확인창
  └─ 칸마다 cellEditContext() → stageUpdate() → 성공·건너뜀 집계
        → paintStagedCell 로 이미 칠해짐 · refreshEditBar()
        → 토스트로 결과 보고
```

## A-6. 함께 붙이는 것: 결과 표 오른쪽 버튼 메뉴  ✅ 구현됨

지금 결과 표에는 우클릭 메뉴가 없었다(스키마 트리에만 `openTableContextMenu` 가 있다).
붙여넣기는 키보드로만 있으면 발견되지 않으므로 작은 메뉴를 함께 만들었다.
항목마다 단축키를 오른쪽에 적어 메뉴가 단축키를 가르치는 자리도 되게 한다.

- 복사 `Ctrl+C` · 붙여넣기 `Ctrl+V` · 빈 칸을 NULL 로 붙여넣기 `Ctrl+Shift+V`
- ─ 값 보기·고치기 `F2` · 행 추가 · 행 삭제 담기(쓰기 허용 접속에서만)
- ─ CSV로 내보내기 · 선택(또는 전체) 메모로

메뉴 껍데기와 닫기 규칙(`tableContextMenu` · `closeTableContextMenu` · 바깥 클릭 · Escape)은
스키마 트리 메뉴의 것을 그대로 쓴다 — 두 메뉴가 동시에 열리지 않는다.
고른 범위 밖을 누르면 그 칸을 먼저 고르고, 범위 안을 누르면 선택을 지킨 채 메뉴만 연다.
키보드로도 열린다(`ContextMenu` 키 · `Shift+F10`).

**적재(기능 B) 진입점은 아직 넣지 않았다.** 하는 일이 없는 항목을 미리 두면 메뉴가 거짓말을 한다.
B-2 에서 `db-import.js` 가 생길 때 이 메뉴와 스키마 트리 메뉴에 함께 넣는다.

## A-7. 붙일 자리 (기능 A)  ✅ 구현됨

| 파일 | 한 일 |
|---|---|
| `src/js/grid-selection.js` | `gridClipboardTable`(클립보드 글자 → 격자)과 `gridPastePlan`(격자 → 채울 칸 목록)을 추가. 순수 계산이라 두 표가 함께 쓰고 테스트가 여기에 붙는다 |
| `src/js/spreadsheet-viewer.js` | 자기 `parseClipboardTable` 을 지우고 위 함수를 이름만 바꿔 받는다(`gridClipboardTable: parseClipboardTable`). 부르는 자리와 module.exports 는 그대로다 |
| `src/js/db-client.js` | `pasteGridSelection`(담기·보고) · `pasteAnchor` · `pasteSpots` · `requestPaste`(메뉴용 클립보드 읽기) · `openGridContextMenu`, 그리고 표의 `paste` · `contextmenu` · `Ctrl+Shift+V` · `ContextMenu` 키 처리 |
| `src/js/icons.js` | 메뉴에 쓸 `copy` · `paste` 아이콘 |
| `src/styles.css` | `.db-context-label` · `.db-context-hint`(단축키) · `.db-context-top`(구분선) |
| `사용법.md` | DB 절에 붙여넣기(12)와 우클릭 메뉴(13) 항목 추가 → `npm run build:manual` 로 `사용법.html` 재생성 |
| `scripts.manifest.json` | 변경 없음. `db-client.js` 는 이미 `grid-selection.js` 에 의존하고 로드 순서도 그대로다 |

### 왜 파서를 `grid-selection.js` 로 옮겼나

`parseClipboardTable` 은 `spreadsheet-viewer.js`(5.6천 줄) 안에 있었다. DB 클라이언트가 그것을
그대로 부르면 무거운 모듈에 의존이 생기고, 복사(`gridSelectionToText`)와 붙여넣기 파서가
서로 다른 파일에 흩어진다. 두 표가 서로 복사·붙여넣기를 하므로 규칙이 갈라지면 한쪽에서
복사한 것이 다른 쪽에서 어긋난다. 내보내는 쪽과 읽는 쪽을 한 파일에 둔다.

### Ctrl+V 와 Ctrl+Shift+V 를 다르게 받는 까닭

`Ctrl+V` 는 `paste` 이벤트가 클립보드 글자를 함께 실어 온다 — 권한을 따로 묻지 않는 이 길이 낫다.
`Ctrl+Shift+V` 는 keydown 에서 막고 `navigator.clipboard.readText()` 로 직접 읽는다. 막지 않으면
뒤따라오는 `paste` 이벤트가 같은 블록을 한 번 더 붙인다. 메뉴에서 고른 붙여넣기도 같은 길을 쓰고,
웹뷰가 읽기를 거절하면 단축키를 안내한다 — 읽지 못한 것을 "붙여넣을 내용이 없다"로 말하면
사용자가 클립보드를 의심하게 된다.

## A-8. 테스트 (기능 A)

`tests/db-client.test.js` 에 순수 함수 기준으로 붙인다.

- 격자가 선택 범위를 넘칠 때 넘친 행·열이 버려지고 그 수가 보고되는지
- 1×1 격자가 선택 전체를 채우는지
- 빈 칸이 기본 규칙에서 빈 문자열, NULL 모드에서 NULL 로 가는지 / `"NULL"` 글자가 NULL 이 되지 않는지
- 500건 상한을 넘기면 **하나도** 담기지 않는지(부분 적용 금지)
- 붙여넣기 경로가 `stageUpdate` 를 거치는지 = 값이 `/db-apply` 본문에만 실리고 SQL 문자열 조립이 없는지
  (소스 grep: 붙여넣기 코드에 `"UPDATE "` 문자열 연결이 없어야 한다)

---

# 기능 B. CSV/엑셀 → 테이블 적재

## B-1. 사용자 흐름

```text
① 대상 고르기   스키마 트리 우클릭 → "CSV·엑셀 적재"  또는 툴바 [데이터 적재]
                (툴바에서 열면 창 안에서 테이블을 고른다. 내보내기 ↔ 적재가 짝이 된다)
        ▼
② 파일 고르기   .csv / .tsv / .txt / .xlsx / .xls
                CSV: 인코딩 자동 판정(detectTextEncoding) · 구분자 자동 추정 → 둘 다 수정 가능
                XLSX: MNLazy.tryNeed("xlsx") 로 SheetJS 를 불러 시트 하나를 고른다
        ▼
③ 미리보기      앞 100행만 격자로 그린다. "첫 줄은 머리글" 스위치.
                건너뛸 앞줄 수(머리말이 있는 보고서용).
        ▼
④ 컬럼 매핑     왼쪽 = 테이블 컬럼(/db-table?mode=info 로 읽은 정의)
                오른쪽 = 파일 열 선택(자동 매칭: 이름 소문자·공백 제거 후 일치)
                고르지 않은 컬럼 = 서버 기본값 (AUTO_INCREMENT 는 처음부터 비움)
                사전 검사: NOT NULL 인데 빈 칸이 있는 행 수, 길이 초과 의심 열
        ▼
⑤ 확인          "school.students 에 1,240행을 넣습니다.
                 매핑: id←(기본값) · name←이름 · grade←학년 …
                 중복키: 실패 시 전체 취소 · 자동 커밋: 켜짐"
        ▼
⑥ 적재          진행 막대(넣은 행 / 전체) · [취소]
        ▼
⑦ 결과          "1,240행 넣었어요 · 3.2초"   또는
                "412번째 행에서 멈췄습니다(파일 413줄): grade 컬럼에 'A+' 를 넣을 수 없습니다.
                 아무것도 반영되지 않았습니다."
                [적재한 테이블 열기] 버튼
```

## B-2. 값 규칙

파일의 칸은 전부 글자다. **글자를 어떻게 값으로 볼 것인지를 프런트가 정하고, 변환은 서버가 한다.**
프런트는 `(값 문자열, NULL 여부)` 두 가지만 정해서 보낸다 — `/db-apply` 의 insert 와 똑같은 모양이다.

| 항목 | 기본 | 설명 |
|---|---|---|
| 빈 칸 | **NULL** | 붙여넣기와 정반대다. 적재는 새 행을 만드는 일이라 "값이 없다"가 자연스럽고, 대부분의 CSV 도구가 그렇게 한다. 창에서 `빈 문자열` 로 바꿀 수 있다 |
| NULL 표기 | (없음) | `\N` · `NULL` · `-` 처럼 파일이 쓰는 표기를 직접 적으면 그 값도 NULL 로 본다 |
| 앞뒤 공백 | 그대로 | `공백 다듬기` 스위치로 끌 수 있게 켜 두지 않는다 — 조용히 값을 바꾸지 않는다 |
| 숫자 | 그대로 문자열 | 서버가 컬럼 자료형으로 변환한다. `1,234` 같은 천 단위 쉼표는 **고치지 않고 실패시킨다**(strict 모드) |
| 날짜(CSV) | 그대로 문자열 | MySQL 이 `YYYY-MM-DD` 를 받는다. 다른 모양은 실패하고 몇 번째 행인지 알린다 |
| 날짜(XLSX) | `YYYY-MM-DD[ HH:MM:SS]` | 엑셀은 날짜를 숫자로 들고 있다. `cellDates:true` 로 읽어 프런트에서 한 번만 문자열로 굳힌다. 그러지 않으면 `45231` 이 들어간다 |
| 불리언 | 그대로 | `TRUE`/`FALSE` 는 MySQL 이 받는다. `Y`/`N` 은 받지 않으므로 실패한다 |

**조용히 고치지 않는다**가 이 표 전체의 원칙이다. 값을 추측해 넣으면 어디가 틀어졌는지 아무도 모른다.
실패는 몇 번째 행 · 어느 컬럼 · 어떤 값인지까지 말해 준다.

## B-3. 중복키 모드

| 모드 | 문장 | 화면 문구 |
|---|---|---|
| `insert`(기본) | `INSERT INTO … VALUES (…)` | 같은 키가 있으면 **전체 취소** |
| `ignore` | `INSERT IGNORE INTO …` | 같은 키인 행은 건너뛰기 (건너뛴 수 보고) |
| `update` | `INSERT … ON DUPLICATE KEY UPDATE` | 같은 키인 행은 **덮어쓰기** |

`REPLACE INTO` 는 넣지 않는다. 그것은 DELETE + INSERT 라 외래키 `ON DELETE CASCADE` 가 딸린
자식 행을 말없이 지운다. 적재 창에서 낼 수 있는 결과가 아니다.

`ignore` 는 자료형 오류까지 경고로 낮춘다는 점을 문구에 적는다 — "건너뛴 행"이 중복 때문인지
값이 틀려서인지 모르게 되므로 기본으로 두지 않는다.

## B-4. 서버 구조  ✅ 구현됨

### 로컬 API (신규 1개, 폴링·취소는 기존 것 재사용)

```text
POST /db-import?id=      적재 시작. 즉시 { job } 반환
GET  /db-query-poll?job= 진행/결과            (기존 것 그대로)
POST /db-query-cancel?job= 취소               (기존 것 그대로)
```

`/db-dump` 가 `/db-dump-poll` 을 따로 두었지만 실제 구현은 `PollDbQuery` 하나다
(`launcher.cs:2599`). 적재는 새 폴링 엔드포인트를 만들지 않고 `/db-query-poll` 을 쓴다.

### 본문 (길이 접두 문자열 — `/db-apply` · `/db-dump` 와 같은 규약)

```text
database, table, mode(insert|ignore|update),
컬럼수 N, [컬럼이름 × N],
행수 R, [ (값, NULL플래그) × N ] × R
```

⚠ `/db-apply` · `/db-dump` 와 같은 함정이 있다 — **프런트가 싣는 차례와 런처가 읽는 차례가 어긋나면
값이 엉뚱한 컬럼으로 들어간다.** 테스트로 두 쪽을 같은 자리에서 함께 본다(기존 테스트와 같은 방식).

### 런처 (`DbImportRequest`)

- 본문 상한 **8MB**, 컬럼 512개(`MAX_INSERT_VALUES`), 행 10,000, 총 100,000셀에서 거절
- 테이블·컬럼 이름은 `DbCheckField` 로 길이·문자 검사
- `mode` 는 아는 세 값만 통과
- SQL 을 만들지 않는다. JSON 으로 옮겨 `{"action":"import-rows", …}` 로 워커에 넘긴다
- `/db-dump` 와 같은 방식으로 `DbQueryJob` 을 만들고 백그라운드 스레드에서 `DbExchange`(진행 콜백 포함)

### 워커 (`import_rows(request)`)

```python
if _state["read_only"]: return read-only-blocked      # 판정 이전에 잠근다
target  = table_target(request)                       # 이름은 전부 quote_identifier
columns = [quote_identifier(name) for name in …]
sql     = "INSERT [IGNORE] INTO t (c1, c2) VALUES (%s, %s) [ON DUPLICATE KEY UPDATE c1=VALUES(c1) …]"

manual = not _state["auto_commit"]
SAVEPOINT classdock_import  /  connection.begin()     # apply_edits 와 같은 규칙
for chunk in 500행씩:
    if cancelled: raise ImportCancelled
    cursor.executemany(sql, chunk)                    # pymysql 이 다중 VALUES 로 다시 씀
    report({"done": n, "total": R})                   # progress_reporter() 로 눌러서
RELEASE SAVEPOINT / commit
```

- **문장은 여기서만 만든다.** 값은 언제나 `%s` 자리표시자로 간다.
- **한 묶음으로 되돌린다.** 실패·취소하면 `ROLLBACK TO SAVEPOINT`(수동 커밋) 또는
  `connection.rollback()`(자동 커밋). 절반만 들어간 적재는 없다.
  수동 커밋 모드에서 사용자가 앞서 쌓아 둔 변경까지 날리지 않기 위해 세이브포인트를 쓰는 이유도 `apply_edits` 와 같다.
- **실패한 행을 짚어 준다.** 청크 안에서 터지면 그 청크만 한 행씩 다시 돌려 몇 번째 행인지 찾고
  `{"code":"import-row-failed", "row": i, "column": …, "detail": …}` 로 보고한 뒤 전체를 되돌린다.
  (다시 도는 비용은 최대 500행이고, 실패했을 때만 낸다.)
- **취소**는 세션 커넥션에서 돌므로 기존 `cancel_running_query()`(KILL QUERY)가 이미 닿는다.
  덤프처럼 전용 커넥션을 두지 않으니 `cancel_running_dump()` 같은 별도 경로가 필요 없다.
  청크 사이에서 플래그를 한 번 더 본다.
- 적재 뒤 수동 커밋 모드면 `_state["pending"] = True` — 커밋 대기 배지가 그대로 뜬다.

### 왜 세션 커넥션에서 도는가

덤프는 전용 커넥션을 쓴다(사용자 트랜잭션을 건드리지 않으려고). 적재는 반대다 —
수동 커밋 사용자가 **적재 결과를 보고 롤백할 수 있어야** 하므로 사용자의 트랜잭션 안에서 돌아야 한다.
그래서 세션 커넥션을 쓰고, 대신 적재가 도는 동안 같은 세션의 다른 작업은 런처가 이미 직렬화한다.

### 실패한 행을 어떻게 짚는가

`executemany` 는 500행을 한 문장으로 묶어 보내므로 실패해도 "몇 번째 행"이 나오지 않는다.
그래서 청크마다 세이브포인트를 잡아 두고, 실패하면 **① 그 청크만 되돌리고 ② 한 행씩 다시
넣어 보며 몇 번째에서 터지는지 찾은 뒤 ③ 그 탐색도 되돌리고 ④ 적재 전체를 되돌린다.**

①이 없으면 안 된다. 실패한 청크가 절반쯤 넣은 상태로 남아 있으면, 다시 넣어 볼 때 멀쩡한
앞 행들이 "중복 키"로 걸려 엉뚱한 행을 범인으로 지목한다. 다시 도는 비용은 최대 500행이고
실패했을 때만 낸다.

행 번호는 워커가 "보낸 행 중 몇 번째"로 주고, 화면이 그것을 **파일의 줄 번호**로 옮긴다
(빈 줄을 건너뛰므로 둘이 어긋난다 — `importPlan` 이 행마다 원래 줄 번호를 함께 들고 있다).

## B-5. 한도

| 항목 | 값 | 까닭 |
|---|---|---|
| 파일 크기 | 20MB | 읽고 파싱하는 쪽(프런트) 한계 |
| 행 | 10,000 | 본문 8MB 안에 들어가는 현실적인 크기 |
| 셀 | 100,000 | 행 × 열 폭주 방지 |
| 컬럼 | 512 | `MAX_INSERT_VALUES` 와 같은 값 |
| 값 하나 | 65,535자 | 넘으면 그 행을 짚어 거절 |
| 청크 | 500행 | `executemany` 한 번의 크기. `max_allowed_packet` 을 넘기지 않는 선 |
| 무진행 제한 | 120초 | 덤프와 같은 값(`DbDumpIdleMs`) |

한도를 넘는 파일은 **나눠 달라고 말한다.** 조용히 앞부분만 넣지 않는다.
문구에 대안을 함께 적는다 — "10,000행까지 넣을 수 있습니다(파일 42,880행). 파일을 나누거나,
전체를 옮기는 것이라면 `.sql` 덤프를 쓰세요."

## B-6. 보안·원칙 점검

- 값이 SQL 에 붙지 않는다 — 프런트는 `(값, NULL)` 만, 런처는 JSON 만, 문장은 워커만.
- 이름(테이블·컬럼)은 `quote_identifier` 로 전부 인용된다. 파일의 머리글이 컬럼 이름으로 바로 쓰이지 않고,
  **테이블 정의에 있는 이름만** 대상이 된다(매핑이 이름 검증 역할을 겸한다).
- 읽기 전용 접속은 창 자체를 막고(프런트), 워커가 다시 막는다(서버가 최종 판정).
- 파일은 브라우저가 읽는다. 워커·런처에 경로가 가지 않으므로 저장 폴더 정책과 무관하다.
  (파일 경로를 워커에 넘겨 직접 읽는 방식은 아래 "2차"로 미룬다.)
- 되돌릴 수 없는 문장 확인 규칙과 같은 자리에서, 적재도 실행 전에 대상·행수·모드를 한 번 확인받는다.

## B-7. 붙일 자리 (기능 B)  ✅ 구현됨

| 파일 | 할 일 |
|---|---|
| `src/js/db-import.js` (신규, ≈600줄) | 적재 창 전부 — 파일 읽기·미리보기·매핑·진행·결과. `db-dump.js` 와 같은 모듈 모양(`MNDbImport.open({sessionId, database, table, doc})`) |
| `src/js/db-client.js` | 툴바 `데이터 적재` 버튼, 트리·결과 우클릭 메뉴 항목, `openImportModal(target)` (≈40줄) |
| `desktop/launcher.cs` | `/db-import` 라우트 + `StartDbImport`. 토큰 허용 목록은 `/db-` 접두라 그대로 통과. ⚠ 함수를 넣는 자리가 중요하다 — 덤프·적용 테스트가 런처를 "이 함수부터 저 함수까지"로 잘라 보므로 그 사이에 끼우면 남의 검사에 걸린다. `CancelDbQuery` 뒤에 두었고, 새 테스트는 "다음 `static` 선언까지" 자르는 헬퍼를 쓴다 |
| `desktop/db_worker.py` | `import-rows` 액션 + `import_rows()`(≈120줄), `MAX_IMPORT_ROWS` 등 상수 |
| `classdock.html` | `db-import.js` 스크립트 태그(`db-dump.js` 뒤) |
| `scripts.manifest.json` | `localScripts` · `applicationLayers` 묶음 · `scriptDependencies`(`db-import.js` ← `db-client.js`, `data-convert.js`, `lazy.js`) |
| `src/js/data-convert.js` | `parseDelimited` 를 공개 API 로 내보낸다(적재는 격자만 필요한데 `parse` 는 타입 추론과 unflatten 까지 돈다) |
| `docs/JS-파일별-기능.md` | 새 JS 파일은 여기에 등록해야 릴리스 계약 테스트가 통과한다 |
| `src/styles.css` | 끝의 `.db-*` 블록에 `.db-import-*` 추가. `.db-dump-*` 스타일을 최대한 재사용 |
| `사용법.md` | DB 절에 적재 항목 추가 |
| `desktop/build.bat` · `build-dotnet.bat` | 워커는 기존 `db_worker.py` 리소스 그대로라 변경 없음 |

### 파서는 새로 쓰지 않는다

- CSV/TSV: `MNDataConvert.parse(text, "csv", { header:false, inferTypes:false, delimiter })` →
  `table.rows[r][c].raw` 가 원문 그대로의 문자열이다. `db-client.js` 의존성 표에 `data-convert.js` 를 추가한다(로드 순서는 이미 `data-convert.js` → `table-export.js` → `db-client.js` 라 바꿀 것이 없다).
  (프로젝트 안에 구분자 파서가 이미 셋 — `parseDelimited`(data-convert) · `parseClipboardTable`(spreadsheet) ·
  papaparse — 있다. 네 번째를 만들지 않는다.)
- 인코딩: `detectTextEncoding` (core.js) — `.sql` 가져오기가 쓰는 그 판정기. CP949 덤프와 같은 이유로 필요하다.
- XLSX: `MNLazy.tryNeed("xlsx")` → `XLSX.read(bytes, { cellDates:true })` →
  `XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, blankrows:false })`. `table-export.js` 가 쓰는 것과 같은 경로다.

## B-8. 테스트 (기능 B)

- **본문 인코딩과 런처 파싱을 나란히** — `/db-apply` 테스트와 같은 방식으로, 프런트가 싣는 차례와
  `DbImportRequest` 가 읽는 차례가 같은지 소스에서 함께 본다(값이 옆 컬럼으로 새는 사고를 막는 유일한 장치)
- 매핑 계획(순수 함수 `importPlan(columns, fileHeader, options)`): 자동 매칭, 비운 컬럼 제외,
  AUTO_INCREMENT 기본 제외, NOT NULL + 빈 칸 경고 집계
- 값 규칙: 빈 칸 → NULL/빈 문자열, NULL 표기, 엑셀 날짜 → `YYYY-MM-DD`
- 한도: 행·셀·컬럼 초과가 **전송 전에** 걸리는지
- 워커 소스: `import_rows` 안에서 값이 `%s` 로만 나가는지(문자열 연결로 값이 붙는 곳이 없는지),
  실패·취소 경로가 롤백하는지, 읽기 전용에서 판정 이전에 막히는지
- 런처 소스: `mode` 는 아는 세 값만 넘기는지, 본문 상한이 있는지

## B-9. 범위 밖 (1차에서 하지 않는다)

- **10,000행 초과 파일.** 워커가 파일 경로를 직접 받아 스트리밍으로 읽는 방식이 필요하다
  (경로는 런처가 `SafeRelPath` → `TryResolveSaveRootPath` 로 만들어야 하고, 그러면 작업 폴더 안의
  파일만 적재할 수 있다는 제약이 생긴다). 필요해지면 2차에서.
- **없는 테이블 만들며 적재(CREATE TABLE 추론).** 자료형을 앱이 추측하면 나중에 반드시 후회한다.
- **업서트 키 직접 고르기.** 1차는 테이블의 기본키·유니크 키에 맡긴다.
- **여러 시트·여러 파일 한 번에.**
- **적재 되돌리기(undo).** 자동 커밋에서 이미 확정된 것을 되돌리는 길은 없다. 수동 커밋 + 롤백을 안내한다.

---

# 구현 순서

1. ~~**A-1** `parseClipboardTable` 을 `grid-selection.js` 로 옮기고 스프레드시트 뷰어를 그쪽으로 돌린다.~~ ✅
2. ~~**A-2** 붙여넣기 순수 함수 + `Ctrl+V` · `Ctrl+Shift+V` + 보고 문구.~~ ✅
3. ~~**A-3** 결과 표 우클릭 메뉴.~~ ✅ (적재 진입점은 B-2 에서 함께 넣는다)
4. ~~**B-1** 워커 `import-rows` + 런처 `/db-import` + 두 쪽 차례를 묶는 테스트.~~ ✅
5. ~~**B-2** `db-import.js` — 파일 읽기·미리보기·매핑.~~ ✅
6. ~~**B-3** 진행·취소·결과 보고, 실패 행 짚기.~~ ✅
7. ~~**B-4** `사용법.md`·`docs/JS-파일별-기능.md` 갱신.~~ ✅ (테스트는 `tests/db-import.test.js` 로 따로 두었다)

# 검증 항목

- 붙여넣기가 표 밖으로 넘칠 때 행이 늘지 않고 버린 수를 정확히 말하는지
- 조인 결과·뷰에 붙여넣으면 한 칸도 담기지 않고 그 까닭이 나오는지
- 500건을 넘기는 붙여넣기가 **부분적으로도** 담기지 않는지
- CP949 CSV 의 한글이 깨지지 않고, 엑셀 날짜 컬럼이 `45231` 이 아니라 날짜로 들어가는지
- 적재 도중 취소하면 한 행도 남지 않는지, 수동 커밋에서 앞서 담아 둔 변경이 살아 있는지
- 자료형이 틀린 행 하나 때문에 전체가 되돌아가고, 그 행 번호가 파일 줄 번호로 안내되는지
- 읽기 전용 접속에서 적재 창이 열리지 않고, 열리더라도 서버가 막는지
