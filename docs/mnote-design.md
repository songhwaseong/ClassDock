# .mnote 블록 문서 — 설계 문서

> 작성 2026-07-26 · 상태: 설계(미착수) · 목표: 표·이미지·글을 한 문서에서 함께 편집

## 1. 목표와 범위

한 문서 안에서 **글(문단), 이미지, 표**를 블록 단위로 섞어 편집하고, 자체 확장자 **`.mnote`(JSON)** 로 저장·재편집한다. 워드형 리치텍스트(`contenteditable` 한 덩어리)가 아니라 **노션형 블록 문서**로 간다.

**왜 블록 방식인가**: 이 앱의 되돌리기(`history.js`), 통합검색, 수업 리플레이, 오프라인 저장이 전부 구조화 데이터 기준으로 굴러간다. `contenteditable`은 표/이미지 리사이즈·커서·붙여넣기 버그가 심하고 저장 포맷이 지저분해 그 자산들과 부딪힌다.

**핵심 사실**: `scratchpad.js`가 **이미 블록 모델**(`type:"text" | "image" | "notebook-cell"`)을 갖고 있다. 이 설계는 새 아키텍처가 아니라 그 모델을 **① 정식 문서 종류로 승격 + ② `table` 블록 추가 + ③ 파일 저장(.mnote)** 으로 확장하는 것이다.

### 범위
- **포함**: text·image·table 세 블록, 블록 추가/삭제/순서이동, `.mnote` 저장·열기, HTML/MD 내보내기
- **1차 제외**: 실시간 협업, 코드(notebook-cell) 블록 재활용은 선택(2차), 중첩 블록·다단 레이아웃

## 2. 데이터 모델 (.mnote 스펙)

`.mnote` 파일 = **UTF-8 JSON 한 개**. scratchpad의 `note.blocks` 구조를 그대로 계승한다.

```jsonc
{
  "format": "manneung-note",     // 판별 서명
  "version": 1,
  "title": "문서 제목",
  "createdAt": 0, "updatedAt": 0,
  "blocks": [
    { "id": "text-...",  "type": "text",  "text": "문단 내용(줄바꿈 허용)" },
    { "id": "image-...", "type": "image", "src": "data:image/png;base64,...",
      "name": "그림.png", "mime": "image/png", "width": "medium", "position": "left", "caption": "" },
    { "id": "table-...", "type": "table",
      "rows": [ ["머리1","머리2"], ["a","b"] ],
      "header": true, "align": ["left","right"] }
  ]
}
```

### 이미지 저장 — 두 방안
| 방안 | 내용 | 평가 |
|------|------|------|
| **A. base64 임베드** (1차 추천) | 이미지 바이트를 `src`에 data URI로 박음 | 파일 하나로 완결·이동 자유. 단점: 큰 이미지 시 JSON 비대(1.33배) |
| B. zip 컨테이너 | `.mnote`를 zip으로: `note.json` + `assets/*.png` | 큰 이미지 효율적. 단점: 로직 복잡, `.task/.lesson` 포맷 확인 필요 |

> scratchpad는 이미지를 **브라우저 로컬 IndexedDB**(`manneung-scratchpad-assets`)에 assetId로 보관한다. 이건 메모가 브라우저에 갇혀 있어서 가능한 방식이고, **이동 가능한 파일**인 `.mnote`에는 맞지 않는다 → **파일 안에 바이트를 담아야** 한다. 편집 중 메모리에서는 IDB 캐시를 재활용하되, 저장 시 base64로 인라인.

**결정**: 1차는 A(base64). 이미지 다수 문서에서 느려지면 B로 승격.

## 3. 블록 종류

| type | 편집 UI | 재활용 |
|------|---------|--------|
| `text` | scratchpad `makeTextBlock`과 동일(멀티라인 textarea/div) | scratchpad.js 그대로 |
| `image` | 클릭 삽입, 크기(small/medium/large/full)·정렬, 캡션 | `image-viewer.js`, scratchpad `makeImageBlock` |
| `table` | **신규**. 셀 인라인 편집, 행·열 추가/삭제, 머리글 토글, 정렬 | 가벼운 자체 구현. 무거운 계산 필요 시 `spreadsheet-viewer.js` 임베드 |

**table 블록 편집 UX(1차)**: `<table>` + 셀 `contenteditable`(셀 단위라 리치텍스트 함정 없음). 행 끝 `＋`, 열 끝 `＋`, 셀 우클릭/툴바로 삭제. Tab=다음 셀, Enter=아래 셀.

## 4. 아키텍처 접점 (파일별)

기존 `.lesson`/`.task` 문서가 붙는 경로를 그대로 따른다.

| # | 파일 | 추가/변경 |
|---|------|-----------|
| 1 | **`src/js/mnote.js`** (신규) | 핵심 로직: `loadMnote(file, opts)`, 렌더러, 블록 편집기, 직렬화 `blocksToMnote`/`mnoteToBlocks`, 내보내기 |
| 2 | `file-loaders.js` `handleFiles` (56행 부근) | `else if (ext === "mnote") made = await loadMnote(file, opts);` 한 줄 |
| 3 | `documents.js` `makeDoc` | 새 `kind:"mnote"` 허용(el 클래스는 "office" 재사용) |
| 4 | `code-viewer.js` `saveTextDoc` (2651행) | 저장 경로 재활용 — mnote는 `JSON.stringify(mnote)`를 넘김. 파일 핸들/서버/다운로드 3경로 그대로 |
| 5 | scratchpad 블록 함수 | `makeTextBlock`·`makeImageBlock`을 공용 모듈로 분리하거나 mnote.js에서 재구현 |
| 6 | `command-palette.js` | "새 블록 문서(.mnote)" 명령 추가 → 빈 `.mnote` 생성 |
| 7 | 통합검색 `documents.js` | `.mnote`의 블록 텍스트를 검색 인덱스에 노출 + `doc.contentSearchFocus`로 일치 블록 스크롤 |
| 8 | `history.js` | 블록 편집 되돌리기 훅(블록 단위 스냅샷 or 텍스트 diff) |
| 9 | `i18n.js` | 새 UI 문자열 사전 등록(2단계 translateTree 한 줄) |
| 10 | 아이콘 `icons.js` | 표/이미지/블록추가 아이콘 |

### 렌더 패턴 (기존과 동일)
```js
async function loadMnote(file, opts){
  const mnote = mnoteParse(await file.text());
  const doc = makeDoc("mnote", file.name, opts);
  doc.mnote = mnote;
  doc.render = async () => { doc.el.innerHTML = ""; mountMnoteEditor(mnote, doc.el, doc); };
  doc.contentSearchFocus = (q) => mnoteFocusMatch(doc, q);
  refreshChrome();
  activateIfIdle(doc, opts);
  return doc;
}
```

## 5. 저장·로드 경로

- **로드**: `handleFiles` → 확장자 `.mnote` 분기 → `loadMnote` → JSON 파싱 → 블록 렌더. 파싱 실패 시 `loadText` 폴백(기존 ipynb 실패 처리와 동일 패턴).
- **저장(Ctrl+S/💾)**: `mnoteSerialize(mnote)` → `saveTextDoc(json, doc, name)`. 이미 검증된 경로라 원본 파일 덮어쓰기·서버 저장·다운로드가 공짜로 따라온다. `markDocumentDirty`로 편집 표시.
- **자동 저장/초안**: 코드뷰의 `persistTextDraft`와 동일 훅 재활용 검토.

## 6. 편집 UX

- 문서는 세로 블록 스택. 각 블록에 hover 시 좌측 핸들(≡=드래그 이동, ⋯=메뉴).
- 블록 사이 `＋` → text/image/table 추가 선택.
- 빈 문서는 text 블록 1개로 시작(scratchpad `scratchpadTextBlock` 규칙 계승 — 마지막 블록 삭제 시 빈 text로 대체).
- 드래그 순서 이동은 scratchpad의 `effectAllowed`/dnd 로직 이식.
- 이미지 삽입: 파일 선택 + 붙여넣기(clipboard) + 드래그.

## 7. 내보내기

`.mnote`(JSON)는 앱 전용 재편집 포맷. 공유용은 별도 내보내기:
- **HTML** — 블록을 `<p>/<figure><img>/<table>`로 직렬화. 표·이미지 배치 온전.
- **Markdown** — 표는 GFM 표, 이미지는 `![](data:...)` 또는 첨부. 배치 정밀도는 한계.

## 8. 단계별 구현 계획

1. **P0 — 표 블록 프로토타입** ✅ *(2026-07-26 구현)*: scratchpad에 `type:"table"` 블록 추가. 셀 편집(contenteditable, 셀 단위라 리치텍스트 함정 없음)·Tab/Enter 이동·행열 추가삭제·머리글 토글·잠금·드래그이동. 저장은 기존 scratchpad 경로(localStorage) 재사용. 접점: `scratchpad.js`(scratchpadTableBlock/normalize/plainText/makeTableBlock/insertTableBlock/카운트), `manneung-classroom.html`(+표 버튼), `styles.css`(.scratchpad-table*). *→ 실제 표 편집 UX 검증용.*
2. **P1 — .mnote 문서 종류** ✅ *(2026-07-26 구현)*: 신규 `src/js/mnote.js`(자립 모듈) — 모델·파서(mnoteParse/Serialize)·블록 편집기(text·table·image 세 블록 모두)·저장(saveTextDoc 재사용)·열기(loadMnote)·새 문서(newMnoteScratch). 이미지는 base64 임베드(결정대로). 접점: `file-loaders.js`(.mnote 분기 한 줄), `command-palette.js`(새 블록 문서 명령), `scripts.manifest.json`(localScripts+layer+deps), `manneung-classroom.html`(script 태그), `styles.css`(.mnote-*). 표는 P0 UX를 이식. Ctrl+S는 `.run-save` 버튼으로 전역 핸들러와 자동 연동.
3. **P2 — 내보내기** ✅ *(2026-07-26 구현)*: `mnote.js`에 `mnoteToHtml`(pre-wrap 문단·thead/tbody 표·figure 이미지, 자립 HTML 문서)·`mnoteToMarkdown`(GFM 표·`![](data:)` 이미지·캡션) + `mnoteDownload`(Blob+`<a download>`). 편집기 상단바에 "⬇ HTML"·"⬇ MD" 버튼. 표 블록 정식 편입은 P1에 이미 포함. node로 출력 검증 완료.
4. **P3 — 검색·되돌리기 통합** ✅ *(2026-07-26 구현)*:
   - **통합검색**: `documents.js`에 `isMnoteSearchable`·`mnoteSearchText` 추가. `hasLiveDocText`·`liveDocText`·`isTextSearchable` 세 곳에 mnote 분기 — 노트북과 동일하게 sourceFile(JSON)이 아니라 **블록 모델의 plain text**를 검색(키·base64 오탐 방지). 결과 클릭 → `doc.contentSearchFocus`(mnoteFocusMatch)로 일치 블록 스크롤.
   - **되돌리기**: `mnote.js`에서 `MNEditHistory.create`(공용 history.js). 제목+블록 메타데이터를 문자열 스냅샷으로 보관하고, 변경되지 않는 이미지 base64는 문서 세션 Map에 한 번만 둔다. limit 80 + 텍스트 총량 maxBytes 24MB. 구조 변경 전에 대기 중인 타이핑을 `flush()`해 별도 경계로 확정하고, 구조 변경=`touch(true)`, 타이핑=`touch()`(commitSoon 묶기). 저장 시점도 `flush()`해 독립 기준점으로 남긴다. 상단바 ↶↷ 버튼 + Ctrl+Z/Y(스프레드시트 규약: 텍스트 입력 중엔 브라우저 기본 undo, 그 외엔 모델 undo). `doc.cleanupFns`로 리스너 정리.
   - 명령팔레트는 P1에서 이미 추가, i18n 사전은 후속 과제로 남김.
5. **P4(선택)** — zip 컨테이너, notebook-cell 재활용, MD 내보내기, 수업 리플레이 연동.

## 9. 리스크·결정 필요

- **표 편집 UX**가 가장 불확실 → P0에서 먼저 검증하고 넘어간다.
- **이미지 저장(base64 vs zip)**: 1차 base64 확정, 성능 문제 시 재검토.
- **text 블록 편집기 재사용 방식** → **결정(2026-07-26): mnote에서 별도 구현.** scratchpad의 `makeTextBlock`(scratchpad.js:774)은 mount 클로저 안에 있어 로컬 상태·함수 10여 개(`makeBlockShell`·`moveBlock`·`removeBlock`·`persist`·`activeNote`·`renderEditor`·`touchNote`·`addImageBlobs` 등)에 깊게 얽힘 → 지금 공용 모듈로 분리하면 살아있는 scratchpad 회귀 위험 큼. 대신 ① 전역 헬퍼(`MNKoreanSpellcheck.attach`, `shortcutMatches`, `shortcutActionForEvent`)는 그대로 재활용, ② 편집 코어를 콜백 계약(`mnoteTextBlock(block, { onInput, onPasteImage, onSaveShortcut })`)으로 설계해 나중(P4) 공용 모듈 승격 경로를 열어둔다.
- **exe 재빌드**: 코드 반영 시 오프라인 HTML→build→exe까지 재빌드 필요(프로젝트 규칙).
