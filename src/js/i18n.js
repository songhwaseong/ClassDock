/* 한국어 ⇄ English UI 다국어(i18n) — 1단계: 핵심 셸
 *
 * - window.t(ko): JS 문자열 번역기. 사전에 없으면 원문(한국어)을 그대로 돌려준다.
 * - 정적 셸(헤더·메뉴·사이드바·설정·대화상자 등)을 로드 시 자동 번역한다.
 *     · 텍스트 노드: 앞뒤 공백을 보존하며 사전 일치 시 치환
 *     · 속성: title/aria-label/placeholder/alt (단축키가 관리하는 title/aria는 제외)
 *     · data-i18n="key" 를 붙인 리치 블록: HTML 통째 교체(HTML_DICT[key])
 *   모든 치환은 원문을 기억해 두어 한국어로 되돌릴 수 있다(파괴적이지 않음).
 * - 헤더 언어 토글(한/EN). 선택은 localStorage "uiLang" 에 저장되어 재실행에도 유지.
 *
 * 서버 없이 완전 오프라인으로 동작한다. 사전에 없는 동적 문구는 한국어로 남으며
 * 다음 단계에서 사전을 넓혀 커버리지를 늘린다.
 */
(function () {
  "use strict";

  function storedLang() {
    try { return localStorage.getItem("uiLang"); } catch (_) { return null; }
  }
  function detectLang() {
    var s = storedLang();
    if (s === "ko" || s === "en") return s;
    try {
      var nav = (navigator.language || navigator.userLanguage || "").toLowerCase();
      if (nav && nav.indexOf("ko") !== 0) return "en"; // 한국어 브라우저가 아니면 영어로 시작
    } catch (_) {}
    return "ko";
  }

  var lang = detectLang();

  /* ── 원자 문구 사전(한국어 → English). 트림된 텍스트/속성 값이 키. ── */
  var DICT = {
    // 헤더
    "왼쪽 사이드 메뉴 숨기기": "Hide sidebar",
    "만능파일교실": "Manneung File Classroom",
    "원본 저장": "Original file",
    "브라우저 파이썬(Pyodide) 준비 상태": "Browser Python (Pyodide) status",
    "편집": "Edit",
    "서명": "Signature",
    "텍스트": "Text",
    "날짜": "Date",
    "✓ 체크": "✓ Check",
    "✏️ 필기": "✏️ Ink",
    "PDF 위에 펜·형광펜으로 필기": "Draw on the PDF with pen/highlighter",
    "코드 연결": "Link code",
    "현재 Python 줄을 PDF에 연결": "Link the current Python line to the PDF",
    "페이지": "Pages",
    "목차": "Outline",
    "문서 목차(책갈피)로 이동": "Jump to a section via the outline (bookmarks)",
    "목차 확인 중…": "Checking outline…",
    "이 PDF에는 목차(책갈피)가 없어요": "This PDF has no outline (bookmarks)",
    "목차 닫기": "Close outline",
    "(제목 없음)": "(untitled)",
    "PDF 목차(책갈피)": "PDF outline (bookmarks)",
    "썸네일·정리": "Thumbnails",
    "페이지 썸네일·추출·정리": "Page thumbnails, extract, organize",
    "PDF 합치기": "Merge PDF",
    "현재 PDF 뒤에 다른 PDF 합치기": "Append another PDF after this one",
    "🌙 야간 보기": "🌙 Night view",
    "PDF 페이지 색을 반전해 눈부심 줄이기 (화면 표시만 바뀌고 저장에는 영향 없음)": "Invert PDF page colors to reduce glare (display only — saving is unaffected)",
    "PDF 야간 보기(색 반전)": "PDF night view (invert colors)",
    "메모": "Notes",
    "임시 메모": "Scratchpad",
    "다운로드": "Download",
    "PDF 다운로드": "Download PDF",
    "문서 영역 전체화면": "Fullscreen document area",
    "⛶ 전체화면": "⛶ Fullscreen",
    "인쇄 / PDF로 저장": "Print / Save as PDF",
    "기능 검색·실행": "Search & run features",
    "기능 검색": "Search",
    "분할 작업": "Split view",
    "참고 문서와 작업 문서를 나란히 보기": "View reference and working documents side by side",
    "더보기 — 저장 폴더·이미지 메모": "More — save folder, image notes",
    "더보기": "More",
    "직전에 저장한 파일이 있는 폴더 열기": "Open the folder of the last saved file",
    "저장 폴더 열기": "Open save folder",
    "이미지 메모 열기": "Open image notes",
    "이미지 메모": "Image notes",
    "픽셀 펫 집중 모드": "Pixel pet focus mode",
    "집중": "Focus",
    "집중 준비": "Ready to focus",
    "집중 모드 창 닫기": "Close focus panel",
    "집중 시간 진행률": "Focus progress",
    "펫들과 함께 집중할 준비를 해보세요.": "Get ready to focus with your pets.",
    "집중 시작": "Start focus",
    "일시정지": "Pause",
    "종료": "Stop",
    "오늘 완료 0회": "0 done today",
    "설정": "Settings",
    "도움말·단축키": "Help & shortcuts",
    "도움말": "Help",
    "다크 모드로 전환": "Switch to dark mode",
    "라이트 모드로 전환": "Switch to light mode",
    "테마 전환": "Toggle theme",

    // 사이드바
    "열린 파일이 없습니다": "No files open",
    "파일 0개 · 0 B": "0 files · 0 B",
    "파일명·내용 검색": "Search files & contents",
    "파일 및 도구": "Files & tools",
    "파일 또는 폴더 열기": "Open file or folder",
    "파일 추가": "Add files",
    "폴더 열기": "Open folder",
    "새로 만들기 (Alt+N)": "New (Alt+N)",
    "새로 만들기": "New",
    "새 파이썬 코드": "New Python file",
    "새 코드": "New code",
    "새 노트북(.ipynb)": "New notebook (.ipynb)",
    "새 빈 표(엑셀)": "New spreadsheet (Excel)",
    "새 화이트보드": "New whiteboard",
    "새 텍스트 파일": "New text file",
    "리플레이 열기(.lesson)": "Open replay (.lesson)",
    "파이썬 예제 갤러리": "Python examples gallery",
    "현재 파일 새로고침": "Refresh current file",
    "최근 작업공간 지우기": "Clear recent workspace",
    "드래그: 너비 조절 · 더블클릭: 파일명에 자동 맞춤": "Drag to resize · double-click to fit filenames",

    // 문서 컨트롤 / 전체화면 / 분할
    "축소": "Zoom out",
    "맞춤": "Fit",
    "확대": "Zoom in",
    "축소 (Ctrl+-)": "Zoom out (Ctrl+-)",
    "원래대로(맞춤)": "Reset (fit)",
    "확대 (Ctrl++)": "Zoom in (Ctrl++)",
    "페이지 번호 입력 후 Enter로 이동": "Enter a page number, then press Enter",
    "현재 페이지": "Current page",
    "전체화면 종료": "Exit fullscreen",
    "참조 PDF에서 찾기": "Find in reference PDF",
    "읽기 전용": "Read-only",
    "참고 문서 읽기 전용": "Reference read-only",
    "PDF에 필기 (펜·형광펜·지우개)": "Draw on PDF (pen/highlighter/eraser)",
    "PDF 필기": "PDF drawing",
    "참고 문서를 읽기 전용으로 잠그기": "Lock reference as read-only",
    "참고 문서 읽기 전용 잠금": "Lock reference read-only",
    "참고·작업 화면 좌우 위치 바꾸기 (분할바 더블클릭과 동일)": "Swap reference/working sides (same as double-clicking the divider)",
    "참고와 작업 화면 좌우 위치 바꾸기": "Swap reference and working sides",
    "PDF에서 찾기": "Find in PDF",

    // 시작 화면(드롭존)
    "파일을 여기로 끌어다 놓으세요": "Drag and drop your files here",
    "＋ 새로 만들기 ▾": "＋ New ▾",
    "✨ 파이썬 예제 갤러리": "✨ Python examples gallery",

    // 서명 모달
    "서명 추가": "Add signature",
    "아래에 직접 그리거나, 서명 이미지를 업로드하세요.": "Draw below, or upload a signature image.",
    "최근 서명": "Recent signature",
    "다시 사용": "Reuse",
    "서명 보관함": "Signature library",
    "최근 8개 자동 저장": "Last 8 saved automatically",
    "저장된 서명이 없습니다.": "No saved signatures.",
    "지우기": "Clear",
    "이미지 업로드": "Upload image",
    "적용": "Apply to",
    "썸네일에서 선택한 페이지": "Pages selected in thumbnails",
    "모든 페이지": "All pages",
    "삽입": "Insert",

    // 암호 / 이름 / 확인 모달
    "암호 입력": "Enter password",
    "암호로 보호된 파일입니다. 암호를 입력하세요.": "This file is password-protected. Enter the password.",
    "암호": "Password",
    "확인": "OK",
    "이름 입력": "Enter a name",
    "잠깐!": "Wait!",
    "계속하시겠어요?": "Continue?",
    "계속": "Continue",
    "여기에 놓으면 새 탭으로 열려요": "Drop here to open in a new tab",

    // 설정
    "변경 사항은 이 브라우저에 저장됩니다.": "Changes are saved in this browser.",
    "설정 분류": "Settings categories",
    "일반": "General",
    "문서": "Document",
    "펫": "Pets",
    "대기 화면": "Idle screen",
    "단축키": "Shortcuts",
    "화면 글자 크기": "UI text size",
    "보통 (100%)": "Normal (100%)",
    "크게 (112%)": "Large (112%)",
    "아주 크게 (125%)": "Extra large (125%)",
    "라이트 모드 배경": "Light mode background",
    "라이트 모드 본 화면 배경": "Light mode main background",
    "기본 쿨 그레이": "Default cool gray",
    "웜 크림": "Warm cream",
    "민트": "Mint",
    "라벤더": "Lavender",
    "스카이": "Sky",
    "시작할 때 최근 작업공간 자동 복원": "Auto-restore recent workspace on startup",
    "자동 저장 폴더": "Auto-save folder",
    "위치 변경은 즉시 적용되며 기존 파일은 이동하지 않습니다.": "Location changes apply immediately; existing files are not moved.",
    "현재 폴더 보기": "Show current folder",
    "위치 변경": "Change location",
    "PDF 기본 배율": "Default PDF zoom",
    "렌더링 성능": "Rendering performance",
    "메모리 절약": "Save memory",
    "최고 화질": "Best quality",
    "PDF 편집 내용 자동 저장·복원": "Auto-save & restore PDF edits",
    "픽셀 펫 — 작은 캐릭터들이 화면·창 위를 돌아다닙니다 (붙잡아 던지기 가능)": "Pixel pets — little characters roam your screen and windows (grab and toss them)",
    "픽셀 펫 마릿수": "Number of pixel pets",
    "1마리": "1 pet", "2마리": "2 pets", "3마리": "3 pets", "4마리": "4 pets",
    "6마리": "6 pets", "8마리": "8 pets", "10마리": "10 pets", "12마리": "12 pets",
    "펫 집중 모드 — 집중 중에는 조용히 쉬고, 휴식 때 함께 스트레칭": "Pet focus mode — pets rest quietly while you focus and stretch with you on breaks",
    "집중·휴식 시간": "Focus & break time",
    "집중 시간": "Focus time",
    "휴식 시간": "Break time",
    "15분 집중": "Focus 15 min", "25분 집중": "Focus 25 min", "40분 집중": "Focus 40 min", "50분 집중": "Focus 50 min",
    "3분 휴식": "Break 3 min", "5분 휴식": "Break 5 min", "10분 휴식": "Break 10 min",
    "타이핑하는 동안 펫이 화면 가장자리에서 조용히 기다리기": "Pets wait quietly at the screen edge while you type",
    "펫 도감 — 지금까지 만난 친구들": "Pet gallery — friends you've met",
    "열어 보기": "Open",
    "펫 대사 — 클릭하면 말하는 말풍선 직접 쓰기": "Pet lines — write the speech bubbles they say when clicked",
    "나만의 펫 — 그림·움직임·색·대사 조합": "Custom pet — mix art, motion, color, and lines",
    "만들기": "Create",
    "대기 화면(화면보호기) — 일정 시간 입력이 없으면 전체 화면 표시": "Idle screen (screensaver) — shows full screen after a period of no input",
    "표시까지 대기 시간": "Idle time before showing",
    "1분": "1 min", "3분": "3 min", "5분": "5 min", "10분": "10 min", "20분": "20 min",
    "▶ 지금 시작으로 켤 때 영상 소리 재생 — 자동(유휴) 대기 화면은 항상 무음": "Play video sound when started with ▶ Start now — the auto (idle) screensaver is always muted",
    "대기 화면 내용": "Idle screen content",
    "기본 애니메이션(시계)": "Default animation (clock)",
    "여러 개를 선택하면 차례대로 반복 재생 · MP4·WebM 권장": "Select multiple to loop in order · MP4/WebM recommended",
    "영상 선택": "Choose video",
    "영상 지우기": "Clear video",
    "▶ 지금 시작": "▶ Start now",
    "모니터 전체 화면으로 지금 바로 대기 화면을 켭니다 (아무 키·클릭으로 해제)": "Turn on the idle screen full-screen right now (any key/click exits)",
    "항목을 누른 뒤 새 조합을 입력하세요.": "Click an item, then press a new combination.",
    "기본값 복원": "Restore defaults",
    "취소": "Cancel",
    "저장": "Save",

    // 스크래치패드(임시 메모)
    "자동 저장": "Auto-save",
    "저장된 이미지 메모가 없습니다.": "No saved image notes.",
    "메모 닫기": "Close notes",
    "메모 탭": "Note tabs",
    "+ 새 메모": "+ New note",
    "새 메모": "New note",
    "+ 글 블록": "+ Text block",
    "+ 이미지": "+ Image",
    "이미지 붙여넣기·파일/웹 이미지 드롭 가능": "Paste images · drop file/web images",
    "현재 메모 색상": "Current note color",
    "노랑": "Yellow", "노랑 메모": "Yellow note",
    "세이지 그린": "Sage green", "세이지 그린 메모": "Sage green note",
    "라벤더 메모": "Lavender note",
    "소프트 로즈": "Soft rose", "소프트 로즈 메모": "Soft rose note",
    "웜 아이보리": "Warm ivory", "웜 아이보리 메모": "Warm ivory note",
    "임시 메모 내용": "Scratchpad content",
    "0자": "0 chars",
    "이름 변경": "Rename",
    "텍스트 복사": "Copy text",

    // 이미지 메모
    "캡처 후 Ctrl+V로 붙여넣으세요.": "Capture, then paste with Ctrl+V.",
    "이미지 메모 닫기": "Close image notes",
    "Ctrl+V로 캡처 이미지 붙여넣기": "Paste a captured image with Ctrl+V",
    "클릭해서 이미지 선택 · 파일/웹 이미지 드래그 가능": "Click to pick images · drag file/web images",
    "붙여넣은 이미지가 여기에 쌓입니다.": "Pasted images collect here.",
    "0개": "0 items",
    "파일로 다운로드": "Download as file",
    "이미지 미리보기": "Image preview",
    "미리보기 닫기": "Close preview",
    "확대 이미지. 마우스 휠로 확대하고 드래그해서 이동할 수 있습니다.": "Zoomed image. Scroll to zoom, drag to move.",
    "화면 맞춤": "Fit to screen",
    "휠 확대·축소 · 드래그 이동 · 모서리로 창 크기 조절": "Wheel to zoom · drag to move · resize from corners",

    // 펫 도감 / 대사 / 만들기
    "펫 도감": "Pet gallery",
    "펫 도감 종류": "Pet gallery type",
    "친구 도감": "Friends",
    "행동 도감": "Behaviors",
    "닫기": "Close",
    "펫 대사 편집": "Edit pet lines",
    "펫을 짧게 클릭하면 대사 중 하나를 말풍선으로 말해요. 아래에 직접 추가·삭제할 수 있어요.": "Click a pet briefly and it says one of these lines. Add or remove them below.",
    "모든 펫 공통 대사": "Lines for all pets",
    "예: 오늘도 화이팅!": "e.g. You've got this!",
    "추가": "Add",
    "특정 친구에게만": "For a specific friend",
    "친구 고르기": "Pick a friend",
    "친구 고르기 —": "Pick a friend —",
    "이 친구만의 대사": "A line just for this friend",
    "나만의 펫 만들기": "Create your own pet",
    "그림·움직임·색·대사를 골라 나만의 친구를 만들어요. 펫을 켜면 다른 친구들과 함께 무작위로 등장해요.": "Pick art, motion, color, and lines to make your own friend. When pets are on, it appears at random with the others.",
    "색 랜덤": "Random color",
    "이름": "Name",
    "예: 별이": "e.g. Star",
    "그림": "Art",
    "그림 고르기": "Pick art",
    "움직임": "Motion",
    "색": "Color",
    "대사 추가 (예: 반가워!)": "Add a line (e.g. Hi!)",
    "대사 추가": "Add line",
    "내가 만든 펫": "My pets",
    "이 펫 저장": "Save this pet",

    // 환영 / 도움말
    "만능파일교실에 오신 걸 환영해요 👋": "Welcome to Manneung File Classroom 👋",
    "✨ 파이썬 예제로 시작": "✨ Start with Python examples",
    "시작하기": "Get started",
    "기능 둘러보기": "Feature tour",
    "명령 팔레트 — 기능 검색·실행": "Command palette — search & run",
    "파일 열기": "Open file",
    "현재 PDF/Python 저장": "Save current PDF/Python",
    "현재 파일 닫기": "Close current file",
    "닫은 파일 다시 열기": "Reopen closed file",
    "열린 파일 검색": "Search open files",
    "PDF 편집·페이지 작업 되돌리기": "Undo PDF edit / page action",
    "다시 실행": "Redo",
    "이전 / 다음 수업 파일": "Previous / next lesson file",
    "임시 메모 열기·닫기": "Open/close scratchpad",
    "Python 편집기로 포커스": "Focus the Python editor",
    "대기 화면 지금 시작 (모니터 전체)": "Start idle screen now (full monitor)",
    "왼쪽 사이드바 숨기기 / 보이기": "Hide / show left sidebar",
    "새 파이썬 코드 만들기": "Create a new Python file",
    "PDF에서 찾기 (PDF 보기 중)": "Find in PDF (while viewing a PDF)",
    "Python 편집": "Python editing",
    "코드 실행 (노트북: 이 셀만)": "Run code (notebook: this cell only)",
    "노트북: 이 셀 실행 후 다음 셀": "Notebook: run this cell, then next",
    "선택한 줄 삭제": "Delete selected lines",
    "선택한 줄 위로 이동": "Move selected lines up",
    "선택한 줄 아래로 이동": "Move selected lines down",
    "선택한 줄 아래로 복제": "Duplicate selected lines below",
    "선택한 줄 주석 토글": "Toggle comment on selected lines",
    "선택한 줄 들여쓰기": "Indent selected lines",
    "선택한 줄 내어쓰기": "Outdent selected lines",
    "Python 자동완성 열기": "Open Python autocomplete",
    "자동완성 항목 선택": "Select autocomplete item",
    "자동완성 적용": "Apply autocomplete",
    "자동완성 닫기": "Close autocomplete",
    "같은 식별자 동시수정": "Edit the same identifier together",
    "함수 정의 열기": "Open function definition",
    "노트북 전체 셀 찾기·바꾸기": "Find/replace across all notebook cells",
    "현재 셀에서 찾기·바꾸기": "Find/replace in the current cell",
    "열린 검색창 모두 닫기": "Close all open search bars",
    "Ctrl 두 번": "Ctrl twice",
    "문자 입력": "Type a character",
    "더블클릭": "Double-click",
    "처음 사용 안내 보기": "Show the getting-started guide",

    // 공통
    "처리 중…": "Working…",
    "작업 취소": "Cancel task",
    "요소를 끌어 위치 이동 · 더블클릭으로 텍스트 수정 · 모서리로 크기 조절 · Delete 키로 삭제": "Drag to move · double-click to edit text · resize from corners · Delete to remove",

    // ── 2단계: 명령 팔레트(Ctrl+K) ──
    "기능 검색…  (예: 서명, 화이트보드, 어둡게)": "Search features…  (e.g. signature, whiteboard, dark)",
    "명령 팔레트": "Command palette",
    // 설정 → 단축키 (동적으로 만드는 목록)
    "기능을 검색해 바로 실행하는 창 열기": "Open a window to search for and run features",
    "파일 선택 창 열기": "Open the file picker",
    "폴더 전체 열기": "Open a folder",
    "현재 파일 저장": "Save current file",
    "PDF 내보내기 또는 Python 저장": "Export PDF or save Python",
    "활성 탭 닫기": "Close active tab",
    "방금 닫은 탭 복원": "Restore the most recently closed tab",
    "사이드바 검색상자로 이동": "Focus the sidebar search box",
    "사이드바 검색창으로 이동": "Focus the sidebar search box",
    "메모 열기·닫기": "Open or close scratchpad",
    "새 Python 코드": "New Python code",
    "빈 Python 편집기 만들기": "Create a blank Python editor",
    "이전 수업 파일": "Previous lesson file",
    "이전 열린 탭으로 이동": "Move to the previous open tab",
    "다음 수업 파일": "Next lesson file",
    "다음 열린 탭으로 이동": "Move to the next open tab",
    "문서 안에서 찾기": "Find in document",
    "PDF 찾기 또는 편집기 찾기·바꾸기": "Open PDF find or editor find and replace",
    "Python 코드 실행": "Run Python code",
    "현재 Python 코드 실행": "Run current Python code",
    "노트북 전체 실행": "Run all notebook cells",
    "현재 노트북의 모든 코드 셀 실행": "Run all code cells in the current notebook",
    "모니터 전체 화면으로 대기 화면 켜기": "Start idle screen across the entire monitor",
    "단축키": "shortcut",
    "입력 중": "recording",
    "다른 단축키를 누르세요": "Press a new shortcut",
    "명령 검색": "Search commands",
    "일치하는 기능이 없어요": "No matching features",
    "실행하지 못했어요.": "Couldn't run that.",
    "새 노트북 (.ipynb)": "New notebook (.ipynb)",
    "새 빈 표 (엑셀)": "New spreadsheet (Excel)",
    "수업 리플레이 열기 (.lesson)": "Open lesson replay (.lesson)",
    "임시 메모 열기": "Open scratchpad",
    "밝게 / 어둡게 전환 (테마)": "Light / dark toggle (theme)",
    "사이드바 접기 / 펼치기": "Collapse / expand sidebar",
    "대기 화면 지금 시작": "Start idle screen now",
    "설정 열기": "Open settings",
    "도움말 · 단축키": "Help · shortcuts",
    "이전 열린 파일": "Previous open file",
    "다음 열린 파일": "Next open file",
    "분할 작업 켜기 / 끄기": "Toggle split view",
    "PDF 서명 추가": "Add PDF signature",
    "PDF 텍스트 넣기": "Insert PDF text",
    "PDF 날짜 넣기": "Insert PDF date",
    "PDF 체크 표시": "PDF check mark",
    "PDF 펜 · 형광펜 필기": "PDF pen · highlighter ink",
    "페이지 썸네일 · 정리": "Page thumbnails · organize",
    "PDF 다운로드 / 저장": "Download / save PDF",
    "PDF 편집 실행 취소": "Undo PDF edit",
    "PDF 편집 다시 실행": "Redo PDF edit",
    "현재 코드 실행": "Run current code",

    // ── 2단계: 파이썬 실행 툴바 ──
    "실행": "Run",
    "Python 파일 저장": "Save Python file",
    "파일 저장": "Save file",
    "이 폴더에 새 파이썬 파일 · 같은 폴더 모듈 import 가능": "New Python file in this folder · can import same-folder modules",
    "모든 코드 셀을 위에서부터 차례로 실행": "Run all code cells from the top",
    "단계 실행": "Step run",
    "⋯ 더보기": "⋯ More",
    "⋯ 접기": "⋯ Collapse",
    "단계 실행·진단·채점·PDF 핀·Py Env 등 추가 도구": "More tools: step run, diagnose, grade, PDF pin, Py Env, and more",
    "진단": "Diagnose",
    "채점": "Grade",
    ".py 저장": "Save .py",
    "↩ 원본": "↩ Original",
    "라이브러리": "Library",
    "노트북으로": "To notebook",
    "✂ 셀 나누기": "✂ Split cells",
    "자동분할": "Auto-split",
    "PDF에 핀": "Pin to PDF",
    "● 녹화": "● Record",
    "■ 정지": "■ Stop",
    "코드를 실행하며 줄별 변수 변화를 최대 300단계까지 기록": "Run and record per-line variable changes, up to 300 steps",
    "코드를 실행하지 않고 문법과 자주 생기는 실수를 검사": "Check syntax and common mistakes without running",
    "입력값과 기대 출력을 기준으로 현재 코드를 자동 채점": "Auto-grade the current code against inputs and expected outputs",
    // 과제 패키지(.task)
    "📦 과제로 내보내기": "📦 Export as task",
    "현재 코드와 이 테스트로 배포용 과제 파일(.task) 만들기": "Create a distributable task file (.task) from the current code and these tests",
    "과제 파일 만들기 (.task)": "Create task file (.task)",
    "문제 설명·시작 코드·채점 테스트를 한 파일로 묶어 배포합니다. 학생은 더블클릭으로 열어 풀고 제출본(.taskdone)을 내보냅니다. 테스트 내용 수정은 채점 창에서 하세요.": "Bundle the problem, starter code, and grading tests into one file. Students double-click to open, solve, and export a submission (.taskdone). Edit test contents in the grading dialog.",
    "과제 제목": "Task title",
    "출제자(선택)": "Author (optional)",
    "문제 설명(마크다운, 선택)": "Problem statement (Markdown, optional)",
    "시작 코드": "Starter code",
    "데이터 파일(선택)": "Data files (optional)",
    "+ 데이터 파일 첨부": "+ Attach data file",
    "학생 코드가 읽을 데이터 파일(csv·txt 등)을 과제에 포함 (합계 8MB)": "Include data files (csv, txt, …) the student code will read (8MB total)",
    "미리보기": "Preview",
    "편집으로": "Back to edit",
    "👀 학생 화면 미리보기": "👀 Preview as student",
    "만든 과제를 학생이 여는 그대로 열어보기(만들던 내용은 알림의 [이어서 만들기]로 복원)": "Open the task exactly as a student would (restore your draft via [Resume building] in the toast)",
    "📦 .task 내보내기": "📦 Export .task",
    "문제 보기": "View problem",
    "문제 설명을 참고 화면에 다시 띄우기": "Show the problem statement in the reference pane again",
    "✓ 채점": "✓ Grade",
    "과제의 테스트로 현재 코드를 자동 채점": "Auto-grade the current code with this task's tests",
    "📤 제출본 내보내기": "📤 Export submission",
    "이름과 채점 결과를 담은 제출 파일(.taskdone) 만들기": "Create a submission file (.taskdone) with your name and grading results",
    "미채점": "Not graded",
    "숨김": "Hidden",
    "제출본 검수": "Review submission",
    "학생": "Student",
    "제출 시각": "Submitted at",
    "제출본이 신고한 점수": "Score reported by submission",
    "채점 환경": "Grading runtime",
    "파일 검사": "File check",
    "✓ 이상 없음": "✓ Intact",
    "⚠ 파일이 수정되었거나 손상됨": "⚠ Modified or corrupted",
    "검사할 수 없음": "Cannot verify",
    "원본 .task 열기": "Open original .task",
    "열린 과제 다시 확인": "Re-check open tasks",
    "🔁 재채점": "🔁 Re-grade",
    "제출 코드를 원본 과제의 테스트로 이 컴퓨터에서 다시 채점": "Re-grade the submitted code with the original task's tests on this computer",
    "재채점하려면 이 제출본의 원본 과제(.task)를 먼저 여세요.": "Open this submission's original task (.task) first to re-grade.",
    "⚠ 같은 과제 ID의 여러 버전이 열려 있지만 제출 당시 파일과 일치하는 버전을 찾지 못했어요. 원본 .task를 다시 여세요.": "⚠ Multiple versions of this task ID are open, but none matches the submitted file. Open the original .task again.",
    "새 탭에서 편집기로 열기": "Open in editor tab",
    "제출 코드를 Python 편집기 탭으로 열어 실행·단계 실행으로 살펴보기": "Open the submitted code in a Python editor tab to run and step through it",
    "제출본이 신고한 테스트별 결과 (참고용)": "Per-test results reported by the submission (for reference)",
    "제출본 일괄 검수": "Batch review submissions",
    "제출본 일괄 검수(.taskdone)": "Batch review submissions (.taskdone)",
    "반 전체의 제출본(.taskdone)을 추가하고, 원본 과제(.task)를 연 상태에서 전체 재채점을 누르세요. 결과는 성적 CSV로 내보낼 수 있어요.": "Add the whole class's submissions (.taskdone), open the original task (.task), then run re-grade all. Results can be exported as a grade CSV.",
    "+ 제출본 추가": "+ Add submissions",
    "여러 .taskdone 파일을 한 번에 선택할 수 있어요": "You can select multiple .taskdone files at once",
    "▶ 전체 재채점": "▶ Re-grade all",
    "모든 제출 코드를 원본 과제의 테스트로 이 컴퓨터에서 다시 채점": "Re-grade every submitted code with the original task's tests on this computer",
    "⬇ 성적 CSV": "⬇ Grades CSV",
    "표의 내용을 엑셀에서 열 수 있는 CSV 파일로 내보내기": "Export this table as a CSV file that opens in Excel",
    "아직 추가한 제출본이 없어요. [+ 제출본 추가]로 .taskdone 파일들을 선택하세요.": "No submissions yet. Use [+ Add submissions] to select .taskdone files.",
    "신고 점수": "Reported",
    "재채점": "Re-graded",
    "일치": "Match",
    "자세히": "Details",
    "이 제출본을 단독 검수 화면으로 열기": "Open this submission in its own review view",
    "편집 전 원본 코드로 되돌리기": "Revert to the original code before edits",
    "Python 실행 환경 진단": "Diagnose the Python runtime",
    "현재 코드를 주피터 노트북(.ipynb)으로 변환해 새 탭으로 열기 (# %% 를 셀 경계로)": "Convert the current code to a Jupyter notebook (.ipynb) in a new tab (# %% marks cell boundaries)",
    "줄번호(왼쪽)를 클릭해 셀 경계(# %%)를 넣/빼고, 다시 눌러 노트북으로 변환": "Click line numbers (left) to add/remove cell boundaries (# %%), then convert to a notebook",
    "빈 줄 뒤 최상위 문장마다 셀 경계(# %%)를 자동으로 넣기": "Auto-insert cell boundaries (# %%) at each top-level statement after a blank line",
    "노트북 변환 방법": "Notebook conversion options",
    "현재 코드 줄을 PDF에 핀으로 연결": "Pin the current code line to the PDF",
    "코드 위에 필기 — 켜는 동안 편집 잠금": "Ink over code — editing is locked while on",
    "녹화 정지 — 지금까지 기록을 리플레이로 만들기": "Stop recording — turn what's recorded into a replay",
    "수업 리플레이 녹화 — 코드 편집·실행 결과(학습 화면이면 PDF 필기도)를 시간순으로 기록": "Record a lesson replay — code edits and run output (plus PDF ink in study view) over time",
    "코드·결과 글자 작게 (Ctrl+−)": "Smaller code/result text (Ctrl+−)",
    "코드·결과 글자 크게 (Ctrl++)": "Larger code/result text (Ctrl++)",
    "코드 글꼴 (시스템에 설치된 monospace 폰트만 표시)": "Code font (only installed monospace fonts shown)",
    "저장하면 경로가 여기 표시됩니다": "The path appears here after you save",
    "드래그해서 복사할 수 있습니다": "Drag to copy",
    "실행 작업폴더 · 실행 전": "Run working folder · before run",
    "경로 도우미": "Path helper",
    "파일 읽기·저장·import 경로를 현재 작업폴더 기준으로 확인": "Check file read/save/import paths relative to the current working folder",

    // ── 2단계(잔여): 노트북 메인 툴바 ──
    "노트북": "Notebook",
    "노트북 · 브라우저": "Notebook · Browser",
    "노트북 · 로컬 Python": "Notebook · Local Python",
    "저장 중…": "Saving…",
    "저장 실패": "Save failed",
    "저장 *": "Save *",
    "노트북을 자동 저장하는 중입니다.": "Auto-saving this notebook.",
    "자동 저장에 실패했습니다. 복구본은 유지되며 저장 버튼으로 다시 시도할 수 있습니다.": "Auto-save failed. The recovery copy is kept; use Save to try again.",
    "저장되지 않은 변경 내용이 있습니다.": "There are unsaved changes.",
    "노트북 저장": "Save notebook",
    "편집 내용 자동 저장 대기 중…": "Waiting to auto-save edits…",
    "자동 저장 실패 · 복구본은 유지됩니다": "Auto-save failed · recovery copy kept",
    "이 노트북을 .ipynb 로 저장 (Ctrl+S)": "Save this notebook as .ipynb (Ctrl+S)",
    ".py 내보내기": "Export .py",
    "현재 노트북을 파이썬(.py) 코드로 새 탭에 내보내기": "Export this notebook as Python (.py) in a new tab",
    "PDF로 저장": "Save as PDF",
    "실행 결과까지 노트북 전체를 고화질 PDF로 저장 (태블릿 학습용 · 필기 제외)": "Save the whole notebook incl. outputs as a high-res PDF (for tablet study · ink excluded)",
    "전체 실행": "Run all",
    "실행 커널 선택 · 재시작": "Choose run kernel · restart",
    "커널 재시작": "Restart kernel",
    "재시작 후 실행": "Restart & run",
    "커널을 재시작한 뒤 모든 셀을 처음부터 실행": "Restart the kernel, then run all cells from the start",
    "누적된 변수·상태를 모두 비우고 실행 결과를 지웁니다": "Clear all accumulated variables/state and outputs",
    "로컬 Python": "Local Python",
    "브라우저": "Browser",
    "모든 코드 셀을 하나의 .py처럼 합쳐 PC의 로컬 Python으로 한 번 실행": "Combine all code cells into one .py and run once with local Python",
    "출력 지우기": "Clear output",
    "노트북 실행 결과를 지웁니다(변수·상태는 유지)": "Clear notebook outputs (variables/state kept)",
    "출력 접기": "Collapse outputs",
    "출력 펼치기": "Expand outputs",
    "▾ 출력 접기": "▾ Collapse output",
    "▸ 출력 펼치기": "▸ Expand output",
    "출력 접기 · 출력 펼치기": "Collapse / expand outputs",
    "빈 코드 셀 — 클릭해 편집": "Empty code cell — click to edit",
    "로컬 Python 확인 중…": "Checking Local Python…",
    "브라우저 Python(Pyodide)으로 돌아가기": "Return to browser Python (Pyodide)",
    "로컬 Python 설치 필요": "Local Python installation required",
    "로컬 Python 설치 필요 · 설치 후 앱 다시 실행": "Local Python installation required · install it, then restart the app",
    "로컬 Python 셀 커널 사용": "Use Local Python cell kernel",
    "로컬 Python 전체 실행 · 설치 필요": "Run all with Local Python · installation required",
    "로컬 Python 전체 1회 실행": "Run all once with Local Python",
    "브라우저 커널(Pyodide)로 전환했어요.": "Switched to the browser kernel (Pyodide).",
    "로컬 Python 셀 커널 선택됨 · 셀을 실행하면 시작합니다.": "Local Python cell kernel selected · it starts when you run a cell.",
    "Selenium 크롤링을 사용하려면 PC에 Python을 설치하고 앱을 다시 실행해야 합니다.": "To use Selenium crawling, install Python on this PC and restart the app.",
    "현재 셀 실행은 PC의 로컬 Python을 사용합니다. 누르면 브라우저 커널로 돌아갑니다.": "Cell runs use Local Python on this PC. Click to return to the browser kernel.",
    "셀마다 PC의 로컬 Python으로 실행하고 변수·Selenium 브라우저 상태를 다음 셀까지 유지합니다.": "Run each cell with Local Python on this PC and keep variables and Selenium browser state for the next cell.",
    "필기": "Ink",
    "코드·마크다운·실행 결과 위에 셀별로 필기": "Ink over code, markdown, and outputs per cell",
    "목차": "Contents",
    "목차 닫기": "Close contents",
    "마크다운 제목에서 만든 노트북 목차": "Table of contents from markdown headings",
    "전체 찾기": "Find all",
    "노트북 전체 셀에서 찾기·바꾸기 (Ctrl+H · 현재 셀만은 Ctrl+Shift+H)": "Find/replace across all cells (Ctrl+H · current cell only Ctrl+Shift+H)",
    "마지막 셀 작업 되돌리기 (명령 모드 Ctrl+Z)": "Undo the last cell action (command mode Ctrl+Z)",
    "셀 작업 다시 실행 (명령 모드 Ctrl+Y)": "Redo cell action (command mode Ctrl+Y)",
    "코드 셀·결과 글자 작게 (Ctrl+−)": "Smaller cell/result text (Ctrl+−)",
    "코드 셀·결과 글자 크게 (Ctrl++)": "Larger cell/result text (Ctrl++)",
    "키보드 단축키 모아 보기": "View keyboard shortcuts",
    "＋ 코드 셀": "＋ Code cell",
    "＋ 마크다운": "＋ Markdown",
    "변환(.py) 뷰": "Converted (.py) view",
    "기존 파이썬 변환 뷰로 전환(앱 새로고침)": "Switch to the classic Python-converted view (reloads the app)",

    // ── 2단계(잔여): 노트북 셀 커널 바 ──
    "노트북 커널": "Notebook kernel",
    "이 셀": "This cell",
    "다음 셀": "Next cell",
    "셀 노트북": "Cell notebook",
    "커서가 있는 셀을 실행 (상태 유지)": "Run the cell at the cursor (state kept)",
    "마지막 실행한 셀의 다음 셀을 실행": "Run the cell after the last one you ran",
    "누적된 변수·상태를 모두 비웁니다": "Clear all accumulated variables/state",
    "주피터식 셀 편집기로 보기(실험 · 앱 새로고침)": "View as a Jupyter-style cell editor (experimental · reloads the app)",
    "셀에 커서를 두고 [이 셀] 실행": "Place the cursor in a cell and run [This cell]",
    "현재 셀 실행 중지(커널 상태 초기화)": "Stop the running cell (resets kernel state)",
    "중지 요청 중…": "Stop requested…",
    "최신": "Up to date",
    "재실행": "Re-run",
    "오류": "Error",
    "미실행": "Not run",
    "중지": "Stopped",
    "완료": "Complete",
    "(경고 있음)": " (with warnings)",
    "실행 중지": "Stop execution",
    "실행 중지 (클릭)": "Stop execution (click)",
    "이 셀 실행": "Run this cell",
    "이 셀 실행 (Ctrl+Enter · Shift+Enter=실행 후 다음)": "Run this cell (Ctrl+Enter · Shift+Enter=run, then next)",
    "노트북 작업폴더 준비 중…": "Preparing notebook working folder…",
    "Selenium 실행에는 로컬 Python 셀 커널이 필요해요.": "Selenium requires the Local Python cell kernel.",
    "패키지 설치를 취소했어요.": "Package installation was canceled.",
    "여기까지 실행할 코드 셀이 없어요.": "There are no code cells to run up to here.",
    "입력값을 준비한 뒤 전체 실행을 다시 눌러 주세요.": "Prepare the input values, then run all again.",
    "오류가 나서 전체 실행을 멈췄어요(커널은 유지).": "Run all stopped after an error (kernel kept).",
    "중지됨 · 남은 셀 실행 취소 · 커널 초기화됨": "Stopped · remaining cells canceled · kernel reset",
    "실행 결과를 지웠어요.": "Cleared execution results.",
    "이 셀에는 지울 출력이 없어요.": "This cell has no output to clear.",
    "내보내기를 지원하지 않는 환경이에요.": "Export is not supported in this environment.",
    "실행할 코드 셀이 없어요.": "There are no code cells to run.",
    "취소됨": "Canceled",
    "이미 로컬 파이썬으로 실행 중이에요.": "Already running with Local Python.",
    "브라우저 커널 실행이 끝난 뒤 다시 눌러 주세요.": "Try again after the browser-kernel run finishes.",
    "로컬 파이썬으로 실행 중…": "Running with Local Python…",
    "로컬 파이썬으로 실행 중… (옆 파일 포함)": "Running with Local Python… (including adjacent files)",
    "로컬 실행이 오류로 끝났어요 (아래 결과 확인).": "Local run finished with an error (see output below).",
    "로컬 파이썬 실행 완료 ✓": "Local Python run complete ✓",
    "펼치면 현재 커널 값을 불러옵니다.": "Expand to load the current kernel value.",
    "현재 커널 값 불러오는 중…": "Loading current kernel value…",
    "현재 커널에 이 변수가 없습니다.": "This variable is not in the current kernel.",
    "변수 이름·자료형 검색": "Search variable name or type",
    "변수 검색": "Search variables",
    "인터랙티브 출력": "Interactive output",
    "인터랙티브 HTML 결과": "Interactive HTML output",
    "이 노트북에서 실행": "Run in this notebook",
    "이 노트북 신뢰": "Trust this notebook",

    // ── 2단계(잔여): 노트북 셀 도구·찾기·필기 ──
    "실행하고 다음 셀로": "Run and go to the next cell",
    "현재 셀 실행": "Run the current cell",
    "찾기": "Find",
    "닫기 (Esc)": "Close (Esc)",
    "이전": "Previous",
    "다음": "Next",
    "대소문자 구분": "Match case",
    "단어 단위": "Whole word",
    "정규식": "Regex",
    "정규식 오류": "Regex error",
    "바꿀 내용": "Replace with",
    "노트북 전체에서 찾기": "Find across the notebook",
    "노트북 전체에서 바꿀 내용": "Replace across the notebook",
    "노트북 전체 찾기·바꾸기": "Find/replace across the notebook",
    "현재 셀 안에서 찾기·바꾸기": "Find/replace within the current cell",
    "키보드 단축키": "Keyboard shortcuts",
    "결과 패널 닫기": "Close the result panel",
    "펜": "Pen",
    "형광펜": "Highlighter",
    "지우개": "Eraser",
    "📷 장면 캡처": "📷 Capture frame",
    "현재 화면(프레임)을 이미지로 캡처해 메모에 넣어요": "Capture the current frame as an image into Notes",
    "이름 바꾸기": "Rename",
    "🔠 글자 추출": "🔠 Extract text",
    "이미지 속 글자를 인식(OCR)해 복사·메모로 — 자르기 영역이 있으면 그 부분만": "Recognize text in the image (OCR) to copy or send to Notes — crop area only, if set",
    "글자 추출 결과": "Extracted text",
    "인식이 완벽하지 않을 수 있어요 — 필요한 부분을 고쳐서 복사하세요.": "Recognition may be imperfect — edit what you need, then copy.",
    "메모에 넣기": "Add to Notes",
    "📋 복사": "📋 Copy",
    "화살표 (드래그)": "Arrow (drag)",
    "사각형 (드래그)": "Rectangle (drag)",
    "모자이크 — 개인정보 가리기 (드래그)": "Mosaic — hide private info (drag)",
    "이동·셀 선택": "Move · select cell",
    "색 직접 고르기": "Pick a color",
    "끌어서 위치 옮기기": "Drag to move",
    "셀 지우기": "Clear cell",
    "전체 지우기": "Clear all",
    "선택한 셀의 마지막 필기 되돌리기": "Undo the last ink in the selected cell",
    "선택한 셀의 필기 전체 지우기": "Clear all ink in the selected cell",
    "모든 셀의 필기 지우기": "Clear ink in all cells",
    "필기 전체 지우고 끄기": "Clear all ink and turn off",
    "로컬 Python 셀 커널 사용": "Use local Python cell kernel",
    "브라우저 Python(Pyodide)으로 돌아가기": "Return to browser Python (Pyodide)",
    "로컬 커널 사용": "Use local kernel",
    "정의로 이동": "Go to definition",
    "함수 도움말(설명) 보기 — 이름 뒤에서": "Show function help — after a name",
    "복구": "Restore",
    "무시": "Ignore",

    // ── 2단계(잔여): 이미지 편집기 ──
    "▦ 여러 장 보기": "▦ Grid view",
    "썸네일을 격자로 봅니다": "View thumbnails as a grid",
    "▦ PDF 모아보기": "▦ PDF gallery",
    "PDF 첫 페이지를 격자로 봅니다": "View PDF first pages as a grid",
    "▦ PDF 모아보기 — 이 폴더만 ({n}개)": "▦ PDF gallery — this folder ({n})",
    "▦ PDF 모아보기 — 하위 폴더 포함 ({n}개)": "▦ PDF gallery — include subfolders ({n})",
    "‹ 이전": "‹ Prev",
    "다음 ›": "Next ›",
    "이전 이미지": "Previous image",
    "다음 이미지": "Next image",
    "편집기로 열기": "Open in editor",
    "현재 이미지를 기존 이미지 편집기로 엽니다": "Open the current image in the image editor",
    "왼쪽으로 90도 회전": "Rotate 90° left",
    "오른쪽으로 90도 회전": "Rotate 90° right",
    "좌우 뒤집기": "Flip horizontal",
    "상하 뒤집기": "Flip vertical",
    "좌우": "Horizontal",
    "상하": "Vertical",
    "자르기": "Crop",
    "자르기 영역 선택": "Select crop area",
    "선택한 영역으로 자르기": "Crop to the selected area",
    "자유": "Free",
    "✏️ 표시": "✏️ Annotate",
    "펜·화살표·텍스트·모자이크 표시 패널 열기/닫기": "Open/close the pen · arrow · text · mosaic panel",
    "✨ 자동보정": "✨ Auto-fix",
    "화질 보정·크기 조절 패널 열기/닫기": "Open/close the adjust & resize panel",
    "보정": "Adjust",
    "보정 초기화": "Reset adjustments",
    "밝기·대비·채도·선명도·노이즈를 기본값으로": "Reset brightness, contrast, saturation, sharpness, and noise to defaults",
    "밝기": "Brightness",
    "대비": "Contrast",
    "채도": "Saturation",
    "선명도": "Sharpness",
    "노이즈완화": "Denoise",
    "자동 보정 적용 — 슬라이더로 미세조정할 수 있어요": "Auto-fix applied — fine-tune with the sliders",
    "밝기·대비를 자동으로 맞추고 약하게 선명화": "Auto-balance brightness/contrast and lightly sharpen",
    "고화질 확대": "HQ upscale",
    "2배 고화질 확대": "2× HQ upscale",
    "4배 고화질 확대": "4× HQ upscale",
    "크기 줄이기": "Shrink",
    "절반 크기로 축소": "Shrink to half",
    "3분의 1 크기로 축소": "Shrink to one third",
    "폭 px": "Width px",
    "원하는 폭(픽셀)을 입력하고 적용": "Enter a target width (px) and apply",
    "입력한 폭으로 크기 조절": "Resize to the entered width",
    "JPG 품질": "JPG quality",
    "JPG로 저장할 때의 압축 품질(낮을수록 파일이 작아짐)": "Compression quality for JPG (lower = smaller file)",
    "✏️ 펜": "✏️ Pen",
    "🖍️ 형광펜": "🖍️ Highlighter",
    "→ 화살표": "→ Arrow",
    "▭ 사각형": "▭ Rectangle",
    "T 텍스트": "T Text",
    "▦ 모자이크": "▦ Mosaic",
    "🖱 선택": "🖱 Select",
    "펜으로 자유롭게 그리기": "Draw freely with the pen",
    "반투명 형광펜으로 강조": "Highlight with a translucent marker",
    "드래그한 방향으로 화살표 그리기": "Draw an arrow in the drag direction",
    "드래그한 영역에 테두리 사각형": "Outline a rectangle over the dragged area",
    "클릭한 위치에 글자 넣기": "Add text where you click",
    "드래그한 영역을 모자이크로 가리기(이름·얼굴 등)": "Mosaic over the dragged area (names, faces, etc.)",
    "표시 색상": "Annotation color",
    "굵기": "Thickness",
    "모두 지우기": "Clear all",
    "모든 표시를 지우기 (되돌리기 버튼으로 복구 가능)": "Clear all annotations (restore with undo)",
    "되돌리기": "Undo",
    "다시": "Redo",
    "이미지 편집 되돌리기": "Undo image edit",
    "이미지 편집 다시 실행": "Redo image edit",
    "텍스트 넣기": "Add text",
    "텍스트 수정": "Edit text",
    "📷 메모로": "📷 To notes",
    "현재 이미지를 메모에 넣기 — 자르기 영역을 선택해 두었으면 그 부분만": "Add the current image to notes — only the crop area if one is selected",
    "현재 이미지를 PNG로 저장": "Save the current image as PNG",
    "현재 이미지를 JPG로 저장": "Save the current image as JPG",
    "현재 이미지를 PDF로 저장": "Save the current image as PDF",
    "회전·뒤집기·자르기·표시·보정 모두 초기화": "Reset rotation, flip, crop, annotations, and adjustments",
    "화면에 맞추기": "Fit to screen",
    "현재 이미지 픽셀 크기": "Current image pixel size",
    "표시를 클릭해 선택 → 드래그로 이동 · Delete 삭제 · 텍스트 더블클릭으로 수정": "Click an annotation to select → drag to move · Delete to remove · double-click text to edit",
    // 이미지 편집기 토스트(정적)
    "이미지를 메모에 넣었어요.": "Added the image to notes.",
    "자르기 영역을 메모에 넣었어요.": "Added the crop area to notes.",
    "텍스트를 넣었어요. 드래그로 위치를 옮길 수 있어요.": "Text added. Drag to reposition.",
    "파일을 내려받았어요.": "File downloaded.",
    "이미지를 저장하지 못했어요.": "Couldn't save the image.",
    "이미지를 만들지 못했어요.": "Couldn't create the image.",
    "PDF로 저장하지 못했어요.": "Couldn't save as PDF.",
    "PDF 라이브러리를 불러오지 못했습니다.": "Couldn't load the PDF library.",
    "이미지에 넣을 글자를 입력하세요.": "Enter text to add to the image.",
    "자를 영역을 먼저 드래그하세요.": "Drag to select an area to crop first.",
    "폭을 16px 이상 숫자로 입력하세요.": "Enter a width of at least 16px.",
    "너무 작아집니다(최소 16px). 더 큰 배율을 쓰세요.": "That's too small (min 16px). Use a larger scale.",
    "너무 커집니다(최대 6000px). 더 작은 배율을 쓰세요.": "That's too large (max 6000px). Use a smaller scale.",
    "이미지 로드 실패": "Failed to load the image",
    "내용을 고쳐 쓰세요. 비우고 확인하면 삭제됩니다.": "Edit the content. Clear it and confirm to delete.",
    "예: 여기 확인!": "e.g. Check here!",
    "이 폴더에 바로 들어 있는 이미지가 없어요.": "No images directly in this folder.",
    "이 폴더와 하위 폴더에 표시할 이미지가 없어요.": "No images to show in this folder or its subfolders.",

    // ── 2단계(잔여): 스프레드시트/CSV ──
    "◀ 이전": "◀ Prev",
    "다음 ▶": "Next ▶",
    "XLSX로 변환·편집": "Convert to XLSX & edit",
    "이 CSV 전체를 XLSX로 변환해 새 편집 탭에서 열기": "Convert the whole CSV to XLSX and open a new edit tab",
    "복사": "Copy",
    "📊 차트": "📊 Chart",
    "선택한 범위로 차트 만들기 (막대·꺾은선·원·산점도)": "Make a chart from the selection (bar, line, pie, scatter)",
    "표에서 찾기": "Find in table",
    "선택 해제": "Clear selection",
    "끌어서 열 폭 조절 · 더블클릭 자동 맞춤": "Drag to resize column · double-click to auto-fit",
    "끌어서 행 높이 조절 · 더블클릭 자동 맞춤": "Drag to resize row · double-click to auto-fit",
    "데이터 없음": "No data",
    "데이터 없음(머리글만)": "No data (header only)",
    // 스프레드시트 토스트(정적)
    "찾는 내용이 없어요.": "No matches found.",
    "셀 값을 복사했어요.": "Copied the cell value.",
    "선택한 표 내용을 복사했어요.": "Copied the selected cells.",
    "복사하지 못했어요.": "Couldn't copy.",
    "변환하지 못했어요.": "Couldn't convert.",
    "XLSX로 변환해 저장했어요.": "Converted to XLSX and saved.",
    "XLSX로 변환해 편집 탭을 열었어요(첫 줄=머리글).": "Converted to XLSX and opened an edit tab (first row = header).",
    "XLSX로 변환해 편집 탭을 열었어요(첫 줄=데이터).": "Converted to XLSX and opened an edit tab (first row = data).",
    "행이 너무 많아 변환할 수 없어요(30만 행 초과).": "Too many rows to convert (over 300,000).",
    "새 빈 표를 만들었어요. 셀을 더블클릭해 입력하세요.": "Created a new blank sheet. Double-click a cell to type.",
    "차트 기능을 불러오지 못했어요.": "Couldn't load the chart feature.",
    "Excel 라이브러리를 불러오지 못했어요.": "Couldn't load the Excel library.",
    "CSV 파일이 비어 있습니다.": "The CSV file is empty.",

    // ── 긴 꼬리: 문서·탭·분할(documents.js) ──
    "⛶ 나가기": "⛶ Exit",
    "드래그: 좌우 비율 조절 · 더블클릭: 좌우 바꾸기": "Drag: adjust ratio · double-click: swap sides",
    "먼저 참고할 문서를 연 뒤 분할 작업을 눌러주세요.": "Open a document to reference first, then click Split view.",
    "묶음 전체 닫기": "Close the whole bundle",
    "문서를 참고 화면에 고정했어요. 참고 문서는 읽기 전용으로 잠겨 있어요. 편집하려면 참고 칸 왼쪽 위 열쇠를 눌러 잠금을 푸세요.": "Pinned the document as a reference. The reference is locked read-only. To edit it, click the key at the top-left of the reference pane to unlock.",
    "분할 작업 종료": "End split view",
    "불러온 파일의 저장 인코딩": "Saved encoding of the loaded file",
    "새로고침 중 오류가 났어요.": "An error occurred while refreshing.",
    "숨겨진 탭 검색": "Search hidden tabs",
    "앱 작업공간에 저장됨": "Saved in the app workspace",
    "여는 중…": "Opening…",
    "열린 파일 — 확장자별 보기": "Open files — by extension",
    "왼쪽 사이드 메뉴 보이기": "Show sidebar",
    "원본 파일 읽기 권한이 필요해요.": "Permission to read the original file is required.",
    "원본 파일에서 새로고침했어요.": "Refreshed from the original file.",
    "원본 파일을 다시 읽지 못했어요.": "Couldn't re-read the original file.",
    "이 파일은 원본을 다시 읽을 권한이 없어요. 파일 선택으로 다시 연결해 주세요.": "This file can't re-read its original. Reconnect it via file selection.",
    "일치하는 탭이 없습니다.": "No matching tabs.",
    "저장 후 수정됨": "Modified since save",
    "저장 안 됨": "Not saved",
    "자동 저장 중": "Auto-saving",
    "자동 저장됨": "Auto-saved",
    "전체 파일 보기": "Show all files",
    "전체": "All",
    "참고 문서 고정을 해제하고 일반 화면으로 돌아가기": "Unpin the reference and return to the normal view",
    "참고 문서 잠금을 풀고 편집 가능하게 하기": "Unlock the reference to allow editing",
    "참고 문서 잠금을 풀었습니다. 기존 학습 화면처럼 편집할 수 있습니다.": "Unlocked the reference. You can edit it like the usual study view.",
    "참고 문서를 잠갔습니다. 보기·스크롤·복사만 가능합니다.": "Locked the reference. Only viewing, scrolling, and copying are allowed.",
    "클릭: 펼치기(같은 레벨 폴더는 자동 접힘) · Alt+클릭: 형제 유지한 채 자기만 토글": "Click: expand (same-level folders auto-collapse) · Alt+click: toggle only this one, keeping siblings",
    "탭 닫기 및 분할 작업 종료(파일은 사이드바에 유지)": "Close the tab and end split view (file stays in the sidebar)",
    "탭만 닫기(파일은 사이드바에 유지)": "Close only the tab (file stays in the sidebar)",
    "파일을 여는 중 오류가 발생했습니다.": "An error occurred while opening the file.",
    "필터에 일치하는 파일이 없습니다.": "No files match the filter.",
    "현재 문서를 참고 화면에 고정하고 작업 문서와 나란히 보기": "Pin the current document as a reference and view it beside your working document",
    "현재 파일 처리 후 취소하는 중…": "Canceling after the current file…",
    "ZIP 제한사항 보기": "View ZIP limitations",
    "읽기 전용 참고 문서": "Read-only reference",
    "참고 문서": "Reference",
    "PDF 편집": "PDF editing",
    "화이트보드": "Whiteboard",
    "수업 리플레이": "Lesson replay",
    "이미지 모아보기": "Image gallery",
    "PDF 모아보기": "PDF gallery",
    "Python 실습": "Python practice",
    "이미지 보기": "Image view",
    "오디오 재생": "Audio playback",
    "영상 재생": "Video playback",
    "Word 보기": "Word view",
    "표 보기": "Table view",
    "SQLite 보기": "SQLite view",
    "PowerPoint 보기": "PowerPoint view",
    "HWP 보기": "HWP view",
    "Markdown 보기": "Markdown view",
    "코드 보기": "Code view",
    "문서 보기": "Document view",

    // ── 긴 꼬리: 파일·폴더·압축 열기(file-loaders.js) ──
    "노트북을 변환하지 못했어요.": "Couldn't convert the notebook.",
    "노트북을 열지 못했어요.": "Couldn't open the notebook.",
    "다시 열 닫은 파일이 없어요.": "No closed file to reopen.",
    "변경된 파일 없음": "No changed files",
    "새로고침할 수 있는 파일이나 폴더가 없어요.": "No file or folder to refresh.",
    "암호 확인 중…": "Checking password…",
    "암호를 확인하지 못했어요.": "Couldn't verify the password.",
    "압축 라이브러리를 불러오지 못했습니다.": "Couldn't load the archive library.",
    "압축 안에 열 수 있는 형식이 없어요.": "No openable formats inside the archive.",
    "압축 여는 중…": "Opening archive…",
    "압축 푸는 중…": "Extracting…",
    "압축을 열지 못했습니다. 올바른 zip 파일인지 확인해 주세요.": "Couldn't open the archive. Check that it's a valid zip file.",
    "압축을 풀지 못했어요.": "Couldn't extract the archive.",
    "압축이 비어 있어요.": "The archive is empty.",
    "원본 저장 모드를 켰어요. 저장할 때 원본 파일이 변경됩니다.": "Turned on original-save mode. Saving will modify the original file.",
    "파일 열기를 취소했어요.": "Canceled opening the file.",
    "파일을 다시 열지 못했어요.": "Couldn't reopen the file.",
    "폴더 변경 내용 확인 중…": "Checking folder changes…",
    "폴더 새로고침 중 오류가 났어요.": "An error occurred while refreshing the folder.",
    "폴더 새로고침 중…": "Refreshing folder…",
    "폴더 새로고침을 취소했어요.": "Canceled folder refresh.",
    "폴더 쓰기 권한이 없어 기존 자동 저장 폴더를 사용합니다.": "No write permission for the folder; using the existing auto-save folder.",
    "폴더 안에 열 수 있는 파일이나 폴더가 없어요.": "No openable files or folders inside.",
    "폴더 여는 중…": "Opening folder…",
    "폴더 열기를 취소했어요.": "Canceled opening the folder.",
    "폴더 파일 확인 중…": "Checking folder files…",
    "폴더를 다시 읽지 못했어요.": "Couldn't re-read the folder.",
    "폴더를 열지 못했어요.": "Couldn't open the folder.",
    "폴더를 읽지 못했어요.": "Couldn't read the folder.",
    "gzip 압축을 풀지 못했습니다. (지원: gzip · tar.gz)": "Couldn't extract the gzip. (Supported: gzip · tar.gz)",
    "PowerPoint 변환 결과가 올바르지 않아 간이 미리보기로 열어요.": "The PowerPoint conversion was invalid; opening a simple preview.",
    "PowerPoint 변환에 실패해 간이 미리보기로 열어요.": "PowerPoint conversion failed; opening a simple preview.",
    "PowerPoint 변환을 사용할 수 없어 간이 미리보기로 열어요.": "PowerPoint conversion unavailable; opening a simple preview.",
    "PowerPoint 정확 변환(PDF)으로 열었어요.": "Opened with exact PowerPoint conversion (PDF).",
    "PowerPoint으로 변환 중… (대형 파일은 잠시 걸려요)": "Converting with PowerPoint… (large files take a moment)",
    "tar 파일을 열지 못했습니다.": "Couldn't open the tar file.",

    // ── 긴 꼬리: 앱 전역·서버·설정(app.js, state.js, workspace-store.js) ──
    "가장 긴 파일명에 맞췄어요. 최대 너비는 600px입니다.": "Fit to the longest filename. Max width is 600px.",
    "다른 창에서 사용 중이에요": "In use by another window",
    "라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.": "Couldn't load the library. Check your internet connection.",
    "로컬 서버가 종료되었습니다. manneung-classroom.exe 를 다시 실행하세요.": "The local server stopped. Run manneung-classroom.exe again.",
    "로컬 서버와 연결되어 있습니다.": "Connected to the local server.",
    "새 키를 누르세요…": "Press a new key…",
    "새로고침할 파일을 먼저 선택해 주세요.": "Select a file to refresh first.",
    "서버 끊김": "Server disconnected",
    "서버 연결됨": "Server connected",
    "선택창 확인…": "Confirming picker…",
    "설정을 저장했어요. 화면 크기와 단축키는 바로 적용됩니다.": "Saved settings. Screen size and shortcuts apply immediately.",
    "이 창에서 계속하기": "Continue in this window",
    "이미지를 불러오지 못했습니다.": "Couldn't load the image.",
    "이미지에서 서명을 찾지 못했어요.": "Couldn't find a signature in the image.",
    "입력 중": "Typing",
    "자동 저장 위치를 변경했어요. 기존 파일은 이전 폴더에 그대로 있습니다.": "Changed the auto-save location. Existing files remain in the previous folder.",
    "저장 폴더를 변경하지 못했어요.": "Couldn't change the save folder.",
    "저장 폴더를 열지 못했어요.": "Couldn't open the save folder.",
    "저장한 파일 폴더를 열지 못했어요.": "Couldn't open the saved file's folder.",
    "파일명 길이에 맞춰 사이드바를 조절했어요.": "Adjusted the sidebar to fit filename length.",
    "Windows 폴더 선택창을 열고 있어요.": "Opening the Windows folder picker.",
    "일치 계산 중…": "Counting matches…",
    "abc43처럼 찾고 싶은 예시를 먼저 입력해 보세요.": "Enter an example to search for first, like abc43.",
    "다음 실행을 위해 작업공간 기억하는 중…": "Remembering the workspace for next time…",
    "닫은 파일 정리 후 파일을 여는 중…": "Opening files after clearing closed ones…",
    "이 브라우저에서는 최근 작업공간 저장을 지원하지 않아요.": "This browser doesn't support saving the recent workspace.",
    "이전 자동 복원 기록이 너무 커서 안전하게 정리했어요. 원본 파일은 영향받지 않습니다.": "The previous auto-restore record was too large and was safely cleared. Your original files are unaffected.",
    "지난 작업공간을 자동으로 복원했어요.": "Automatically restored your last workspace.",
    "최근 작업공간 복원 중…": "Restoring recent workspace…",
    "최근 작업공간 확인 중…": "Checking recent workspace…",
    "최근 작업공간을 지우지 못했어요.": "Couldn't clear the recent workspace.",
    "최근 작업공간을 지웠어요.": "Cleared the recent workspace.",
    "화면에서는 닫았지만 최근 작업공간에서 제거하지 못했어요.": "Closed on screen, but couldn't remove it from the recent workspace.",

    // ── 긴 꼬리: PDF 편집·페이지(pdf-editor.js, pdf-pages.js, pdf-recovery.js) ──
    "선택": "Select",
    "초기화": "Reset",
    "다시 실행 (Ctrl+Y)": "Redo (Ctrl+Y)",
    "다음 (Enter)": "Next (Enter)",
    "되돌리기 (Ctrl+Z)": "Undo (Ctrl+Z)",
    "이전 (Shift+Enter)": "Previous (Shift+Enter)",
    "리플레이 기능을 불러오지 못했어요.": "Couldn't load the replay feature.",
    "먼저 서명을 그려주세요.": "Draw a signature first.",
    "먼저 PDF를 여세요.": "Open a PDF first.",
    "PDF를 먼저 열어 주세요.": "Open a PDF first.",
    "보관함에서 삭제": "Remove from library",
    "분할 작업의 참고 PDF는 읽기 전용이에요.": "The reference PDF in split view is read-only.",
    "옆 화면에 PDF를 두고 잠금을 푼 뒤 핀을 꽂아 주세요.": "Put a PDF in the side pane and unlock it, then pin.",
    "서명을 넣었어요.": "Added the signature.",
    "서명이 비어 있어요.": "The signature is empty.",
    "선택한 글자 강조": "Highlight the selected text",
    "수업 리플레이 녹화 — 필기(+파이썬 코드·실행)를 시간순으로 기록해 되감아 볼 수 있어요": "Record a lesson replay — capture ink (plus Python code/runs) over time to play back",
    "이 서명 선택": "Select this signature",
    "이 연결 핀 삭제": "Delete this link pin",
    "이 페이지 필기를 지웠어요.": "Cleared this page's ink.",
    "이 페이지에 지울 필기가 없어요.": "No ink to clear on this page.",
    "저장 중 오류가 발생했습니다.": "An error occurred while saving.",
    "추가한 항목이 없어요. 그래도 다운로드합니다.": "Nothing was added. Downloading anyway.",
    "텍스트 없음(스캔본)": "No text (scanned)",
    "페이지 썸네일에서 적용할 페이지를 선택하세요.": "Select pages to apply from the page thumbnails.",
    "필기 모드 끄기": "Turn off ink mode",
    "현재 페이지의 필기 전체 지우기": "Clear all ink on the current page",
    "삭제할 페이지를 선택하세요.": "Select pages to delete.",
    "선택 페이지 추출 중…": "Extracting selected pages…",
    "썸네일 정리 닫기": "Close the thumbnail panel",
    "이동할 페이지 하나를 선택하세요.": "Select one page to move.",
    "페이지 선택": "Select page",
    "페이지 추출에 실패했습니다.": "Failed to extract pages.",
    "회전은 다운로드·추출 결과에 적용됩니다.": "Rotation applies to downloaded/extracted results.",
    "회전할 페이지를 선택하세요.": "Select pages to rotate.",
    "PDF 합치기에 실패했습니다. 암호 파일인지 확인하세요.": "Failed to merge PDFs. Check whether the file is password-protected.",
    "PDF 합치는 중…": "Merging PDFs…",
    "PDF에는 한 페이지 이상 남아야 합니다.": "A PDF must keep at least one page.",
    "다시 실행할 작업이 없어요.": "Nothing to redo.",
    "되돌릴 작업이 없어요.": "Nothing to undo.",
    "이전 PDF 편집 내용을 복원했어요.": "Restored the previous PDF edits.",
    "편집 작업을 다시 실행했어요.": "Redid the edit.",
    "편집 작업을 되돌렸어요.": "Undid the edit.",

    // ── 긴 꼬리: 임시 메모·이미지 메모(scratchpad.js, image-memo.js) ──
    "삭제": "Delete",
    "끌어서 크기 조절": "Drag to resize",
    "끌어서 블록 순서 변경": "Drag to reorder blocks",
    "내용을 입력하세요. 이미지는 붙여넣거나 이곳에 드래그할 수 있습니다.": "Type here. You can paste images or drag them here.",
    "마크다운 셀": "Markdown cell",
    "코드 셀": "Code cell",
    "Raw 셀": "Raw cell",
    "(빈 셀)": "(empty cell)",
    "메모 이미지를 편집 탭으로 열었어요. 편집 후 '📷 메모로'로 다시 넣을 수 있어요.": "Opened the note image in an edit tab. After editing, use '📷 To notes' to put it back.",
    "블록 잠금": "Lock block",
    "블록 잠금 해제": "Unlock block",
    "예: 수업 준비": "e.g. Class prep",
    "이미지 데이터가 사라졌어요 (저장 공간 정리 등) — 복사·다운로드 불가": "The image data is gone (e.g. storage cleanup) — can't copy or download",
    "이미지 불러오는 중…": "Loading image…",
    "이미지 위치": "Image position",
    "이미지 표시 크기": "Image display size",
    "이미지와 함께 표시할 글을 입력하세요.": "Enter text to show with the image.",
    "잠긴 블록은 이동할 수 없음": "Locked blocks can't be moved",
    "다시 시도": "Retry",
    "불러오는 중…": "Loading…",
    "이 이미지 지우기": "Remove this image",
    "이미지 메모 다운로드를 시작했어요.": "Started downloading image notes.",
    "이미지 메모 파일 삭제에 실패했어요.": "Failed to delete the image-note file.",
    "이미지 메모가 200MB를 넘어 더 담지 않았어요.": "Image notes exceeded 200MB; nothing more was added.",
    "이미지 메모를 저장했어요.": "Saved image notes.",
    "이미지 지우기": "Remove image",
    "일반 메모장의 현재 탭에 이 이미지 삽입": "Insert this image into the current scratchpad tab",
    "일부 이미지 메모를 저장하지 못했어요.": "Couldn't save some image notes.",
    "임시복구 이미지를 원본 파일 또는 ZIP으로 다운로드": "Download recovery images as original files or a ZIP",
    "자동저장에 실패한 이미지를 다시 저장": "Re-save images that failed to auto-save",
    "자동저장하지 않은 이미지를 지금 저장": "Save images now that weren't auto-saved",
    "저장 파일 삭제": "Delete saved file",
    "저장된 이미지 파일 삭제": "Delete the saved image file",
    "지금 저장": "Save now",
    "클릭해서 크게 보기": "Click to enlarge",
    "현재 메모로 보내기": "Send to current note",

    // ── 긴 꼬리: 영상·자막(video-viewer.js) ──
    "중지": "Stop",
    "MP4로 변환": "Convert to MP4",
    "같은 장면부터 변환본(MP4)으로 이어서 재생해요": "Resume from the same scene using the converted MP4",
    "공식 배포처에서 ffmpeg를 내려받아 자동으로 설치해요 (컴퓨터당 1회)": "Download ffmpeg from the official source and install automatically (once per computer)",
    "교실 뒷자리에서도 보이게 자막 글자 크기를 키워요": "Enlarge subtitle text so it's visible from the back of the classroom",
    "대상 없음": "No target",
    "무료 변환 도구 설치": "Install the free converter",
    "무료 변환 도구(ffmpeg)가 아직 없어요. 영상을 하나 열어 안내 바의 설치 버튼을 먼저 눌러주세요.": "The free converter (ffmpeg) isn't installed yet. Open a video and click the install button in the info bar first.",
    "변환된 MP4를 파일로 내려받아 다음부터 바로 재생": "Download the converted MP4 so it plays directly next time",
    "변환본 저장": "Save converted file",
    "변환본으로 재생": "Play the converted file",
    "영상 일괄 MP4 변환": "Batch-convert videos to MP4",
    "여기에 파이썬 코드를 작성하고 ▶ 실행": "Write Python code here and press ▶ Run",
    "영상 하나씩 차례로 변환해 폴더에 저장해요. 개수와 길이에 따라 오래 걸릴 수 있어요 — 창을 닫지 마세요.": "Convert videos one by one and save them to the folder. It may take a while depending on count and length — don't close the window.",
    "영상은 그대로 두고 브라우저가 지원하는 코덱으로 바꿔 새 탭에서 열어요": "Keep the original and open a browser-supported codec in a new tab",
    "이 브라우저에서는 저장 폴더를 고를 수 없어요. 영상을 하나씩 변환해 주세요.": "This browser can't pick a save folder. Convert videos one at a time.",
    "이 파일을 브라우저에서 재생하지 못했어요.": "This browser couldn't play the file.",
    "이 폴더에 일괄 변환할 영상(MKV·AVI·WMV·FLV)이 없어요.": "No videos (MKV·AVI·WMV·FLV) to batch-convert in this folder.",
    "이 폴더의 MKV·AVI·WMV·FLV 영상을 한꺼번에 MP4로 변환해 폴더에 저장해요 (한 번만 하면 됨)": "Convert this folder's MKV·AVI·WMV·FLV videos to MP4 all at once and save them (only needed once)",
    "자막 보이기": "Show subtitles",
    "자막 숨기기": "Hide subtitles",
    "자막 열기": "Open subtitles",
    "중지 요청됨": "Stop requested",
    "폴더 전체 변환": "Convert whole folder",
    "SRT · VTT · SMI 자막 파일을 이 영상에 연결 (한글 인코딩 자동 인식)": "Attach an SRT · VTT · SMI subtitle file to this video (Korean encoding auto-detected)",

    // ── 긴 꼬리: 화이트보드·리플레이(whiteboard.js, lesson-replay.js) ──
    "끌어서 도구막대 위치 바꾸기 — 상/하 가로, 좌/우 세로": "Drag to move the toolbar — top/bottom horizontal, left/right vertical",
    "녹화 정지 — 지금까지 판서를 리플레이로 만들기": "Stop recording — turn the board so far into a replay",
    "녹화된 판서가 없어요.": "No recorded board.",
    "녹화를 시작했어요. 판서한 뒤 ■ 정지를 누르면 리플레이가 만들어져요.": "Started recording. Draw, then press ■ Stop to create a replay.",
    "수업 리플레이 녹화 — 판서 과정을 시간순으로 기록해 되감아 볼 수 있어요": "Record a lesson replay — capture the drawing over time to play back",
    "이미지를 넣지 못했어요.": "Couldn't insert the image.",
    "PDF 라이브러리를 불러오지 못했어요.": "Couldn't load the PDF library.",
    ".lesson 파일로 저장": "Save as a .lesson file",
    "(아직 코드가 없어요)": "(No code yet)",
    "(출력 없음)": "(No output)",
    "▶ 실행 중…": "▶ Running…",
    "💾 저장": "💾 Save",
    "녹화된 내용이 없어요.": "Nothing was recorded.",
    "리플레이 파일은 128MB 이하만 열 수 있어요.": "Replay files must be 128MB or smaller to open.",
    "리플레이를 저장하지 못했어요.": "Couldn't save the replay.",
    "수업 녹화를 시작했어요. PDF 필기와 파이썬 코드·실행이 기록됩니다. ■ 정지로 끝내세요.": "Started recording. PDF ink and Python code/runs are captured. Press ■ Stop to finish.",
    "수업 리플레이가 만들어졌어요. ▶ 재생하거나 💾로 저장하세요.": "The lesson replay is ready. Press ▶ to play or 💾 to save.",
    "실행 결과": "Run output",
    "일시정지 (스페이스)": "Pause (Space)",
    "재생 (스페이스)": "Play (Space)",
    "재생 속도": "Playback speed",
    "재생 위치": "Playback position",
    "처음부터": "From the start",
    "파이썬": "Python",

    // ── 긴 꼬리: 펫·집중 모드(pet-focus.js, pet-custom.js, pet.js) ──
    "집중 모드를 종료했어요.": "Ended focus mode.",
    "집중 일시정지": "Focus paused",
    "집중 중": "Focusing",
    "픽셀 펫 집중 모드 열기": "Open pixel pet focus mode",
    "휴식 끝내기": "End break",
    "휴식 시간 진행률": "Break progress",
    "휴식이 끝났어요. 준비되면 다음 집중을 시작하세요.": "Break's over. Start your next focus when ready.",
    "내 펫": "My pet",
    "아직 만든 펫이 없어요. 위에서 골라 저장해 보세요.": "No custom pets yet. Pick one above and save.",
    "아직 없어요. 아래에서 추가해 보세요.": "None yet. Add some below.",
    "이 펫 지우기": "Delete this pet",
    "붙잡아 던질 수 있어요": "You can grab and toss them",
    "숨겨진 펫": "Hidden pet",
    "아직 만나지 못했어요 — 펫을 켤 때마다 무작위로 등장해요": "Not met yet — appears at random each time you turn pets on",

    // ── 긴 꼬리: 대기 화면·SQLite·오피스·OCR·노트북 PDF ──
    "대기 화면 영상을 지웠어요. 기본 애니메이션을 사용합니다.": "Cleared the idle-screen video. Using the default animation.",
    "아무 키나 누르거나 화면을 클릭하면 돌아갑니다": "Press any key or click the screen to return",
    "영상을 저장하지 못했어요. 용량이 너무 크면 짧은 영상으로 바꿔 주세요.": "Couldn't save the video. If it's too large, use a shorter one.",
    "재생할 수 있는 영상이 없어요. MP4(H.264)·WebM 를 권장합니다.": "No playable video. MP4 (H.264) / WebM recommended.",
    "← 뒤로": "← Back",
    "↻ 새로고침": "↻ Refresh",
    "파일을 읽지 못했어요": "Couldn't read the file",
    "현재 파일을 다시 읽습니다": "Re-read the current file",
    "형식 없음": "No format",
    "SQLite 데이터베이스를 읽는 중…": "Reading the SQLite database…",
    "SQLite 테이블": "SQLite tables",
    "암호 해제 중…": "Decrypting…",
    "암호 해제에 실패했습니다.": "Decryption failed.",
    "압축 라이브러리를 불러오지 못했어요.": "Couldn't load the archive library.",
    "이 암호화 방식은 아직 지원하지 않아요 (구형 Standard 방식).": "This encryption method isn't supported yet (legacy Standard).",
    "한글(HWP) 뷰어 로드 실패": "Failed to load the HWP viewer",
    "Word 뷰어 로드 실패": "Failed to load the Word viewer",
    "🔍 글자 인식": "🔍 Recognize text",
    "글자 인식 도구를 받아오려면 인터넷 연결이 필요해요. (인식한 결과는 이 컴퓨터에 저장돼 다음엔 오프라인에서도 검색됩니다)": "Downloading the text-recognition tool needs internet. (Results are stored on this computer, so future searches work offline)",
    "글자 인식 도구를 받아오지 못했어요. 인터넷 연결을 확인해 주세요.": "Couldn't download the text-recognition tool. Check your internet connection.",
    "글자 인식을 중지했어요. (저장하지 않음)": "Stopped text recognition. (Not saved)",
    "인식할 PDF 를 찾지 못했어요.": "Couldn't find a PDF to recognize.",
    "준비 중…": "Preparing…",
    "중지 중…": "Stopping…",
    "고화질 변환은 페이지 수와 실행 결과에 따라 시간이 걸릴 수 있어요. 이 창을 닫지 마세요.": "High-res conversion may take time depending on page count and outputs. Don't close this window.",
    "노트북 PDF 저장 중": "Saving notebook PDF",
    "인터랙티브 출력": "Interactive output",
    "저장 취소": "Cancel save",
    "취소 요청됨": "Cancellation requested",
    "페이지를 계산하고 있어요…": "Calculating pages…",
    "내용 일치 없음": "No content matches",
    "접을 출력이 없어요.": "No outputs to collapse.",
    "펼칠 출력이 없어요.": "No outputs to expand."
  };

  /* ── 리치 블록 사전(data-i18n="key" → English HTML). 한국어 원문은 스캔 때 기억. ── */
  var HTML_DICT = {
    "dz.formats": "PDF · Word · Excel · PowerPoint · images · folders · ZIP &nbsp;|&nbsp; or click to choose",
    "dz.feature": "✦ Run Python & auto-grade · Jupyter notebooks · whiteboard · PDF signing & ink &mdash; all right here",
    "dz.cmdk": "Search and run anything with <kbd>Ctrl</kbd><kbd>K</kbd> — signing, ink, whiteboard, examples",
    "dz.note": "Everything runs inside this browser. Your files are never sent anywhere.<br>Sign & edit in PDFs, preview the rest · <b>open several at once</b>",
    "welcome.lead": "Open and work with PDFs, Excel, images, and Python in one window — no install. Just these three things and you're ready.",
    "welcome.step1": "<span class=\"welcome-step-ico\">📂</span><div><b>1. Open files</b><small>Drag files onto the screen or press the <b>Open</b> button at the bottom left. Several files or whole folders open at once.</small></div>",
    "welcome.step2": "<span class=\"welcome-step-ico\">🐍</span><div><b>2. Run Python</b><small>Write code and press <b>▶ Run</b> (or <kbd>Ctrl+Enter</kbd>) to see the result right away. No Python install needed.</small></div>",
    "welcome.step3": "<span class=\"welcome-step-ico\">💾</span><div><b>3. Save</b><small>Edited PDFs and code can be <b>downloaded</b> or saved to your save folder. The original stays untouched.</small></div>",
    "welcome.safe": "🔒 Files are never sent anywhere — everything is processed on this computer only.",
    "help.f1": "<b>Open files</b> — drag & drop or whole folders. Open PDF, Word, Excel, PowerPoint, HWP, images, code, and ZIP together.",
    "help.f2": "<b>PDF</b> — signature, text, date, check, pen ink, <b>drag to select text → highlight</b>, page thumbnails/extract/merge, print / save as PDF.",
    "help.f3": "<b>Run Python</b> — run instantly with ▶, autocomplete & go-to-definition, <b>step run</b> to trace variables, <b>diagnose</b> and <b>auto-grade</b>, even install libraries.",
    "help.f4": "<b>Jupyter notebook (.ipynb)</b> — run cells one by one (Shift+Enter) in kernel mode, carrying variables to the next cell.",
    "help.f5": "<b>Whiteboard</b> — free ink, shapes, and images. Add it from New.",
    "help.f6": "<b>Split view</b> — put any document side by side with a reference, and lock the reference when needed to adjust the split ratio and sides.",
    "help.f7": "<b>Scratchpad</b> (Ctrl+M) · <b>image notes</b> (paste many captures, save in bulk) · <b>dark mode</b> · auto-restore workspace. Everything is processed on this computer only and files are never sent anywhere.",
    "ss.desc": "Choose a video to play (<strong>multiple loop in order</strong>), or show a clock animation if none. <strong>MP4 (H.264) / WebM recommended</strong> — unplayable files are filtered before saving. Videos are stored in this browser only, independent of the app (exe/HTML) size."
  };

  function t(ko) {
    if (ko == null) return ko;
    if (lang !== "en") return ko;
    var s = String(ko);
    var hit = DICT[s];
    if (hit != null) return hit;
    var trimmed = s.trim();
    if (trimmed !== s && DICT[trimmed] != null) {
      // 앞뒤 공백 보존
      var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return m[1] + DICT[trimmed] + m[3];
    }
    return ko;
  }

  /* 매개변수 메시지 사전(한국어 템플릿 → English 템플릿).
   * 값이 끼는 조합 메시지는 영어 어순이 달라 t() 로는 안 되므로 tf() 로 처리한다.
   * 플레이스홀더: {name}=치환, {n|단수|복수}=vars.n 이 1이면 단수/아니면 복수.  */
  var PARAMS = {
    "{n}개 열기": "Opened {n} {n|file|files}",
    "{n}개 형식 미지원": "{n} unsupported {n|format|formats}",
    "{n}개 열기 실패": "{n} failed to open",
    "{n}개 용량 제한 제외": "{n} excluded (size limit)",
    "{n}개 일치": "{n} {n|match|matches}",
    "{n}개 페이지를 저장했어요.": "Saved {n} {n|page|pages}.",
    "출력 {n}개 접음": "Collapsed {n} {n|output|outputs}",
    "출력 {n}개 펼침": "Expanded {n} {n|output|outputs}",
    "노트북 전체에서 {n}개를 바꿨어요.": "Replaced {n} across the notebook.",
    "{n}개를 바꿨어요.": "Replaced {n}.",
    "{n}자": "{n} {n|char|chars}",
    "이미지 {n}개": "{n} {n|image|images}",
    "셀 {n}개": "{n} {n|cell|cells}",
    "현재 화면: {mode}": "Current view: {mode}",
    "참조: {ref} · 작업: {work}": "Reference: {ref} · Working: {work}",
    "파일 {n}개 · {size}": "{n} {n|file|files} · {size}",
    "{n}개": "{n}",
    "메모리 {mb}MB": "Memory {mb}MB",
    "페이지 JS 힙 {mb}MB": "Page JS heap {mb}MB",
    "현재 {ext} · 확장자 필터 변경": "Now {ext} · change extension filter",
    "최신 상태로 실행 ({n})": "Run from a fresh state ({n})",
    "오류 줄 {line}로 이동": "Go to error line {line}",
    "입력값 {current}/{total}을 입력해 주세요.": "Enter input {current}/{total}.",
    "변수 {n}개 (현재 셀까지 · 펼치면 현재 값)": "{n} {n|variable|variables} (through this cell · expand for current values)",
    "생성·변경 파일 {n}개": "{n} generated or modified {n|file|files}",
    "파일 {n}개 저장": "Saved {n} {n|file|files}",
    "실행 {n}밀리초": "Ran in {n} ms",
    "실행 {seconds}초": "Ran in {seconds} s",
    "실행 {minutes}분 {seconds}초": "Ran in {minutes} min {seconds} s",
    "값을 불러오지 못했습니다: {message}": "Couldn't load the value: {message}",
    "작업폴더 준비 오류: {message}": "Working-folder setup error: {message}",
    "셀 실행 중… · {kernel} · 기준 {cwd}": "Running cell… · {kernel} · working folder {cwd}",
    "오류 · {kernel} · 기준 {cwd} · 커널 유지{elapsed}": "Error · {kernel} · working folder {cwd} · kernel kept{elapsed}",
    "완료{warning} · {kernel} · 기준 {cwd}{files}{elapsed}": "Complete{warning} · {kernel} · working folder {cwd}{files}{elapsed}",
    "중지됨 · {kernel} 커널 초기화됨": "Stopped · {kernel} kernel reset",
    "실행 오류: {message}": "Execution error: {message}",
    "커널 재시작 실패: {message}": "Couldn't restart the kernel: {message}",
    "{kernel} 커널 재시작됨 · 상태 초기화": "{kernel} kernel restarted · state reset",
    "내보내기 실패: {message}": "Export failed: {message}",
    "{name} 로 내보냈어요.": "Exported as {name}.",
    "로컬 실행 실패: {message}": "Local run failed: {message}",
    "편집 후 {shortcut} 실행 · 옆 파일 포함": "Edit, then run with {shortcut} · includes adjacent files",
    "편집 후 {shortcut} 로 실행": "Edit, then run with {shortcut}",
    "{ext} 파일만 보기": "Show only {ext} files",
    "압축 안에 열 수 있는 형식이 없어요. · {n}개 형식 미지원": "No openable formats inside the archive. · {n} unsupported {n|format|formats}"
  };

  function tf(tmpl, vars) {
    vars = vars || {};
    var s = (lang === "en" && PARAMS[tmpl] != null) ? PARAMS[tmpl] : String(tmpl);
    return s.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, function (m, key, sing, plur) {
      if (sing !== undefined) return (Number(vars[key]) === 1) ? sing : plur;
      return (vars[key] != null) ? String(vars[key]) : m;
    });
  }

  /* ── 정적 셸 + 동적 서브트리 스캔: 번역 대상 바인딩을 수집한다. ── */
  var bindings = [];
  var scanned = false;
  var ATTRS = ["title", "aria-label", "placeholder", "alt"];
  // 같은 노드/속성을 중복 바인딩하지 않도록 추적(동적 서브트리를 여러 번 넘겨도 안전).
  var seenText = new WeakSet();
  var seenHtml = new WeakSet();
  var seenAttr = new WeakMap();   // el -> Set(attr)

  function shortcutManagesTitle(el) {
    return el.hasAttribute && el.hasAttribute("data-shortcut-title");
  }
  function shortcutManagesAria(el) {
    return el.hasAttribute && el.dataset && el.dataset.shortcutAria === "true";
  }

  function bindAttr(el, attr) {
    if (!el.hasAttribute(attr)) return;
    if (attr === "title" && shortcutManagesTitle(el)) return;      // syncShortcutHints 가 관리
    if (attr === "aria-label" && shortcutManagesAria(el)) return;
    var v = el.getAttribute(attr);
    var core = v && v.trim();
    if (!core || !Object.prototype.hasOwnProperty.call(DICT, core)) return;
    var set = seenAttr.get(el);
    if (!set) { set = new Set(); seenAttr.set(el, set); }
    if (set.has(attr)) return;
    set.add(attr);
    bindings.push({ t: "attr", el: el, attr: attr, ko: v, en: DICT[core] });
  }
  function bindElement(el) {
    for (var a = 0; a < ATTRS.length; a++) bindAttr(el, ATTRS[a]);
    if (el.hasAttribute("data-i18n") && !seenHtml.has(el)) {
      var key = el.getAttribute("data-i18n");
      if (Object.prototype.hasOwnProperty.call(HTML_DICT, key)) {
        seenHtml.add(el);
        bindings.push({ t: "html", el: el, ko: el.innerHTML, en: HTML_DICT[key] });
      }
    }
  }

  // root 서브트리에서 번역 대상을 수집해 bindings 에 추가하고, 새로 추가된 것만 반환한다.
  function collectFrom(root) {
    if (!root) return [];
    var start = bindings.length;

    // 1) 텍스트 노드
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (seenText.has(n)) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest("[data-i18n]")) return NodeFilter.FILTER_REJECT; // 리치 블록은 통째로 처리
        var raw = n.nodeValue;
        if (!raw) return NodeFilter.FILTER_REJECT;
        var core = raw.trim();
        return (core && Object.prototype.hasOwnProperty.call(DICT, core))
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      seenText.add(node);
      var raw = node.nodeValue;
      var mm = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      bindings.push({ t: "text", node: node, ko: raw, en: mm[1] + DICT[mm[2]] + mm[3] });
    }

    // 2) 속성 + 3) 리치 블록 (root 자신 + 모든 하위 요소)
    if (root.nodeType === 1) bindElement(root);
    if (root.querySelectorAll) {
      var els = root.querySelectorAll("*");
      for (var i = 0; i < els.length; i++) bindElement(els[i]);
    }
    return bindings.slice(start);
  }

  function scan() {
    if (scanned || !document.body) return;
    scanned = true;
    collectFrom(document.body);
  }

  function applyOne(b) {
    var val = (lang === "en") ? b.en : b.ko;
    if (b.t === "text") {
      if (b.node.nodeValue !== val) b.node.nodeValue = val;
    } else if (b.t === "attr") {
      el_setAttr(b.el, b.attr, val);
    } else if (b.t === "html") {
      if (b.el.innerHTML !== val) b.el.innerHTML = val;
    }
  }
  function bindingConnected(b) {
    var target = (b.t === "text") ? b.node : b.el;
    return !!(target && target.isConnected);
  }

  var KO_TITLE = null;
  function render() {
    scan();
    // DOM 에서 사라진 바인딩(닫힌 문서·재생성된 툴바 등)은 정리해 배열이 무한정 커지지 않게 한다.
    var live = [];
    for (var i = 0; i < bindings.length; i++) {
      var b = bindings[i];
      if (!bindingConnected(b)) continue;
      applyOne(b);
      live.push(b);
    }
    bindings = live;
    if (KO_TITLE == null) KO_TITLE = document.title;
    document.title = (lang === "en") ? "Manneung File Classroom" : KO_TITLE;
    try { document.documentElement.lang = lang; } catch (_) {}
    if (typeof window.syncShortcutHints === "function") {
      try { window.syncShortcutHints(); } catch (_) {}
    }
    updateToggleButton();
  }
  function el_setAttr(el, attr, val) {
    if (el.getAttribute(attr) !== val) el.setAttribute(attr, val);
  }

  // 동적으로 만들어진 서브트리(명령 팔레트·실행 툴바 등)를 현재 언어로 번역한다.
  // 수집한 바인딩은 저장되므로 이후 언어 토글에도 함께 갱신된다.
  function translateTree(root) {
    if (!root) return;
    try {
      var added = collectFrom(root);
      for (var i = 0; i < added.length; i++) applyOne(added[i]);
      if (root.querySelectorAll && typeof window.syncShortcutHints === "function") {
        window.syncShortcutHints(root);
      }
    } catch (_) {}
  }

  function setLang(next) {
    if (next !== "ko" && next !== "en") return;
    if (next === lang) return;
    lang = next;
    try { localStorage.setItem("uiLang", lang); } catch (_) {}
    render();
    // 이미 열려 있는 동적 UI(명령 팔레트·사이드바 상태 등)도 현재 언어로 다시 그릴 수 있게 알린다.
    try { window.dispatchEvent(new CustomEvent("mni18nchange", { detail: { lang: lang } })); } catch (_) {}
  }

  var toggleBtn = null;
  function updateToggleButton() {
    if (!toggleBtn) return;
    // 버튼에는 '전환될 언어'를 표시한다.
    toggleBtn.textContent = (lang === "en") ? "한" : "EN";
    toggleBtn.setAttribute("aria-label", (lang === "en") ? "한국어로 전환 / Switch to Korean" : "Switch to English / 영어로 전환");
    toggleBtn.title = toggleBtn.getAttribute("aria-label");
  }

  function ready() {
    toggleBtn = document.getElementById("langToggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        setLang(lang === "en" ? "ko" : "en");
      });
    }
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }

  // 공개 API
  window.t = t;
  window.tf = tf;
  window.MNI18N = {
    get lang() { return lang; },
    setLang: setLang,
    t: t,
    tf: tf,
    render: render,
    translateTree: translateTree
  };
})();
