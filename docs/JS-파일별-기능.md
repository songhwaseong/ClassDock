# JavaScript 파일별 기능 안내

**최종 업데이트: 2026년 7월 14일**

이 문서는 만능파일교실의 JavaScript 파일이 각각 어떤 기능을 담당하는지 빠르게 찾기 위한 유지보수용 색인입니다. 기능을 추가하거나 파일 책임이 바뀌면 해당 행과 날짜를 함께 갱신합니다.

## 가장 먼저 알아둘 점

- 앱 실행 코드의 원본은 `src/js/*.js`입니다.
- 실제 로딩 순서와 계층은 `scripts.manifest.json`이 기준입니다. 새 파일을 만들면 HTML에 태그만 추가하지 말고 manifest에도 등록해야 합니다.
- `manneung-classroom-offline.html`과 `desktop/app.html`은 생성 파일입니다. 직접 수정하지 않습니다.
- 수정 후 `node build-offline.js`를 실행하면 모든 로컬·vendor JS가 오프라인 HTML 하나로 합쳐집니다.
- 각 파일은 ES module이 아닌 전역 스크립트입니다. 이름 충돌과 로딩 순서가 중요하므로 `npm run check`로 전역 선언·의존성 계약을 확인합니다.
- 자동 생성 파일인 `src/js/korean-font.js`는 직접 수정하지 않습니다.

## 앱 로딩 구조

```mermaid
flowchart LR
  A["1. bootstrap<br/>설정·공통 상태"] --> B["2. documents<br/>파일·문서·PDF·코드"]
  B --> C["3. python-and-notebooks<br/>Python·Jupyter"]
  C --> D["4. document-editors<br/>Office·표·이미지·칠판"]
  D --> E["5. learning-tools<br/>수업·과제·펫·메모·이벤트"]
```

## 1. bootstrap — 초기 설정과 공통 기반

| 파일 | 담당 기능 | 주로 함께 확인할 파일 |
|---|---|---|
| `state-sync.js` | EXE의 포트가 바뀌어도 설정이 유지되도록 로컬 서버와 `localStorage`를 동기화합니다. 같은 출처 요청에 실행별 인증 토큰을 붙이고 종료 직전 상태도 전송합니다. | `desktop/launcher.cs`, `state.js` |
| `theme.js` | 문서가 그려지기 전에 저장된 다크·라이트 테마를 적용해 초기 화면 깜빡임을 막습니다. | `state.js`, `src/styles.css` |
| `i18n.js` | 한국어·영어 사전, 매개변수 번역, DOM 텍스트·title·aria 자동 번역과 언어 전환을 담당합니다. 사용자에게 보이는 새 문구를 추가하면 이 파일의 영문 사전도 확인합니다. | 모든 UI 파일, `app.js` |
| `core.js` | 경로 정규화, 작업공간 마커, 인코딩 판별, Python 오류 설명·경로 분석, Markdown/HTML 살균, 코드 편집 순수 함수 등 여러 기능이 공유하는 기반 유틸리티 모음입니다. | `documents.js`, `python-run-context.js`, `tests/core.test.js` |
| `icons.js` | 앱의 이모지형 버튼을 테마에 맞는 단색 SVG 아이콘으로 정리하고 동적으로 추가되는 UI도 관찰해 보정합니다. | UI를 만드는 모든 파일 |
| `state.js` | 열린 문서·탭·사이드바·학습 화면의 전역 상태, 앱 설정과 단축키, 공용 토스트·로딩 UI를 관리합니다. | `documents.js`, `app.js`, `i18n.js` |
| `history.js` | 편집기 공용 되돌리기·다시실행(`MNEditHistory`)입니다. 스냅샷 스택·상한(개수·총량)·redo 무효화·버튼 상태·연속 입력 묶기를 담당하고, 각 편집기는 capture·apply·isEqual 만 넘깁니다. PDF·표·노트북·이미지·화이트보드·파이썬 편집기가 모두 씁니다. | `pdf-recovery.js`, `spreadsheet-viewer.js`, `notebook-model.js`, `image-viewer.js`, `whiteboard.js`, `python-editor.js`, `tests/edit-history.test.js` |
| `spellcheck.js` | 외부 API 없이 동작하는 한국어 맞춤법·띄어쓰기 규칙 엔진(`MNKoreanSpellcheck`)과 공통 검사 패널, 교정 후보 적용, 무시·사용자 사전, 한글 조합 안전 재검사를 담당합니다. 일반 문서는 전체 글을, 마크다운은 코드 구간을 제외하고, 코드 파일은 주석·문자열만 검사합니다. | `code-viewer.js`, `notebook-cells.js`, `scratchpad.js`, `tests/spellcheck.test.js` |

## 2. documents — 파일, 문서, PDF와 코드 보기

| 파일 | 담당 기능 | 주로 함께 확인할 파일 |
|---|---|---|
| `pdf-recovery.js` | PDF 편집 복구본을 IndexedDB에 저장·복원하고 PDF 편집 Undo/Redo 히스토리를 관리합니다. | `pdf-editor.js`, `pdf-pages.js`, `tests/pdf-recovery.test.js` |
| `video-viewer.js` | 영상·오디오 재생, SRT/VTT/SMI 자막 변환·자동 연결, EXE 영상 변환과 폴더 일괄 MP4 변환을 담당합니다. | `file-loaders.js`, `desktop/launcher.cs`, `tests/video-subtitles.test.js` |
| `documents.js` | 문서 객체 생성, 탭·사이드바·그룹 트리, 활성 문서 전환, 검색, 분할 작업, 새로고침·닫기 등 다중 문서 생명주기의 중심입니다. 지원 확장자와 코드 프로파일도 정의합니다. | `state.js`, `file-loaders.js`, `viewer-base.js` |
| `workspace-store.js` | 최근 작업공간을 서버 또는 IndexedDB에 바이너리로 저장·병합·삭제하고 재실행 시 파일·폴더·탭 상태를 복원합니다. | `file-loaders.js`, `desktop/launcher.cs`, `tests/folder-workspace.test.js` |
| `file-loaders.js` | 파일·폴더·드래그 입력을 문서 종류별 로더로 전달합니다. 폴더 핸들, 빈 폴더, 새로고침, ZIP/TAR/GZ 해제, PPTX 변환 폴백을 관리합니다. | `documents.js`, `workspace-store.js`, 각 형식 뷰어 |
| `pdf-render.js` | PDF.js 문서 로딩, 페이지 자리표시자, 지연 캔버스 렌더링, 화질·배율·야간 모드와 한글 폰트 렌더링을 담당합니다. | `pdf-editor.js`, `pdf-pages.js`, `korean-font.js` |
| `pdf-ocr.js` | 스캔 PDF를 Tesseract로 OCR하고 결과를 문서 지문 기준으로 IndexedDB에 캐시해 PDF 검색과 사이드바 검색에 제공합니다. | `pdf-editor.js`, `documents.js`, `tests/lesson-ocr.test.js` |
| `pdf-editor.js` | PDF 확대·축소, 현재 페이지, 전체화면, 검색·강조, 서명·텍스트·날짜·체크·필기와 저장 UI를 담당합니다. | `pdf-render.js`, `pdf-pages.js`, `pdf-recovery.js` |
| `pdf-pages.js` | PDF 다운로드 바이트 생성, 책갈피 목차, 페이지 선택·추출·삭제·회전·순서 변경·합치기를 담당합니다. | `pdf-editor.js`, `pdf-recovery.js`, `tests/pdf-outline.test.js` |
| `viewer-base.js` | Office/텍스트 문서 로더의 공통 진입점입니다. Markdown, 일반 텍스트, HTML 상대 리소스, SQLite 읽기 전용 미리보기를 렌더합니다. | `office-doc-viewers.js`, `code-viewer.js`, `pptx-viewer.js` |
| `korean-font.js` | Pyodide Matplotlib용 NanumGothic gzip+base64 데이터입니다. 자동 생성 파일이므로 직접 수정하지 않습니다. | `python-runtime.js`, 생성 도구 |
| `code-viewer.js` | 코드·설정 파일의 구문 강조와 줄번호, Python 실행 바, `.py`·텍스트 저장, 원본 핸들/자동 저장 폴더 분기, 노트북 변환, 정의 이동 연결을 담당합니다. | `python-editor.js`, `python-runtime.js`, `python-run-context.js` |

## 3. python-and-notebooks — Python 편집·실행과 Jupyter

| 파일 | 담당 기능 | 주로 함께 확인할 파일 |
|---|---|---|
| `python-snippets.js` | Python 예제 갤러리, 난이도·검색 필터, 예제 열기, 로컬 Python import 색인과 자동완성 후보 준비를 담당합니다. | `python-editor.js`, `desktop/launcher.cs` |
| `python-editor.js` | 자체 코드 편집기 UI를 만듭니다. 줄번호, 구문 강조, 자동 들여쓰기, 찾기·바꾸기, 자동완성, 다중 캐럿, 셀 경계, 오류 줄과 정의 이동을 관리합니다. | `code-viewer.js`, `python-snippets.js` |
| `python-run-context.js` | 함께 연 프로젝트 파일을 실행 번들로 구성하고 Python의 작업폴더·프로젝트 루트·상대경로·import·출력 파일 경로를 계산합니다. | `file-loaders.js`, `python-runtime.js`, `tests/python-path-helper.test.js` |
| `python-runtime.js` | Python 실행의 총괄입니다. EXE 로컬 Python과 브라우저 Pyodide를 선택하고 패키지 준비, 입력, 스트리밍 출력, 중지, 진단·단계 실행, 결과 파일 수집을 처리합니다. | `python-run-context.js`, `desktop/launcher.cs`, `korean-font.js` |
| `python-terminal.js` | Python 편집기의 결과/터미널 전환, 명령 기록·중지·초기화, EXE의 지속형 로컬 PowerShell 세션과 브라우저의 상태 유지 Pyodide 콘솔을 담당합니다. | `code-viewer.js`, `python-runtime.js`, `desktop/launcher.cs` |
| `notebook-model.js` | `.ipynb` 파싱·직렬화, 셀·출력 모델, 복구본·자동 저장, 실행 상태 해시, 셀 추가·삭제·이동 같은 DOM 비종속 모델 기능을 담당합니다. | `notebook-run.js`, `notebook-cells.js`, `tests/notebook-serialize.test.js` |
| `notebook-tools.js` | 노트북 실행 작업공간과 파일 번들, 로컬 셀 커널 선택·시작·중지, 로컬 Python 설치 안내와 커널 통신을 담당합니다. | `notebook-model.js`, `python-runtime.js`, `desktop/python_kernel.py` |
| `notebook-run.js` | 노트북 전체 화면과 상단 도구막대를 만들고 셀 렌더링, 전체 실행, 저장, 목차, 찾기, 출력 메뉴, 커널 상태 UI를 연결합니다. | `notebook-model.js`, `notebook-tools.js`, `notebook-cells.js` |
| `notebook-pdf-export.js` | 노트북을 A4 PDF로 내보냅니다. 셀 경계를 고려한 페이지 분할, 캔버스 배치, 지도·iframe 리치 출력 스냅샷을 처리합니다. | `notebook-run.js`, `tests/pdf-layout.test.js` |
| `notebook-cells.js` | 개별 코드·마크다운·Raw 셀 UI, 셀 실행·입력, 선택·복사·붙여넣기, 드래그 순서 변경, 접기, 메모 보내기와 셀 도구 버튼을 담당합니다. | `notebook-run.js`, `python-editor.js`, `scratchpad.js` |

## 4. document-editors — Office, 표, 이미지와 화이트보드

| 파일 | 담당 기능 | 주로 함께 확인할 파일 |
|---|---|---|
| `office-doc-viewers.js` | DOCX, HWP, HWPX의 읽기 전용 미리보기와 Office 암호화 문서 판별·복호화 보조를 담당합니다. | `viewer-base.js`, `file-loaders.js` |
| `spreadsheet-viewer.js` | XLSX/XLS/CSV 로딩과 시트 UI, 셀 편집·선택·복사, 수식 계산, 행/열·병합·서식·필터·정렬, 저장과 새 표 생성을 담당합니다. | `spreadsheet-chart.js`, `tests/xlsx-edit.test.js` |
| `spreadsheet-chart.js` | 선택한 표 범위에서 차트에 적합한 데이터를 추론하고 막대·선·원형 SVG 차트를 생성합니다. | `spreadsheet-viewer.js` |
| `pptx-viewer.js` | PPTX 간이 슬라이드 미리보기, 슬라이드 맞춤, 포함 폰트 변환과 상대 리소스 경로 해석을 담당합니다. EXE의 정확한 PDF 변환 실패 시 사용됩니다. | `file-loaders.js`, `office-doc-viewers.js` |
| `image-viewer.js` | 이미지 보기·확대·회전·뒤집기·자르기·내보내기, 작업공간 복구와 폴더 이미지/PDF 갤러리를 담당합니다. | `file-loaders.js`, `documents.js` |
| `board-render.js` | 화이트보드와 수업 리플레이가 공유하는 선·도형·텍스트·이미지 벡터 렌더러입니다. | `whiteboard.js`, `lesson-replay.js` |
| `whiteboard.js` | 독립 화이트보드 문서, 그리기 도구, 선택·이동, 이미지, Undo/Redo, 복구 저장과 리플레이 녹화 연결을 담당합니다. | `board-render.js`, `lesson-replay.js` |

## 5. learning-tools — 수업, 과제, 펫, 메모와 앱 이벤트

| 파일 | 담당 기능 | 주로 함께 확인할 파일 |
|---|---|---|
| `lesson-replay.js` | `.lesson` 데이터 검증, 화이트보드·PDF·Python 이벤트 녹화, 타임라인 재생·탐색·속도 조절과 파일 저장을 담당합니다. | `board-render.js`, `whiteboard.js`, `code-viewer.js` |
| `diff-viewer.js` | 파일 비교(diff) 문서: patience diff 자체 구현, 나란히/한 줄 보기, 공백 무시·접기, 두 파일 선택 모달과 저장본 비교, 과제 시작 코드 비교 진입점을 담당합니다. | `documents.js`, `task-package.js`, `command-palette.js`, `tests/diff-viewer.test.js` |
| `batch-replace.js` | 여러 파일 찾아 바꾸기: 열린 텍스트·코드 문서에서 한꺼번에 찾아 바꾸기(대소문자·정규식·그룹 치환), 미리보기 체크리스트, `saveTextDoc({silent,existingOnly})`로 조용히 저장, 되돌리기를 담당합니다. | `documents.js`, `code-viewer.js`, `command-palette.js`, `tests/batch-replace.test.js` |
| `task-package.js` | `.task` 과제 만들기·검증·내보내기, `.taskdone` 제출본 생성·검수·재채점, 일괄 검수와 성적 CSV를 담당합니다. | `python-runtime.js`, `file-loaders.js`, `tests/task-package.test.js` |
| `screensaver.js` | 유휴 화면 시계·영상 재생, 영상 목록 IndexedDB 저장, 재생 가능성 검사와 전체화면 종료를 담당합니다. | `app.js`, `state.js` |
| `pet-data.js` | 픽셀 펫 종족별 스프라이트, 팔레트, 이름과 기본 대사를 정의합니다. | `pet.js`, `pet-custom.js` |
| `pet-custom.js` | 펫 대사 편집, 사용자별 종족 대사, 나만의 펫 외형 조합과 저장·복원을 담당합니다. | `pet-data.js`, `pet.js` |
| `pet-events.js` | 펫 행동 도감의 고유 이벤트 이름과 한국어·영어 설명을 정의합니다. | `pet.js`, `tests/pet-events.test.js` |
| `pet.js` | 픽셀 펫의 이동·점프·플랫폼 탐색·행동·대사·드래그·이벤트 도감과 실제 DOM 애니메이션 엔진입니다. | `pet-data.js`, `pet-custom.js`, `pet-events.js` |
| `pet-focus.js` | 집중·휴식 타이머, 오늘 완료 횟수, 타이핑 중 조용한 상태와 집중 모드에 따른 펫 행동을 관리합니다. | `pet.js`, `state.js`, `tests/pet-focus.test.js` |
| `scratchpad.js` | 여러 탭 임시 메모, 글·이미지·노트북 셀 블록, 배치·크기·잠금·드래그 순서·자동 저장·이전 형식 마이그레이션을 담당합니다. | `notebook-cells.js`, `image-memo.js`, `tests/scratchpad.test.js` |
| `image-memo.js` | 캡처 이미지 여러 장 붙여넣기·드롭, EXE 자동 저장, 브라우저 임시 복구, 다시 시도·삭제·미리보기·일반 메모 보내기를 담당합니다. | `scratchpad.js`, `desktop/launcher.cs`, `tests/image-memo.test.js` |
| `app.js` | 최종 이벤트 배선 파일입니다. 드래그 앤 드롭, 파일/폴더 열기, 설정 모달, 자동 저장 폴더, 도움말, 단축키, 헤더 메뉴, 서버 heartbeat와 앱 시작·종료 흐름을 연결합니다. | 사실상 모든 기능 파일, 특히 `state.js`, `file-loaders.js` |
| `command-palette.js` | `Ctrl+K` 명령 팔레트의 명령 목록, 현재 문맥별 활성화 조건, 검색·키보드 선택과 실제 기능 호출을 담당합니다. | `app.js`, 각 명령 대상 파일 |

## 빌드·개발 도구 JS

이 파일들은 앱 화면에 로드되지 않고 개발·배포 과정에서 실행됩니다.

| 파일 | 담당 기능 |
|---|---|
| `build-offline.js` | `manneung-classroom.html`, `src/styles.css`, manifest의 로컬 JS와 vendor 자산을 하나의 `manneung-classroom-offline.html`로 합치고 무결성을 확인합니다. |
| `playwright.config.js` | Playwright E2E 테스트의 서버·브라우저·테스트 경로를 설정합니다. |
| `tools/check-source.js` | JavaScript 문법, 전역 선언 충돌, manifest 로딩 계층과 공개 API 경계를 검사합니다. |
| `tools/check-release.js` | 오프라인 HTML에 로컬 경로가 남지 않았는지, vendor 파일·해시와 배포 산출물이 올바른지 확인합니다. |
| `tools/download-pyodide.js` | EXE의 오프라인 Python 실행에 필요한 Pyodide 코어·패키지를 내려받아 `vendor/pyodide`를 구성합니다. |
| `tools/e2e-server.js` | Playwright 테스트용 로컬 정적 서버입니다. 실제 EXE 백엔드를 대신해 화면 흐름 테스트에 필요한 파일을 제공합니다. |

## 테스트 JS

| 파일 | 검사 범위 |
|---|---|
| `tests/core.test.js` | 공통 경로·인코딩·Markdown·코드 편집·Python 분석 등 `core.js` 중심 순수 함수 |
| `tests/diff-viewer.test.js` | 파일 비교 diff 판정·chg 짝짓기·인라인 강조·접기·행 HTML 이스케이프 |
| `tests/batch-replace.test.js` | 여러 파일 찾아 바꾸기: 정규식 이스케이프·대소문자·그룹 치환·줄 단위 변경 기록·위험 패턴 거부 |
| `tests/document-enhancements.test.js` | 표시 이름, 문서 복구 스냅샷, 검색·편집기 보강 계약 |
| `tests/e2e/critical-flows.spec.js` | Playwright로 핵심 사용자 흐름을 실행하는 E2E 시나리오 |
| `tests/e2e-contract.test.js` | E2E 설정과 필수 시나리오가 유지되는지 확인하는 계약 테스트 |
| `tests/folder-workspace.test.js` | 폴더 저장·복원·새로고침, 자동 저장 폴더 UI, 원본 미저장 안내와 설명서 주의사항 |
| `tests/image-memo.test.js` | 이미지 메모 파일명·자동 저장·임시 복구 조건 |
| `tests/lesson-ocr.test.js` | `.lesson` 검증과 OCR 캐시 문서 식별 |
| `tests/local-server-security.test.js` | EXE 로컬 API 인증·경로 검증·보안 헤더·실행 상한 |
| `tests/notebook-serialize.test.js` | ipynb 모델 왕복, 셀·출력·첨부·히스토리·자동 저장·커널 UI |
| `tests/notebook-workspace-path.test.js` | 노트북 작업폴더와 출력 파일 경로 |
| `tests/pdf-layout.test.js` | PDF 숨김·분할 화면의 폭과 레이아웃 계산 |
| `tests/pdf-markup.test.js` | PDF 편집 표시와 명령 팔레트 접근성 연결 |
| `tests/pdf-outline.test.js` | PDF 책갈피 생성·계층·페이지 변경 보정 |
| `tests/pdf-recovery.test.js` | PDF 자동 복구 차이 판별과 적용 |
| `tests/pet-custom-priority.test.js` | 사용자 펫 설정 우선순위 |
| `tests/pet-events.test.js` | 행동 도감 데이터와 종족 참조 무결성 |
| `tests/pet-focus.test.js` | 집중 타이머 저장·복원과 UI 계약 |
| `tests/python-kernel.test.js` | 로컬 노트북 커널의 셀 간 상태 유지(환경에 따라 제외 가능) |
| `tests/python-notebook-split.test.js` | Python 코드를 노트북 셀로 나누는 규칙 |
| `tests/python-path-helper.test.js` | Python 실행 경로 도우미와 작업공간 번들 |
| `tests/python-stderr-classify.test.js` | Python 경고·실패 stderr 분류 |
| `tests/release-contract.test.js` | vendor 고정본, manifest 로딩·의존성·공개 API 및 이 문서의 JS 목록 완전성 |
| `tests/scratchpad.test.js` | 임시 메모 데이터 이전, 블록·잠금·노트북 셀 처리 |
| `tests/spellcheck.test.js` | 오프라인 한국어 규칙, 마크다운 코드 제외, 코드 주석·문자열 범위, 사용자 사전과 화면 연결 |
| `tests/study-mode.test.js` | 분할 작업 선택·참고 잠금·모바일 배치·상태 복원 |
| `tests/task-package.test.js` | 과제·제출본 경로 충돌, 검증과 재채점 대상 선택 |
| `tests/theme-background.test.js` | 라이트 배경 설정 저장·초기 적용·CSS 계약 |
| `tests/video-subtitles.test.js` | 자막 변환·자동 연결과 영상 작업공간 제외 |
| `tests/xlsx-edit.test.js` | 표 편집, 수식, 병합, 행·열, 차트와 XLSX 저장 왕복 |

## 기능을 찾을 때 빠른 기준

| 하려는 작업 | 먼저 볼 파일 |
|---|---|
| 새 파일 형식 지원 | `documents.js` → `file-loaders.js` → 해당 뷰어 |
| 탭·사이드바·분할 작업 | `documents.js`, `state.js` |
| 최근 작업공간·폴더 복원 | `workspace-store.js`, `file-loaders.js` |
| `.py` 편집·저장 버튼 | `code-viewer.js`, `python-editor.js` |
| Python 실행 결과·패키지 | `python-runtime.js`, `python-run-context.js` |
| Python 편집기 터미널 | `python-terminal.js`, `desktop/launcher.cs` |
| Jupyter 셀 UI | `notebook-run.js`, `notebook-cells.js`, `notebook-model.js` |
| 설정창·전역 이벤트 | `app.js`, `state.js` |
| 사용자 문구·영문 번역 | `i18n.js` |
| EXE API·실제 디스크 저장 | JS가 아니라 `desktop/launcher.cs` |
| 오프라인 HTML/EXE 재생성 | `build-offline.js`, `desktop/build.bat` |

## 계속 업데이트하는 방법

1. 파일의 책임이 바뀌면 위 표의 설명과 **최종 업데이트 날짜**를 수정합니다.
2. 새 `src/js` 파일을 추가하면 `scripts.manifest.json`의 알맞은 계층과 이 문서에 모두 등록합니다.
3. 사용자에게 보이는 문구가 생기면 `i18n.js` 영문 사전을 확인합니다.
4. 관련 `tests/*.test.js`를 추가하거나 기존 계약 테스트를 갱신합니다.
5. 다음 명령으로 검증합니다.

```powershell
npm.cmd run check
npm.cmd test
node build-offline.js
desktop\build.bat
npm.cmd run release-check
```

`tests/release-contract.test.js`는 manifest에 등록된 모든 `src/js` 파일명이 이 문서에 있는지 확인하므로, 새 파일을 추가하고 문서 갱신을 잊으면 테스트가 실패합니다.
