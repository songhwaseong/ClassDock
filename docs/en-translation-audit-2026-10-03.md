# EN 전환 누락 코드 검토 — 2026-10-03

## 결론

편집 도구와 안내를 포함해 여러 기능에 누락이 분포한다. 사전 추가뿐 아니라 동적 도구막대·우클릭 메뉴의 번역 연결, 상태 갱신 문구의 영어 처리까지 필요하다.

- 검사 범위: `classdock.html`, 배포 manifest의 JavaScript 150개(번역 모듈 1개 + 기능 모듈 149개). 사용법 열기 경로와 원본 문서도 확인했다.
- 정적 HTML: 공용 사전 미등록 72곳·62문구를 추출하고 별도 처리/초기 표시 7곳을 제외했다. **남은 정적 누락은 65곳·56문구**다. 버튼 텍스트뿐 아니라 title·aria-label·placeholder도 포함한다.
- 동적 UI: **107개 파일에서 4,609곳·4,050종의 추가 검토 후보**를 추출했다. 이것은 확정 누락 수가 아니다. 아래 설명처럼 중복·문자열 조각·개별 번역 처리·데이터가 포함될 수 있다.
- 번역 자원: 고정 문자열 3,132개, 변수 포함 템플릿 133개, HTML 블록 23개. 사전의 크기는 전체 UI 번역률을 뜻하지 않는다.
- 브라우저 자동화·스크린샷·EXE 실행 검증 없이 코드로 검토했다. 앱 소스와 생성물은 수정하거나 다시 빌드하지 않았다.

## 직접 확인한 문제

| 영역 | 확인 내용 | 근거 |
|---|---|---|
| DOCX 편집 도구 | “편집 도구”, 문서·글자·문단·표·그림 메뉴를 한국어로 생성한다. 이 모듈에는 번역 호출/언어 변경 처리가 없다. | [src/js/docx-editor.js:785](D:/my/src/js/docx-editor.js:785) |
| DOCX 안내 | 제자리 편집·문단 목록 설명을 한국어 상수로 만들고 도움말에 그대로 대입한다. | [src/js/docx-editor.js:923](D:/my/src/js/docx-editor.js:923), [src/js/docx-editor.js:1114](D:/my/src/js/docx-editor.js:1114) |
| 공용 우클릭 메뉴 | label/title을 그대로 표시하며 번역기를 호출하지 않는다. 한국어 항목을 전달하는 여러 편집기에 영향을 준다. | [src/js/context-menu.js:90](D:/my/src/js/context-menu.js:90) |
| 설정 → 도구 | 노출·비노출 안내가 사전에 없고 도구 목록도 tool.label을 그대로 표시한다. | [classdock.html:790](D:/my/classdock.html:790), [src/js/app.js:1654](D:/my/src/js/app.js:1654) |
| 진단 로그 | 검색·필터·복사 등의 정적 문구와 건수·오류·경고 상태 문구가 한국어로 남는다. | [classdock.html:865](D:/my/classdock.html:865), [src/js/diagnostics.js:315](D:/my/src/js/diagnostics.js:315) |
| 사진첩 | 꾸미기·감상 모드·넘기기 효과 등의 화면을 한국어 HTML로 생성한다. 모듈에 공용 번역 연결이 없다. | [src/js/photo-album.js:3137](D:/my/src/js/photo-album.js:3137) |
| 화이트보드 | 도구막대 일부에 번역 호출은 있지만 추가된 문구가 사전에 없고, 캔버스의 “자 (cm)”·“각도기”는 DOM 번역 대상도 아니다. | [src/js/whiteboard.js:1227](D:/my/src/js/whiteboard.js:1227), [src/js/whiteboard.js:1258](D:/my/src/js/whiteboard.js:1258) |
| 환영 화면 | 사전에는 “ClassDock에 오신 걸 환영해요 👋”가 있지만 실제 HTML은 이모지가 없어 키가 불일치한다. | [classdock.html:960](D:/my/classdock.html:960), [src/js/i18n.js:886](D:/my/src/js/i18n.js:886) |
| 자세한 사용법 | EN 상태에서도 동일한 한국어 사용법 HTML을 연다. 언어별 문서 선택 경로가 없다. | [src/js/app.js:2600](D:/my/src/js/app.js:2600) |

## 원인과 수정 순서

1. **동적 UI 번역 연결**: 초기 body 스캔은 한 번만 수행된다. 뒤늦게 생성하는 화면은 `translateTree()` 호출이나 자체 언어 처리가 필요하다. 공용 우클릭 메뉴와 DOCX부터 연결하는 것이 좋다. [src/js/i18n.js:3729](D:/my/src/js/i18n.js:3729)
2. **사전 누락/문구 불일치**: `t()`는 정확히 일치하는 키가 없으면 한국어를 반환한다. 앞뒤 공백 외에는 이모지·마침표·기호 차이를 보정하지 않는다. 설정·상단 메뉴·안내 문구부터 보완해야 한다. [src/js/i18n.js:3473](D:/my/src/js/i18n.js:3473)
3. **상태/조합 문구**: 개수·진행률·선택 상태·오류 이유 등을 붙여 만드는 문자열은 변수 템플릿 번역으로 옮겨야 한다. DOM을 처음 번역한 뒤 한국어 textContent/title로 덮어쓰는 경로도 점검해야 한다.
4. **DOM 밖 문구**: 캔버스와 내보내기 화면, 별도 사용법 문서는 각각 영어 표시 경로가 필요하다.
5. **언어 전환 시점**: EN으로 시작했을 때, 기능을 연 뒤 EN으로 바꿨을 때, 팝업을 나중에 열었을 때, 한글로 되돌릴 때를 각각 확인해야 한다. 사용자 문서 본문이나 고유명사까지 일괄 치환하지 않도록 UI만 대상으로 삼아야 한다.

## 집계 방법과 한계

JavaScript를 Acorn AST로 읽어 주석을 제외하고 DOM 텍스트·속성 대입, UI label/title 등 속성, toast 등 메시지 호출, HTML 문자열, 일부 번역 함수 호출에서 한글 문자열을 수집했다. HTML은 텍스트 노드와 표시 속성으로 나누고 공용 사전과 대조했다. 정적 HTML에서는 번역 HTML 블록과 단축키가 관리하는 속성을 별도로 처리했다.

정적 72곳 중 제외한 7곳: 언어 전환 버튼의 의도적인 양언어 속성 2곳, 펫 휴식 표시 1곳(별도 영어 처리), 선택 개수/삭제 설명 2곳(표시 시 번역 갱신), 필수 도구 설명/진단 상태 초기값 2곳(다른 동적 문구로 교체). 마지막 2개 기능에는 별도로 동적 누락이 존재한다.

동적 후보에서는 Python/Java 예제 모듈 301곳을 제외했다. 나머지에도 조건부 영어 분기, 로컬 번역표, 예제/기본 데이터, 문자열 조각과 반복 발생이 포함될 수 있다. 반대로 사용자 정의 버튼 생성 함수의 인자, 일반 변수에 담긴 안내, 네이티브 백엔드/외부 라이브러리 문구는 이 후보 수에 완전히 포착되지 않는다. **따라서 4,609를 실제 누락 개수나 전체 번역률의 분모로 사용할 수 없다.**

현재 번역 모듈을 Node VM에서 EN으로 로드해 “편집 도구”, “DOCX 편집 도움말”, “야간 보기”, “새 사진첩”, “도구”, “노출”, “비노출”, “로그 복사”, 환영 제목이 그대로 반환되는 것을 확인했다. 비교용으로 삭제 설명(마침표 포함)과 “개 선택”은 영어가 반환되는 것도 확인했다. 이는 코드 검증이며 화면 재현 결과는 아니다.

## 동적 후보 분포 — 확정 누락 수 아님

| 파일 | 표시 코드 후보 위치 수 |
|---|---:|
| spreadsheet-viewer.js | 405 |
| music-editor.js | 388 |
| whiteboard.js | 368 |
| photo-album.js | 237 |
| exam-paper.js | 212 |
| db-client.js | 207 |
| code-viewer.js | 162 |
| bracket.js | 149 |
| state.js | 145 |
| concept-doc.js | 121 |
| remote-terminal.js | 121 |
| docx-editor.js | 113 |
| task-package.js | 94 |
| tier-list.js | 93 |
| python-run-context.js | 86 |
| trip.js | 82 |
| pick.js | 76 |
| diary.js | 66 |
| python-runtime.js | 65 |
| python-editor.js | 54 |
| study-doc.js | 51 |
| core.js | 48 |
| remote-files-ui.js | 43 |
| documents.js | 42 |
| python-terminal.js | 42 |
| file-loaders.js | 39 |
| weather-wind.js | 39 |
| lotto.js | 39 |
| kosis-api.js | 36 |
| js-editor.js | 33 |
| db-import.js | 33 |
| pet-events.js | 30 |
| image-viewer.js | 28 |
| viewer-base.js | 27 |
| java-editor.js | 27 |
| db-dump.js | 27 |
| video-viewer.js | 26 |
| lazy.js | 25 |
| notebook-cells.js | 24 |
| pick-ladder.js | 24 |
| music-eartest.js | 24 |
| special-chars.js | 22 |
| board-tools.js | 22 |
| music-model.js | 22 |
| jeju-bus-map.js | 21 |
| map-viewer.js | 21 |
| notebook-tools.js | 19 |
| timeline.js | 19 |
| batch-replace.js | 19 |
| snippet-gallery.js | 18 |
| pick-bomb.js | 18 |
| notebook-run.js | 16 |
| pick-bingo.js | 15 |
| lesson-replay.js | 15 |
| music-library.js | 15 |
| pick-card.js | 14 |
| pick-dice.js | 14 |
| pet-focus.js | 14 |
| pdf-pages.js | 13 |
| exchange-rate-ui.js | 13 |
| app.js | 13 |
| diagnostics.js | 12 |
| pdf-editor.js | 12 |
| pick-treasure.js | 12 |
| pick-coin.js | 11 |
| workspaces.js | 10 |
| notebook-model.js | 10 |
| js-runtime.js | 10 |
| pick-scratch.js | 10 |
| pick-croc.js | 10 |
| pick-balloon.js | 10 |
| pet-custom.js | 10 |
| mnote.js | 10 |
| backup.js | 10 |
| office-replace.js | 9 |
| spreadsheet-chart.js | 9 |
| image-lightbox.js | 9 |
| pdf-ocr.js | 8 |
| korea-coords.js | 8 |
| pick-lotto.js | 8 |
| pick-strings.js | 8 |
| scratchpad.js | 8 |
| weather-typhoon.js | 7 |
| workspace-store.js | 6 |
| pdf-render.js | 6 |
| java-runtime.js | 6 |
| office-doc-viewers.js | 6 |
| pick-marble.js | 6 |
| pick-dart.js | 6 |
| pick-lots.js | 6 |
| music-audio.js | 6 |
| notebook-pdf-export.js | 5 |
| pick-roulette.js | 5 |
| pet.js | 5 |
| image-memo.js | 5 |
| js-libraries.js | 4 |
| weather-map.js | 4 |
| pick-capsule.js | 4 |
| pick-bottle.js | 4 |
| pick-pinball.js | 4 |
| workspace-python.js | 3 |
| music-xml.js | 3 |
| pptx-viewer.js | 2 |
| kosis-choro.js | 2 |
| pick-slot.js | 2 |
| screensaver.js | 2 |
| data-convert-ui.js | 2 |

## 정적 누락 65곳 상세

동일 문구가 title과 aria-label에 각각 있으면 2곳으로 센다. 총 56개 고유 문구다.

| 위치 | 종류 | 요소 ID | 문구 |
|---|---|---|---|
| [classdock.html:45](D:/my/classdock.html:45) | title |  | PDF 페이지 |
| [classdock.html:45](D:/my/classdock.html:45) | aria-label |  | PDF 페이지 |
| [classdock.html:49](D:/my/classdock.html:49) | text | btnPdfNight | 야간 보기 |
| [classdock.html:91](D:/my/classdock.html:91) | aria-label | petFocusSetFocus | 집중 시간(분) |
| [classdock.html:92](D:/my/classdock.html:92) | aria-label | petFocusSetBreak | 휴식 시간(분) |
| [classdock.html:103](D:/my/classdock.html:103) | aria-label |  | 빠른 도구 |
| [classdock.html:120](D:/my/classdock.html:120) | aria-label |  | PDF 확대/축소 |
| [classdock.html:124](D:/my/classdock.html:124) | aria-label | headerZoomLabel | 확대 비율을 100%로 맞추기 |
| [classdock.html:243](D:/my/classdock.html:243) | text | sbNewPhotoAlbum | 새 사진첩 |
| [classdock.html:247](D:/my/classdock.html:247) | text | sbNewTrip | 새 여행일지(.trip) |
| [classdock.html:259](D:/my/classdock.html:259) | text | sbNewDbConn | 새 DB 접속(.dbconn) |
| [classdock.html:287](D:/my/classdock.html:287) | text | sbLottoPicker | 로또 번호 뽑기 |
| [classdock.html:291](D:/my/classdock.html:291) | text | sbPensionPicker | 연금복권 번호 뽑기 |
| [classdock.html:307](D:/my/classdock.html:307) | text | sbExamGrade | 시험 채점(.examdone) |
| [classdock.html:321](D:/my/classdock.html:321) | text | remoteTerminalOpen | 원격 터미널 |
| [classdock.html:425](D:/my/classdock.html:425) | aria-label |  | 목적별 새 작업 |
| [classdock.html:443](D:/my/classdock.html:443) | text | dzNewTrip | 새 여행일지(.trip) |
| [classdock.html:459](D:/my/classdock.html:459) | text | dzLottoPicker | 로또 번호 뽑기 |
| [classdock.html:460](D:/my/classdock.html:460) | text | dzPensionPicker | 연금복권 번호 뽑기 |
| [classdock.html:514](D:/my/classdock.html:514) | text | scratchpadAddTable | + 표 |
| [classdock.html:668](D:/my/classdock.html:668) | text | settingsTabs | 도구 |
| [classdock.html:772](D:/my/classdock.html:772) | text | settingsModal | 새 보드 기본 배경 |
| [classdock.html:772](D:/my/classdock.html:772) | text | settingsModal | 새로 여는 화이트보드에만 적용됩니다. 이미 만들어 둔 보드는 그대로 두고, 보드마다 도구막대에서 따로 바꿀 수 있어요. |
| [classdock.html:772](D:/my/classdock.html:772) | aria-label | settingBoardBg | 새 화이트보드 기본 배경 |
| [classdock.html:773](D:/my/classdock.html:773) | text | settingsModal | Word·PowerPoint 찾아 바꾸기 |
| [classdock.html:774](D:/my/classdock.html:774) | text | settingsModal | 머리말·꼬리말·각주·발표자 노트도 함께 바꾸기 |
| [classdock.html:774](D:/my/classdock.html:774) | text | settingsModal | 꺼 두면 본문(Word 본문·슬라이드)만 바꾸고, 본문 밖에 걸린 곳은 개수만 알려 줍니다. 메모(검토 의견)·차트·도형 안 글자는 어느 쪽이든 바꾸지 않습니다. |
| [classdock.html:775](D:/my/classdock.html:775) | text | settingsModal | 변경 내용 추적이 켜진 문서도 바꾸기 |
| [classdock.html:775](D:/my/classdock.html:775) | text | settingsModal | 이 프로그램이 바꾼 내용은 Word의 변경 이력에 남지 않습니다. 검토 중인 문서라면 꺼 두세요. |
| [classdock.html:790](D:/my/classdock.html:790) | text | settingsModal | 화면을 고른 뒤 필요한 도구를 오른쪽 |
| [classdock.html:790](D:/my/classdock.html:790) | text | settingsModal | 노출 |
| [classdock.html:790](D:/my/classdock.html:790) | text | settingsModal | 목록으로 옮기세요. 여러 항목은 Ctrl·Shift로 함께 선택할 수 있습니다. (변경은 저장 즉시 적용) |
| [classdock.html:791](D:/my/classdock.html:791) | aria-label | settingToolScopeTabs | 도구를 설정할 화면 |
| [classdock.html:792](D:/my/classdock.html:792) | text | settingToolScopeTabs | 헤더 |
| [classdock.html:797](D:/my/classdock.html:797) | text | settingToolScopeTabs | 이미지 |
| [classdock.html:800](D:/my/classdock.html:800) | text | settingToolScopeTabs | 악보 |
| [classdock.html:804](D:/my/classdock.html:804) | text | settingToolTransfer | 비노출 |
| [classdock.html:805](D:/my/classdock.html:805) | aria-label | settingToolsHidden | 비노출 도구 |
| [classdock.html:807](D:/my/classdock.html:807) | aria-label |  | 도구 노출 상태 바꾸기 |
| [classdock.html:808](D:/my/classdock.html:808) | aria-label | settingToolsShow | 선택한 도구 노출 |
| [classdock.html:808](D:/my/classdock.html:808) | title | settingToolsShow | 선택한 도구 노출 |
| [classdock.html:809](D:/my/classdock.html:809) | aria-label | settingToolsHide | 선택한 도구 비노출 |
| [classdock.html:809](D:/my/classdock.html:809) | title | settingToolsHide | 선택한 도구 비노출 |
| [classdock.html:812](D:/my/classdock.html:812) | text | settingToolTransfer | 노출 |
| [classdock.html:813](D:/my/classdock.html:813) | aria-label | settingToolsVisible | 노출 도구 |
| [classdock.html:816](D:/my/classdock.html:816) | text | settingsModal | 항상 표시: |
| [classdock.html:823](D:/my/classdock.html:823) | text | settingsModal | 집중·휴식 시간(분) |
| [classdock.html:823](D:/my/classdock.html:823) | aria-label | settingPetFocusMin | 집중 시간(분) |
| [classdock.html:823](D:/my/classdock.html:823) | aria-label | settingPetBreakMin | 휴식 시간(분) |
| [classdock.html:865](D:/my/classdock.html:865) | text | settingsModal | 오류와 마지막 정상 화면 상태를 이 컴퓨터에만 기록합니다. 문서 본문·코드·API 키·개인 경로는 로그에서 제외됩니다. |
| [classdock.html:868](D:/my/classdock.html:868) | aria-label | diagnosticLevelFilter | 진단 로그 수준 |
| [classdock.html:868](D:/my/classdock.html:868) | text | diagnosticLevelFilter | 모든 수준 |
| [classdock.html:868](D:/my/classdock.html:868) | text | diagnosticLevelFilter | 경고 |
| [classdock.html:868](D:/my/classdock.html:868) | text | diagnosticLevelFilter | 정보 |
| [classdock.html:869](D:/my/classdock.html:869) | aria-label | diagnosticScreenFilter | 진단 로그 화면 |
| [classdock.html:869](D:/my/classdock.html:869) | text | diagnosticScreenFilter | 모든 화면 |
| [classdock.html:870](D:/my/classdock.html:870) | placeholder | diagnosticSearch | 종류·메시지 검색 |
| [classdock.html:870](D:/my/classdock.html:870) | aria-label | diagnosticSearch | 진단 로그 검색 |
| [classdock.html:875](D:/my/classdock.html:875) | text | diagnosticEmpty | 조건에 맞는 진단 기록이 없습니다. |
| [classdock.html:877](D:/my/classdock.html:877) | text | diagnosticCopy | 로그 복사 |
| [classdock.html:879](D:/my/classdock.html:879) | text | diagnosticOpenFolder | 로그 폴더 열기 |
| [classdock.html:881](D:/my/classdock.html:881) | text | diagnosticClear | 전체 삭제 |
| [classdock.html:941](D:/my/classdock.html:941) | text | petBuilderModal | 우선 등장 — 펫을 켤 때 이 친구를 먼저 보여주기 |
| [classdock.html:960](D:/my/classdock.html:960) | text | welcomeModal | ClassDock에 오신 걸 환영해요 |
| [classdock.html:1010](D:/my/classdock.html:1010) | text | helpModal | Ctrl+클릭 |
