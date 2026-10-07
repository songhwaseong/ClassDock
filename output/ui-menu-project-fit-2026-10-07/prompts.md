# ClassDock 프로젝트 구조 기반 UI 시안 생성 프롬프트

생성 방식: built-in image_gen. 원본 코드 분석은 analysis.md에 기록.
첨부 메뉴 이미지는 동작·아이콘 참고용, 프로젝트 로고 파일은 브랜드 참고용으로 사용했다.
이후 생성된 시안 이미지를 편집 대상으로 삼아 UI 구조와 실제 기능 문구를 보정했다.

## 공통 구조 프롬프트

Use case: ui-mockup. Asset: one high fidelity image of a proposed ClassDock + menu redesign grounded in inspected local HTML/CSS/JS. This is a source-based design concept, not an actual screenshot. Generate a landscape 1536x1024 flat desktop app view; prioritize exact structural placement over artistic invention.
REFERENCE ROLES: Image 1 is the user's existing + MENU only, reference for actions and outline icons; do not reuse its long flat layout. Image 2 is the project's genuine logo MARK, use small only in top header wordmark.
MANDATORY PROJECT SHELL: App fills the canvas, no browser chrome, no device frame or outer presentation board. At TOP a full-width dark slate #1e293b header 56px high: left small sidebar toggle icon then small white/blue ClassDock wordmark with supplied mark; center existing compact search-like control "기능 검색·실행" and "Ctrl+K"; right compact outline icons for file/folder/save, settings/help/theme, with tiny "EN". Immediately BELOW it a full-width dark navy #0f172a DOCUMENT TAB STRIP approx 40px high: left a small rounded "기본 작업공간" button with a dot and chevron. This is a tab strip, not sidebar navigation.
Below tab strip, an OPEN DARK NAVY #0f172a FILE SIDEBAR drawer at x=0 width EXACTLY approx 220px. It overlays the workspace, does NOT push or shrink the whole main workspace. Sidebar top small "파일 0개 · 0 B", below a 34px-high slim search input "파일명·내용 검색", then empty file-list area with subtle muted "열린 파일이 없습니다". There is NO home/nav section, NO big logo in sidebar, NO side nav items for favorites/settings/schedule. Sidebar BOTTOM has a single row of FOUR small equal outline-icon buttons, in order FOLDER, PLUS, STAR, ELLIPSIS; 8px outer padding, 6px gaps, 38px height, 8px corner radius. PLUS is SECOND, x approx 83px, at bottom of screen, visibly active with indigo border. Never move the plus to sidebar top.
MAIN WORKSPACE extends from under the tab strip, light cool gray #eef2f7, subtly dimmed by the open drawer backdrop. To the RIGHT beyond menu, show muted existing empty-state content "파일을 열어 바로 시작하세요" with smaller "파일 열기" / "폴더 열기" buttons. Keep it subordinate and partially obscured if needed. Do not invent a dashboard.
PROJECT TOKENS: White panel #ffffff, primary black text, muted #64748b, indigo accent #4f46e5, border #e2e8f0, hover #f1f5f9, fine outline icons with 1.8px stroke. Korean Malgun Gothic-like clean UI font. Body labels around 12.5-14px, modest headings 16px. Borders 1px, popup corners 10-12px, clean shadow. Color icon tints can echo existing types: Python ochre #caa019, sheet green #1f9d57, database teal #0f9f8f, image purple #8b5cf6; avoid large multicolor logos and huge marketing typography.
MENU CONSTRAINTS: Only redesign the + menu, floating ABOVE the BOTTOM PLUS button with a 7px gap, left edge near x=60-70px, extending right over main workspace; fit inside viewport with generous breathing room; keep bottom button visible. Search and grouping are proposed improvements. This app already has global Ctrl+K search in header; menu search is scoped to these 26 actions. Preserve action semantics, especially "사진첩 열기", "리플레이 열기", "제출본 일괄 검수", "시험 채점" are OPEN/PROCESS actions not create-photo or create-replay.
Exact action set, grouped for designs: "코딩·데이터" = 파이썬 코드 .py, 자바스크립트 코드 .js, 자바 코드 .java, 노트북 .ipynb, 빈 표 .xlsx, DB 접속 .dbconn (6). "문서·기록" = 텍스트 파일 .txt, 블록 문서 .mnote, 일기장 .diary, 여행일지 .trip, 사진첩 열기 (5). "수업 자료" = 화이트보드, 악보 .msheet, 지도 .map, 연대표 .timeline, 개념 관계도 .concept, 암기 카드 .study (6). "활동·뽑기" = 티어표 .tier, 대진표 .bracket, 복불복 뽑기 .pick, 로또 번호 뽑기, 연금복권 번호 뽑기 (5). "열기·검수" = 리플레이 열기 .lesson, 제출본 일괄 검수 .taskdone, 시험지 만들기 .exam, 시험 채점 .examdone (4).
Do not invent new functions or favorites persistence, no new icon sidebar, no giant launcher filling entire app. Crisp readable correct Korean, front view, no watermark.

## 변형 시안용 공통 지침

Use case: ui-mockup. Create a NEW alternative menu design from the supplied source-based ClassDock design reference. Input image is a STRUCTURAL REFERENCE, not a request to reproduce its list menu. Preserve the genuine project structure: dark slate top header with small ClassDock brand, centered existing "기능 검색·실행" Ctrl+K, compact right utility icons. Directly below header MUST be a dark navy horizontal DOCUMENT TAB STRIP whose LEFT end has a compact rounded "기본 작업공간" button with colored dot and chevron; reference accidentally omitted this button, RESTORE it in the empty dark strip. Dark navy FILE sidebar under tab strip, approx 220px wide at normal scale, top "파일 0개 · 0 B" and "파일명·내용 검색", an empty file-list. Sidebar BOTTOM four equal icon buttons FOLDER, PLUS, STAR, ELLIPSIS in that order, SECOND plus active. No home/favorites/settings/nav items in FILE sidebar. Light gray main workspace with subdued title "파일을 열어 바로 시작하세요", actual description "PDF·문서·이미지·코드 등 여러 파일을 한 작업 공간에서 다룰 수 있어요.", and 파일 열기 / 폴더 열기 buttons. Sidebar overlays workspace. Palette from actual CSS: header #1e293b, sidebar and tabstrip #0f172a, main #eef2f7, panels #fff, accent #4f46e5, borders #e2e8f0, muted #64748b. Compact Korean UI typography, 12.5-14px labels, 10-14px popup corners, 1.8px outline icons. Icon tints echo ochre Python/green sheet/teal DB/purple image. Reuse SAME surrounding APP CHROME and change only the PLUS menu. Avoid oversized whole-app redesign, marketing text, photo device frames, new unrelated features. Render a flat 1536x1024 desktop app concept image. Menu semantics must distinguish creation versus open/processing actions. Full 26 action set remains accessible via groups/search, even if current category only shows subset.

## 01 압축 검색형

최종 파일: 01-compact-search.png

VARIANT 01 COMPACT SEARCH LIST. Light theme shell exactly as above. Popup approx 330px wide and 520px high, located above bottom second plus at x=65, bottom 960 on this 1024px canvas. Header "새로 만들기" with small "26개 도구" right and modest close. Pinned search "도구 이름·확장자 검색". TWO ROWS of compact category chips "전체" selected indigo, "코딩" "문서" "수업" "활동" "검수". Below a SCROLLING list with small group labels and icon rows. Visible group 코딩·데이터 six rows, then 문서·기록 with 텍스트 파일 and 블록 문서. Tiny extension pills right, no per-row long descriptions. One row hover light indigo. Thin scroll indicator shows more groups. A short footer "전체 기능 검색 Ctrl+K". Actual small compact popup, background majority stays visible; 14px labels legible. Make sidebar bottom four buttons visibly intact.

## 02 작은 카드형

최종 파일: 02-small-cards.png

VARIANT 02 COMPACT TWO-COLUMN CARDS. Light theme. Preserve entire app shell. Popup approx 510px wide by 555px tall above bottom second plus at x=65. Top "새로 만들기" small count "26개 도구". Search "도구 이름·확장자 검색". Wrap five category tabs neatly: "코딩·데이터" SELECTED indigo, "문서·기록", "수업 자료", "활동·뽑기", "열기·검수". Selected category six equal compact cards in a TWO-COLUMN by THREE-ROW grid: 파이썬 코드 .py, 자바스크립트 코드 .js, 자바 코드 .java, 노트북 .ipynb, 빈 표 .xlsx, DB 접속 .dbconn. Each card has SMALL outlined icon in subtle tinted square left, title, extension and very short description "코드 작성·실행" / "셀 단위 실행" / "표 만들기" / "데이터베이스 연결". Cards about 80px high, no oversized glyphs. Bottom quiet link "전체 도구 보기" and count "코딩·데이터 6개". Card architecture intended for discoverability, NOT a new full-page dashboard. Menu above bottom + visibly connected.

## 03 카테고리 2단형

최종 파일: 03-two-pane-categories.png

VARIANT 03 CATEGORY SIDEBAR INSIDE POPUP. Light theme. Preserve entire application shell, especially bottom + position. Popup approx 580px wide and 550px tall above the bottom plus at x=65, not a new full-height rail. Header "새로 만들기" and full-width search "도구 이름·확장자 검색". Under header, left INNER category rail approx 140px with small icons and counts: "코딩·데이터 6", "문서·기록 5", "수업 자료 6" (SELECTED pale indigo), "활동·뽑기 5", "열기·검수 4". Right pane title "수업 자료", SIX compact rows with clear icons and small extensions: 화이트보드, 악보 .msheet, 지도 .map, 연대표 .timeline, 개념 관계도 .concept, 암기 카드 .study. One-line descriptions short enough to fit. Fine vertical divider, balanced 14px type, all six rows shown without excessive height. Footer muted "26개 도구". This is a local menu panel, avoid replacing the dark FILE sidebar with these category links.

## 04 전체 항목 2열형

최종 파일: 04-all-actions-two-columns.png

VARIANT 04 ALL 26 ACTIONS AT A GLANCE. Light theme shell unchanged. Popup approx 650px wide by 745px high, above bottom plus at x=65, staying below global header/tab bar. Header "새로 만들기" and "26개 도구", compact scoped search. Body in TWO balanced VERTICAL COLUMNS with grouped dense icon rows, 28-30px row height, 12.5px Korean. LEFT COLUMN: 코딩·데이터 (six entries), 文書 group label IN KOREAN "문서·기록" (five entries), 열기·검수 (four entries). RIGHT COLUMN: "수업 자료" (six entries), "활동·뽑기" (five entries). Include ALL 26 distinct actions from common spec exactly once, preserving open/process labels. Extension in small muted text at right. Fine small indigo-tinted group label dividers, 17px outline icons, 8px row radius. "시험지 만들기" distinct from "시험 채점". Keep lower portion neat without clipping. No scroll if everything fits; slim footer "전체 기능 검색 Ctrl+K". Compact utilities aesthetic, no giant cards or decorative illustrations. Menu remains layered over left workspace, not centered full-screen dialog.

## 05 기존 팔레트 연계형

최종 파일: 05-integrated-command-palette.png

VARIANT 05 REUSE EXISTING COMMAND PALETTE FOR PLUS ACTIONS. Light theme shell unchanged, bottom plus still second and active. This ONE variant opens a CENTERED 600px-wide dialog in the app's existing Ctrl+K palette style instead of anchored popover. Position centered horizontally, top approx 12% viewport, height approx 610px, radius 14px, dim entire shell with rgba(15,23,42,.5) overlay, keep actual dark header and bottom sidebar actions visible behind overlay. Dialog "새로 만들기" with modest scope badge "26개 도구" and esc keycap. Prominent search field containing "시험" with magnifier. Two small chips "전체" and "검색 결과 3". Three clear result rows: "시험지 만들기" .exam, "시험 채점" .examdone, "제출본 일괄 검수" .taskdone with short explanations matching semantics. First row selected solid indigo, white text. Small label "관련 도구" and one row "암기 카드" .study. Quiet hint "도구 이름 또는 확장자로 검색하세요". Bottom keyboard guides "↑↓ 이동" "Enter 실행" "Esc 닫기"; small footer link "전체 기능 검색 Ctrl+K". This is a proposed reuse of the existing global search visual pattern with the + action scope. No invented navigation or appwide makeover, no duplicated giant palette behind it.

## 1번 구조 보정 프롬프트

Use case: precise-object-edit, UI mockup correction. Edit target Image 1 is the newly generated ClassDock compact + menu concept. Image 2 is the actual project logo mark supporting asset. Retain the good overall visual design and all menu contents, but correct the source-based APP SHELL GEOMETRY and anchoring. Output landscape 1536x1024.
Make the navy FILE sidebar 220px wide instead of the current ~280px. Header height 56px, document tab bar below it 40px, sidebar starts y=96 and extends to bottom. Sidebar footer is a single row of FOUR equal 38px-tall buttons folder, plus, star, ellipsis. Plus is SECOND, its center around x=84 and y=997; footer has 8px padding and 6px gaps. Keep the plus visible.
Move the WHITE menu LEFT so its LEFT EDGE is x=62 (above second bottom button), NOT aligned with sidebar right edge. Set menu WIDTH 360px and bottom edge y=968, so a 7px gap above footer button. Height around 575px so top y=393. It OVERLAPS both the dark sidebar file-list and the light workspace; this is intentional and essential. Keep menu text crisp at sensible 13-14px rather than scaling everything huge. Header "새로 만들기", scope count "26개 도구", search "도구 이름·확장자 검색", category chips "전체" "코딩" "문서" "수업" "활동" "검수", grouped compact visible action list and footer Ctrl+K.
REMOVE invented bare plus button next to 기본 작업공간 in top tab strip; this empty workspace has no document tabs. Actual brand is Class + [small supplied logo mark as letter D] + ock, with Class in white and ock in blue, height ~26px. NOT an extra standalone logo followed by complete ClassDock word.
Keep global centered top "기능 검색·실행" Ctrl+K and compact right toolbar icons. Sidebar top "파일 0개 · 0 B", search "파일명·내용 검색", empty-list message may be occluded by floating menu.
In main empty state keep title "파일을 열어 바로 시작하세요". Replace invented guidance about left + with actual supporting text "PDF·문서·이미지·코드 등 여러 파일을 한 작업 공간에서 다룰 수 있어요." Keep existing two buttons "파일 열기", "폴더 열기". No added navigation. Core light palette unchanged: header #1e293b, sidebar/tabstrip #0f172a, workspace #eef2f7, popup white, indigo #4f46e5, border #e2e8f0. Front flat UI, no device frame, no watermark.
Make ONLY these structural corrections; do not redesign the concept or turn the menu into a large centered modal.

## 1번 작업공간 버튼 보정

Use case: precise-object-edit. Edit target is supplied ClassDock compact search menu concept. Change ONLY the blank dark horizontal strip between header and main workspace: RESTORE the actual workspace switcher button at the LEFT of this document tab strip. It is a compact rounded rectangle containing a small indigo circular dot, Korean exact text "기본 작업공간", and a downward chevron. Put at x approx 12, y approx 76, width approx 180, height 28-32px. Leave rest of tab strip empty with NO bare plus button. This control must be visible and legible. Preserve every other detail of image: existing header including ClassDock branding and 기능 검색·실행 Ctrl+K, navy file sidebar, bottom four folder/plus/star/ellipsis buttons, white create menu with search, categories and extension pills, main empty state. Do not move or remove the popup. Same resolution 1536x1024. No other changes.

## 3번 화이트보드 확장자·탭 줄 보정

Use case: precise-object-edit. Supplied image is the edit target: ClassDock category two-pane plus menu concept. Change ONLY TWO tiny details: 1. Remove the ".board" extension pill from the right of the "화이트보드" row. The app creates an internal whiteboard and has no .board file format. Keep the row name, outline icon and description, leaving clean empty space where that pill was. 2. Remove the small bare + character immediately to the RIGHT of the "기본 작업공간" dropdown button in the top horizontal tab strip. Leave that area empty dark navy. This empty workspace does not have that top plus. The REAL + menu trigger is still the SECOND of four buttons at the BOTTOM of the navy file sidebar; preserve it visibly active. Preserve EVERYTHING else, including all six real tools, the menu's inner category rail, existing genuine header, workspace switcher itself, main empty state, all other extension tags. No other changes. Same 1536x1024 landscape.

## 4번 실제 26개 동작 보정

Use case: precise-object-edit. Edit target: supplied ClassDock TWO-COLUMN + menu concept. Preserve app shell, menu rectangle, top scoped search and two-column grouped row layout. CORRECT ONLY THE ACTION LIST to exactly match inspected project source. Many currently shown actions are invented and MUST be replaced. The popup must contain EXACTLY the following 26 rows, no extra rows, no substitutions, no OCR/image/video/audio/Word/PowerPoint/quiz/team tools. Treat names below as VERBATIM REQUIRED UI TEXT.
LEFT COLUMN has these groups and rows in exact order:
Heading "코딩·데이터 6"
1 "파이썬 코드" extension ".py"
2 "자바스크립트 코드" ".js"
3 "자바 코드" ".java"
4 "노트북" ".ipynb"
5 "빈 표" ".xlsx"
6 "DB 접속" ".dbconn"
Heading "문서·기록 5"
7 "텍스트 파일" ".txt"
8 "블록 문서" ".mnote"
9 "일기장" ".diary"
10 "여행일지" ".trip"
11 "사진첩 열기" (no extension)
Heading "열기·검수 4"
12 "리플레이 열기" ".lesson"
13 "제출본 일괄 검수" ".taskdone"
14 "시험지 만들기" ".exam"
15 "시험 채점" ".examdone"
RIGHT COLUMN:
Heading "수업 자료 6"
16 "화이트보드" (no extension)
17 "악보" ".msheet"
18 "지도" ".map"
19 "연대표" ".timeline"
20 "개념 관계도" ".concept"
21 "암기 카드" ".study"
Heading "활동·뽑기 5"
22 "티어표" ".tier"
23 "대진표" ".bracket"
24 "복불복 뽑기" ".pick"
25 "로또 번호 뽑기" (no extension)
26 "연금복권 번호 뽑기" (no extension)
All rows have compact appropriate simple outline icon, Korean label and tiny extension pill at right if specified. Use consistent 28-30px row spacing and small 12.5-14px readable labels, around 650px wide panel above bottom plus. Title "새로 만들기", count "26개 도구", footer "전체 기능 검색 Ctrl+K". Remove repeated 새 in row labels to save space. Count actual rows, make all 26 present and legible. Keep the genuine app's dark header, dark tabbar with 기본 작업공간 at left, dark FILE sidebar and BOTTOM four folder/plus/star/ellipsis buttons unchanged. Do not add new functionality. No cropping or excessive blank whitespace, no watermark.

## 5번 실제 기능 설명 보정

Use case: text-localization. Edit target: supplied ClassDock PLUS scoped command palette concept. Keep entire app shell and all dialog geometry, search query "시험", names and extensions, 3 result rows, related 암기 카드 row, keyboard footer. CORRECT ONLY two descriptions that falsely imply AI question generation:
Under "시험지 만들기" replace current sentence EXACTLY with "객관식·주관식·이미지 문항으로 시험지를 만듭니다."
Under "암기 카드" replace current sentence EXACTLY with "문답·빈칸 카드를 만들고 복습합니다."
Under "시험 채점" use EXACTLY "제출된 답안을 채점하고 성적을 정리합니다."
Under "제출본 일괄 검수" use EXACTLY "과제 제출 파일을 모아 확인하고 다시 채점합니다."
Do NOT imply automatic AI-generated questions or AI-generated flashcards. App has no such function. Keep all Korean copy crisp and accurate, with wrapping if needed. Everything else unchanged.

