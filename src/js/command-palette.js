"use strict";
/*
 * 명령 팔레트 (Ctrl+K) — 기능을 검색해 바로 실행하는 창.
 * 기능이 많은 앱에서 "어디 있는지 몰라도" 이름으로 찾아 실행하게 해 발견성을 높인다.
 * 새 로직을 만들지 않고, 이미 있는 전역 함수·헤더 버튼을 그대로 재사용해 실행한다.
 * 전역 오염을 피하려고 IIFE 로 감싸고 window.openCommandPalette 만 노출한다.
 */
(function(){
  if (typeof window === "undefined" || !window.document) return;
  const $ = (id) => document.getElementById(id);
  const curState = () => { try { return state; } catch(_){ return null; } };   // state 는 전역 let(문서 상태)

  // ── 실행 대상 판별(문맥) ─────────────────────────────
  const isPdf   = () => { const s = curState(); return !!(s && s.kind === "pdf"); };
  const hasDoc  = () => !!curState();
  const hasMultipleDocs = () => { try { return docs.length > 1; } catch(_){ return false; } };
  const canRun  = () => { const s = curState(); return !!(s && s.el && s.el.querySelector(".run-go")); };
  const canPrint= () => { const s = curState(); return !!(s && s.kind !== "pdf"); };   // 헤더 인쇄 단추와 같은 조건(PDF 는 저장으로)
  const canStudy = () => { const b = $("studyToggle"); return !!(b && !b.hidden); };
  const clickId = (id) => { const el = $(id); if (el) el.click(); };
  const callFn  = (name, ...args) => { if (typeof window[name] === "function") window[name](...args); };
  // 현재 문서 화면 안의 도구막대 버튼 — 뷰어마다 자기 버튼을 갖고 있으므로 활성 문서에서만 찾는다.
  const inDoc = (selector) => { const s = curState(); return (s && s.el && s.el.querySelector(selector)) || null; };
  const hasBtn = (selector) => () => !!inDoc(selector);
  const clickBtn = (selector) => () => { const b = inDoc(selector); if (b) b.click(); };

  // 표시 정보만 분리하고 기존 명령의 실행 함수·문맥 조건은 그대로 사용한다.
  const CATEGORIES = [
    {
      "id": "all",
      "label": "전체",
      "icon": "list"
    },
    {
      "id": "current",
      "label": "현재 문서",
      "icon": "file"
    },
    {
      "id": "files",
      "label": "파일·열기",
      "icon": "folder"
    },
    {
      "id": "create",
      "label": "새로 만들기",
      "icon": "file"
    },
    {
      "id": "edit",
      "label": "편집·변환",
      "icon": "arrowBoth"
    },
    {
      "id": "tools",
      "label": "수업·도구",
      "icon": "school"
    },
    {
      "id": "view",
      "label": "보기·설정",
      "icon": "settings"
    }
  ];
  const COMMAND_UI = {
    openFiles: ["files","file","파일을 작업공간에 추가"],
    openFolder: ["files","folder","폴더 안의 파일을 함께 열기"],
    newPython: ["create","code","Python 코드 작성·실행"],
    newJava: ["create","code","Java 코드 작성·실행"],
    newJs: ["create","code","JavaScript 코드 작성·실행"],
    newNotebook: ["create","notebook","코드·마크다운 셀을 작성하고 실행"],
    newSheet: ["create","table","셀·수식으로 데이터를 정리"],
    newBoard: ["create","board","그림과 글로 자유롭게 판서"],
    newText: ["create","text","간단한 글과 메모 작성"],
    newMnote: ["create","puzzle","글·표·이미지를 블록으로 구성"],
    newMusic: ["create","school","음표를 놓고 소리로 확인"],
    newMap: ["create","map","위치·거리·영역을 지도에 표시"],
    newTimeline: ["create","clock","사건과 기간을 시간순으로 정리"],
    newConcept: ["create","graph","개념을 연결해 관계와 구조 정리"],
    newDbConn: ["create","database","데이터베이스 연결 문서 만들기"],
    newDiary: ["create","calendar","날짜별 글과 사진 기록"],
    newPhotoAlbum: ["create","image","사진과 영상을 모아 보는 사진첩 열기"],
    newTrip: ["create","location","여정·지도·장소를 함께 기록"],
    newStudy: ["create","notebook","문답·빈칸 카드를 만들고 복습"],
    newTier: ["create","chart","항목을 등급별로 나누어 배치"],
    newBracket: ["create","graph","토너먼트·리그 대진과 결과 관리"],
    newPick: ["create","dice","참가자 명단으로 룰렛·추첨 진행"],
    mapToBoard: ["current","board","현재 지도를 화이트보드로 옮겨 판서"],
    boardInsertMap: ["current","map","화이트보드에 지도를 넣어 함께 판서"],
    mapOfflinePrepare: ["current","folder","지도 타일의 오프라인 보관 상태 확인"],
    openLesson: ["files","video","녹화한 수업 파일 열어 다시 보기"],
    newTask: ["create","task","현재 자료를 과제 파일로 구성해 배포"],
    taskBatch: ["edit","task","과제 제출 파일을 모아 확인·재채점"],
    newExam: ["create","notebook","객관식·주관식·이미지 문항 작성"],
    examGrade: ["edit","check","제출된 답안을 채점하고 성적 정리"],
    examples: ["tools","code","파이썬 예제를 골라 열고 실행"],
    javaExamples: ["tools","code","자바 예제를 골라 열고 실행"],
    scratchpad: ["tools","text","작업 중 떠 있는 메모창 열기"],
    scratchpadOverview: ["tools","search","메모를 목록으로 보고 제목·본문 검색"],
    compareFiles: ["edit","arrowBoth","열린 두 파일의 내용 차이를 비교"],
    compareSaved: ["current","arrowBoth","현재 편집 내용과 저장본의 차이 확인"],
    replaceAcrossFiles: ["edit","arrowBoth","여러 문서의 일치하는 글을 함께 바꾸기"],
    convertFormat: ["edit","arrowBoth","JSON·CSV·표·마크다운 등의 형식 변환"],
    lottoPicker: ["tools","dice","로또 6/45 번호 조합 뽑기"],
    pensionPicker: ["tools","dice","연금복권 720+ 번호 조합 뽑기"],
    exchangeRate: ["tools","chart","고시환율을 확인하고 통화 금액 계산"],
    imageMemo: ["tools","image","이미지를 모아 두고 메모와 함께 보기"],
    refreshCurrent: ["files","redo","현재 파일을 원본에서 다시 읽어 오기"],
    workspaceMenu: ["files","folder","작업공간을 바꾸거나 추가·이름 변경·삭제"],
    backupExport: ["files","save","복구본·편집 초안·메모·설정을 ZIP 하나로 백업"],
    backupRestore: ["files","undo","백업 ZIP에서 복구본·메모·설정 되살리기"],
    clearWorkspace: ["files","delete","다음 실행 때 자동 복원할 작업공간 지우기"],
    saveFolder: ["files","folder","직전에 저장한 파일이 있는 폴더 열기"],
    remoteTerminal: ["tools","code","SSH로 다른 컴퓨터에 접속해 명령 실행"],
    petFocus: ["tools","clock","집중·휴식 시간을 재는 펫 타이머 열기"],
    petDex: ["tools","heart","지금까지 만난 픽셀 펫 친구들 보기"],
    petSayings: ["tools","text","펫이 말풍선으로 하는 말 직접 쓰기"],
    petBuilder: ["tools","sticker","그림·움직임·색·대사를 골라 나만의 펫 만들기"],
    theme: ["view","sun","화면의 밝은 테마와 어두운 테마 전환"],
    sidebar: ["view","column","파일 목록 서랍을 접거나 펼치기"],
    language: ["view","text","앱의 표시 언어를 한국어 또는 영어로 전환"],
    screensaver: ["view","view","설정한 대기 화면을 바로 시작"],
    settings: ["view","settings","일반·표시·단축키 등 앱 설정 열기"],
    help: ["view","info","주요 사용법과 단축키 안내 보기"],
    welcome: ["view","info","처음 실행할 때 나오는 사용 안내 다시 보기"],
    licenses: ["view","file","앱에 들어 있는 라이브러리·글꼴·음원의 라이선스 보기"],
    manual: ["view","notebook","전체 기능의 자세한 사용법 문서 열기"],
    spellcheck: ["current","check","현재 문서의 한국어 맞춤법·띄어쓰기 검사"],
    goToLine: ["current","list","코드 편집기에서 지정한 줄로 이동"],
    pyTrace: ["current","play","한 줄씩 실행하며 변수 변화 확인"],
    pyAnalyze: ["current","warning","코드의 오류와 문제 점검"],
    pyGrade: ["current","check","테스트 입력과 출력으로 자동 채점"],
    pyPkg: ["current","puzzle","Python 실행에 필요한 라이브러리 설치"],
    jsPkg: ["current","puzzle","JavaScript 실행에 사용할 라이브러리 선택"],
    pyRec: ["current","video","코드 수업 과정을 리플레이로 녹화"],
    pyRevert: ["current","undo","현재 코드를 원본 내용으로 되돌리기"],
    pyToNotebook: ["current","notebook","현재 코드를 노트북 셀로 구성"],
    nbRunAll: ["current","play","노트북의 모든 코드 셀을 순서대로 실행"],
    nbRestart: ["current","redo","커널을 초기화한 뒤 전체 코드 셀 실행"],
    nbToc: ["current","list","노트북의 제목·셀 목차로 이동"],
    nbExportPdf: ["current","save","노트북을 PDF 파일로 내보내기"],
    nbInk: ["current","pen","노트북 화면 위에 펜으로 필기"],
    nbHelp: ["current","info","노트북 셀 편집·실행 단축키 안내"],
    sheetEdit: ["current","table","표의 셀 편집·정렬·필터 모드 전환"],
    sheetFind: ["current","search","표 안의 글과 셀 내용을 찾기"],
    boardEducation: ["current","math","수학·과학 기호와 교육 도형 도구 열기"],
    boardFocus: ["current","view","스포트라이트·화면 가리개로 수업에 집중"],
    boardUngroup: ["current","puzzle","선택한 교육 도형을 구성 요소로 분리"],
    boardRec: ["current","video","화이트보드 판서 과정을 녹화"],
    boardClear: ["current","eraser","현재 화이트보드의 모든 내용을 지우기"],
    closeCurrent: ["current","close","현재 탭의 파일을 닫기"],
    deleteCurrent: ["current","delete","확인 후 현재 원본 파일을 디스크에서 삭제"],
    reopenClosed: ["files","undo","마지막으로 닫은 파일을 다시 열기"],
    previousFile: ["current","arrowLeft","열린 탭 중 이전 파일로 이동"],
    nextFile: ["current","chevronRight","열린 탭 중 다음 파일로 이동"],
    studyToggle: ["current","column","참고 문서와 작업 문서를 나란히 보기"],
    pdfSign: ["current","pen","서명이나 도장을 PDF의 원하는 위치에 배치"],
    pdfText: ["current","text","PDF의 필요한 위치에 글자 추가"],
    pdfDate: ["current","calendarDay","PDF에 날짜 글자를 배치"],
    pdfCheck: ["current","check","PDF에 확인용 체크 표시 추가"],
    pdfPen: ["current","highlighter","펜과 형광펜으로 PDF 위에 필기"],
    pdfCodeLink: ["current","code","현재 Python 코드 줄과 PDF 위치를 연결"],
    pdfFind: ["current","search","PDF 문서의 글자와 내용을 찾기"],
    pdfOutline: ["current","list","PDF 목차와 책갈피로 빠르게 이동"],
    pdfPages: ["current","column","PDF 페이지를 미리 보고 추출·회전·정리"],
    pdfMerge: ["current","file","여러 PDF 파일을 하나로 합치기"],
    pdfNight: ["current","sun","PDF 색상을 반전해 야간에 보기"],
    pdfDownload: ["current","save","편집한 PDF를 파일로 저장"],
    pdfUndo: ["current","undo","직전 PDF 편집을 취소"],
    pdfRedo: ["current","redo","취소한 PDF 편집을 다시 적용"],
    runCode: ["current","play","지금 편집 중인 코드를 실행"],
    print: ["current","file","현재 문서를 인쇄하거나 PDF로 저장"],
    fullscreen: ["current","view","문서 영역을 전체화면으로 보기"]
  };


  // ── 명령 목록: label(표시)·icon·kw(검색 키워드)·when(문맥)·sc(연결 단축키)·run(실행) ──
  const C = (id, icon, label, run, opts) => Object.assign({ id, icon, label, run }, opts || {});
  const COMMANDS = [
    // 만들기 · 열기
    C("openFiles","📂","파일 열기", () => { if (typeof window.pickFilesOrInput === "function") window.pickFilesOrInput($("fileInput")); else clickId("sbOpenFiles"); }, { sc:"openFiles", kw:"open file 파일 열기 불러오기 추가" }),
    C("openFolder","🗂️","폴더 열기", () => { if (typeof window.pickFolderOrInput === "function") window.pickFolderOrInput($("folderInput")); else clickId("sbOpenFolder"); }, { sc:"openFolder", kw:"folder 폴더 열기" }),
    C("newPython","🐍","새 파이썬 코드", () => callFn("newPythonScratch"), { sc:"newPython", kw:"python 파이썬 코드 새 만들기 new" }),
    C("newJs","📜","새 자바스크립트 코드 (.js)", () => callFn("newJsScratch"), { kw:"javascript js mjs node 자바스크립트 코드 새 만들기 new" }),
    C("newJava","☕","새 자바 코드 (.java)", () => callFn("newJavaScratch"), { kw:"java 자바 코드 새 만들기 new class 클래스 jdk" }),
    C("newNotebook","📓","새 노트북 (.ipynb)", () => callFn("newNotebookScratch"), { kw:"jupyter notebook 노트북 ipynb 커널 셀" }),
    C("newSheet","📊","새 빈 표 (엑셀)", () => callFn("newSpreadsheetScratch"), { kw:"excel sheet 엑셀 표 스프레드시트 xlsx" }),
    C("newBoard","🖊️","새 화이트보드", () => callFn("newWhiteboard"), { sc:"newBoard", kw:"whiteboard 화이트보드 칠판 판서 필기" }),
    C("newText","📝","새 텍스트 파일", () => callFn("newTextScratch"), { kw:"text txt 텍스트 메모장 새" }),
    C("newMnote","🧩","새 블록 문서 (.mnote)", () => callFn("newMnoteScratch"), { kw:"block document 블록 문서 표 이미지 글 혼합 mnote 노션" }),
    C("newMusic","🎵","새 악보 (.msheet)", () => callFn("newMusicScratch"), { kw:"music score sheet 악보 음악 음표 오선 노래 동요 재생 msheet" }),
    C("newMap","🗺️","새 지도 (.map)", () => callFn("newMapScratch"), { kw:"map 지도 위치 좌표 마커 표시 사회 지리 답사 leaflet" }),
    C("newTimeline","⏳","새 연대표 (.timeline)", () => callFn("newTimelineScratch"), { kw:"timeline 연대표 연표 역사 사건 시대 사회 국어 과학사 chronology" }),
    C("newConcept","🕸️","새 개념 관계도 (.concept)", () => callFn("newConceptScratch"), { kw:"concept map 개념 관계도 마인드맵 원인 결과 포함 비교 연결" }),
    C("newDbConn","🛢️","새 DB 접속 (.dbconn)", () => callFn("newDbConnScratch"), { kw:"database db sql mysql postgres sqlite oracle 데이터베이스 디비 접속 연결 쿼리 dbconn" }),
    C("newDiary","📔","새 일기장 (.diary)", () => callFn("newDiaryScratch"), { kw:"diary journal 일기 일기장 다이어리 달력 날짜 스티커 사진" }),
    C("newPhotoAlbum","🖼️","사진첩 열기", () => callFn("openPhotoAlbum"), { kw:"photo album gallery image video 사진첩 사진 앨범 이미지 영상 동영상 꾸미기 슬라이드쇼" }),
    C("newTrip","🧳","새 여행일지 (.trip)", () => callFn("newTripScratch"), { kw:"trip travel 여행 여행일지 일지 기록 지도 동선 경비" }),
    C("newStudy","🧠","새 암기 카드 (.study)", () => callFn("newStudyScratch"), { kw:"study flashcard 암기 카드 단어장 오답 복습 빈칸" }),
    C("newTier","🏆","새 티어표 (.tier)", () => callFn("newTierScratch"), { kw:"tier list tierlist 티어 티어표 티어리스트 등급 순위 랭킹 S A B C D 분류" }),
    C("newBracket","🥇","새 대진표 (.bracket)", () => callFn("newBracketScratch"), { kw:"bracket tournament 대진표 토너먼트 대진 경기 대회 리그 월드컵 16강 8강 결승 우승 점수" }),
    C("newPick","🎡","새 복불복 뽑기 (.pick)", () => callFn("newPickScratch"), { kw:"pick random roulette wheel lottery draw 복불복 뽑기 랜덤 룰렛 돌림판 추첨 제비뽑기 사다리 당첨 발표 순서 벌칙" }),
    C("mapToBoard","🖊️","지도를 칠판으로", clickBtn(".map-to-board"),
      { when:hasBtn(".map-to-board"), kw:"map board 지도 칠판 화이트보드 판서 필기 스냅샷 캡처" }),
    C("boardInsertMap","🗺️","칠판에 지도 넣기", clickBtn(".wb-map"),
      { when:hasBtn(".wb-map"), kw:"map board 지도 넣기 칠판 화이트보드 배경 위치" }),
    C("mapOfflinePrepare","🗂️","지도 오프라인 현황", clickBtn(".map-prepare"),
      { when:hasBtn(".map-prepare"), kw:"map offline cache 지도 오프라인 캐시 현황 비우기" }),
    C("openLesson","⏯️","수업 리플레이 열기 (.lesson)", () => callFn("openLessonFilePicker"), { kw:"lesson replay 리플레이 되감기 수업 녹화" }),
    C("newTask","📦","과제 파일 만들기 (.task)", () => callFn("openTaskBuilderFromActive"), { kw:"task assignment 과제 만들기 배포 자동채점 숙제" }),
    C("taskBatch","🗂️","제출본 일괄 검수 (.taskdone)", () => callFn("openTaskBatchReview"), { kw:"taskdone submission 제출 검수 재채점 성적 채점 일괄 csv" }),
    C("newExam","📝","새 시험지 만들기 (.exam)", () => callFn("newExamPaper"), { kw:"exam test quiz 시험 시험지 문제지 객관식 주관식 출제 배포" }),
    C("examGrade","✅","시험 채점 (.examdone)", () => callFn("openExamGrading"), { kw:"examdone grading 시험 채점 성적 점수 제출 답안 csv" }),
    C("examples","✨","파이썬 예제 갤러리", () => callFn("openSnippetGallery", "py"), { kw:"example gallery 예제 갤러리 샘플 연습 python 파이썬" }),
    C("javaExamples","✨","자바 예제 갤러리", () => callFn("openSnippetGallery", "java"), { kw:"example gallery 예제 갤러리 샘플 연습 java 자바" }),
    // 도구 · 보기
    C("scratchpad","🗒️","임시 메모 열기", () => callFn("openScratchpadForNotebookDrop"), { sc:"scratchpad", kw:"memo note 메모 임시 스크래치 노트" }),
    C("scratchpadOverview","🔎","메모 목록·검색", () => callFn("openScratchpadOverview"), { kw:"memo note search 메모 목록 검색 찾기 훑어보기 갤러리 카드" }),
    C("compareFiles","🔀","두 파일 비교 (diff)", () => callFn("openFileComparePicker"),
      { when:() => { try { return typeof diffComparableDocs === "function" && diffComparableDocs().length >= 2; } catch(_){ return false; } },
        kw:"diff compare 비교 차이 다른 점 변경 대조" }),
    C("compareSaved","🔀","저장본과 비교 (현재 문서)", () => callFn("compareActiveDocWithSaved"),
      { when:() => { const s = curState(); return !!(s && s.codeEditor); },
        kw:"diff compare 저장본 원본 비교 변경 사항 바뀐" }),
    C("replaceAcrossFiles","🔁","여러 파일 찾아 바꾸기", () => callFn("openBatchReplace"),
      { when:() => { try { return typeof window.batchReplaceTargetDocs === "function" && window.batchReplaceTargetDocs().length > 0; } catch(_){ return false; } },
        kw:"replace 바꾸기 치환 찾아 여러 파일 일괄 한꺼번에 replace all find" }),
    C("convertFormat","🔄","형식 변환 (JSON·CSV·표·마크다운)", () => callFn("openDataConvert"),
      { kw:"convert format json csv tsv xml yaml table markdown 변환 형식 포맷 표 바꾸기 데이터" }),
    C("lottoPicker","🎱","로또 번호 뽑기 (6/45)", () => callFn("openLottoPicker", { game:"lotto" }),
      { kw:"lotto lottery 645 로또 복권 번호 추천 생성 뽑기 제외 공통 게임 추첨" }),
    C("pensionPicker","🎟️","연금복권 번호 뽑기 (720+)", () => callFn("openLottoPicker", { game:"pension" }),
      { kw:"pension lottery 720 연금복권 연금 복권 번호 추천 생성 뽑기 조 자리 고정 추첨" }),
    C("exchangeRate","💱","환율 (고시환율·환율 계산)", () => callFn("openExchangeRate"),
      { kw:"exchange rate currency 환율 고시환율 매매기준율 달러 엔 유로 위안 송금 계산 사회 경제" }),
    C("imageMemo","🖼️","이미지 메모", () => clickId("imageMemoOpen"), { kw:"image 이미지 캡처 스크린샷 메모" }),
    C("refreshCurrent","🔃","현재 파일 새로고침", () => clickId("sbRefreshActive"),
      { when:hasDoc, kw:"refresh reload 새로고침 다시 읽기 다시 불러오기 원본 디스크 갱신" }),
    C("workspaceMenu","🗃️","작업공간 목록·추가·이름 변경·삭제", () => callFn("openWorkspaceMenuFromButton"),
      { kw:"workspace 작업공간 작업 공간 전환 바꾸기 추가 이름 변경 삭제 목록" }),
    C("backupExport","💾","전체 백업 ZIP 내보내기", () => clickId("sbBackupExport"),
      { kw:"backup export zip 백업 내보내기 옮기기 다른 컴퓨터 PC 이사" }),
    C("backupRestore","📥","백업 ZIP에서 복원", () => clickId("sbBackupRestore"),
      { kw:"backup restore import zip 백업 복원 되살리기 가져오기 불러오기" }),
    C("clearWorkspace","🧹","최근 작업공간 지우기", () => clickId("sbClearWorkspace"),
      { kw:"clear workspace 작업공간 자동 복원 기록 지우기 초기화 비우기" }),
    C("saveFolder","📁","저장 폴더 열기", () => callFn("__mnOpenLastSavedFolder"),
      { when:() => { const b = $("saveFolderOpen"); return !!(b && !b.hidden && typeof window.__mnOpenLastSavedFolder === "function"); },
        kw:"save folder 저장 폴더 위치 열기" }),
    C("remoteTerminal","🖥️","원격 터미널", () => clickId("remoteTerminalOpen"),
      { kw:"ssh terminal remote shell console 원격 터미널 서버 접속 명령 콘솔 리눅스" }),
    C("petFocus","⏱️","픽셀 펫 집중 모드", () => clickId("petFocusOpen"),
      { when:() => { const w = $("petFocusWrap"); return !!(w && !w.hidden); },
        kw:"pet focus pomodoro timer 펫 집중 모드 휴식 타이머 뽀모도로 공부 시간" }),
    C("petDex","📖","펫 도감", () => callFn("openPetDex"), { kw:"pet dex gallery 펫 도감 캐릭터 친구 모음 픽셀" }),
    C("petSayings","💬","펫 대사 편집", () => callFn("openPetSayings"), { kw:"pet sayings speech 펫 대사 말풍선 말 문구 편집" }),
    C("petBuilder","🎨","나만의 펫 만들기", () => callFn("openPetBuilder"), { kw:"pet builder custom 펫 만들기 나만의 캐릭터 꾸미기 색 움직임" }),
    C("theme","🌓","밝게 / 어둡게 전환 (테마)", () => clickId("themeToggle"), { kw:"theme dark light 다크 라이트 테마 어둡게 밝게 야간" }),
    C("sidebar","↔️","사이드바 접기 / 펼치기", () => clickId("sidebarToggle"), { kw:"sidebar 사이드바 목록 파일 접기 펼치기" }),
    // EN 버튼은 설정에서 숨길 수 있고 설정 창에는 언어 항목이 없다 — 여기가 유일한 대체 통로다.
    C("language","🌐","한국어 / English 전환", () => clickId("langToggle"), { kw:"language lang english korean 언어 영어 한국어 전환 번역" }),
    C("screensaver","🖥️","대기 화면 지금 시작", () => callFn("startScreensaverNow"), { sc:"screensaverStart", kw:"screensaver 대기 화면 화면보호기 휴식" }),
    C("settings","⚙️","설정 열기", () => clickId("settingsOpen"), { kw:"settings 설정 환경 옵션 preferences" }),
    C("help","❓","도움말 · 단축키", () => clickId("helpOpen"), { kw:"help 도움말 단축키 shortcut 가이드" }),
    C("welcome","👋","처음 사용 안내 보기", () => clickId("welcomeReopen"), { kw:"welcome onboarding tour 처음 사용 안내 시작 소개 튜토리얼" }),
    C("licenses","📜","오픈소스 라이선스", () => callFn("openThirdPartyNotices"), { kw:"license notices open source 라이선스 오픈소스 저작권 저작자 표시 고지" }),
    C("manual","📖","자세한 사용법 문서", () => callFn("openUserManual"),
      { kw:"manual guide 사용법 설명서 매뉴얼 안내 도움말 문서 어떻게" }),
    C("spellcheck","🔤","한국어 맞춤법 검사", clickBtn(".spellcheck-trigger"),
      { when:hasBtn(".spellcheck-trigger"), kw:"spell 맞춤법 띄어쓰기 교정 검사 오타" }),
    C("goToLine","🔢","줄 번호로 이동", () => { const s = curState(); if (s && typeof s.openGotoLine === "function") s.openGotoLine(); },
      { when:() => { const s = curState(); return !!(s && typeof s.openGotoLine === "function"); }, sc:"goToLine",
        kw:"goto line 줄 라인 번호 이동 점프 몇번째" }),
    // 파이썬 편집기 도구막대 — 설정에서 숨긴 버튼은 화면에 없어도 팔레트로는 계속 실행할 수 있다.
    C("pyTrace","👣","단계 실행 (변수 추적)", clickBtn(".run-trace"),
      { when:hasBtn(".run-trace"), kw:"trace step 단계 실행 디버그 변수 추적 한줄씩" }),
    C("pyAnalyze","🩺","코드 진단", clickBtn(".run-analyze"),
      { when:hasBtn(".run-analyze"), kw:"analyze lint 진단 검사 오류 문제 점검" }),
    C("pyGrade","💯","자동 채점", clickBtn(".run-grade"),
      { when:hasBtn(".run-grade"), kw:"grade 채점 점수 자동 테스트 과제" }),
    C("pyPkg","📦","파이썬 라이브러리 설치", clickBtn(".run-py-pkg"),
      { when:hasBtn(".run-py-pkg"), kw:"package pip 라이브러리 설치 모듈 numpy pandas" }),
    C("jsPkg","🟨","JavaScript 라이브러리 추가", clickBtn(".run-js-library"),
      { when:hasBtn(".run-js-library"), kw:"javascript js library lodash dayjs papa parse math 라이브러리 추가" }),
    C("pyRec","⏺️","수업 리플레이 녹화", clickBtn(".run-rec"),
      { when:hasBtn(".run-rec"), kw:"record 녹화 리플레이 lesson 수업 저장" }),
    C("pyRevert","↩️","원본으로 되돌리기", clickBtn(".run-py-revert"),
      { when:hasBtn(".run-py-revert"), kw:"revert 원본 되돌리기 복구 처음 상태" }),
    C("pyToNotebook","📓","노트북으로 변환", clickBtn(".run-nbconvert-group button"),
      { when:hasBtn(".run-nbconvert-group button"), kw:"convert notebook 노트북 변환 ipynb 셀" }),
    // 노트북 도구막대
    C("nbRunAll","⏩","노트북 전체 셀 실행", clickBtn(".nbv-runall"),
      { when:hasBtn(".nbv-runall"), sc:"runNotebook", kw:"run all 전체 실행 모든 셀 노트북" }),
    C("nbRestart","🔄","커널 다시 시작 후 전체 실행", clickBtn(".nbv-restartrun"),
      { when:hasBtn(".nbv-restartrun"), kw:"restart kernel 커널 재시작 다시 시작 초기화" }),
    C("nbToc","📑","노트북 목차", clickBtn(".nbv-toc-open"),
      { when:hasBtn(".nbv-toc-open"), kw:"outline toc 목차 차례 셀 이동" }),
    C("nbExportPdf","🖨️","노트북 PDF로 내보내기", clickBtn(".nbv-export-pdf"),
      { when:hasBtn(".nbv-export-pdf"), kw:"export pdf 내보내기 저장 인쇄 노트북" }),
    C("nbInk","🖌️","노트북 위에 필기", clickBtn(".nbv-ink-toggle"),
      { when:hasBtn(".nbv-ink-toggle"), kw:"ink pen 필기 펜 판서 그리기" }),
    C("nbHelp","⌨️","노트북 단축키 보기", clickBtn(".nbv-help-open"),
      { when:hasBtn(".nbv-help-open"), kw:"shortcut 단축키 도움말 노트북 키" }),
    // 표(엑셀)
    C("sheetEdit","✏️","표 편집·정렬 모드 켜기 / 끄기", clickBtn(".xlsx-editmode-btn"),
      { when:hasBtn(".xlsx-editmode-btn"), kw:"edit sheet 표 편집 셀 정렬 필터 엑셀 수정" }),
    C("sheetFind","🔎","표에서 찾기", clickBtn(".xlsx-tool-menu-find > summary"),
      { when:hasBtn(".xlsx-tool-menu-find > summary"), kw:"find search 표 찾기 검색 셀" }),
    // 화이트보드
    C("boardEducation","∑","수학·과학 도구상자", clickBtn(".wb-edu-toggle"),
      { when:hasBtn(".wb-edu-toggle"), kw:"math science 수학 과학 기호 수식 도형 좌표축 회로 도구상자" }),
    C("boardFocus","◉","화이트보드 집중 도구", clickBtn(".wb-focus-toggle"),
      { when:hasBtn(".wb-focus-toggle"), kw:"spotlight curtain 스포트라이트 화면 가리개 집중 공개 수업" }),
    C("boardUngroup","▦","교육 도형 그룹 풀기", clickBtn(".wb-ungroup"),
      { when:hasBtn(".wb-ungroup:not(:disabled)"), kw:"ungroup 분리 그룹 풀기 구성 요소 도형" }),
    C("boardRec","⏺️","화이트보드 녹화", clickBtn(".wb-rec"),
      { when:hasBtn(".wb-rec"), kw:"record 녹화 리플레이 판서 수업 화이트보드" }),
    C("boardClear","🧽","화이트보드 전부 지우기", clickBtn(".wb-clear"),
      { when:hasBtn(".wb-clear"), kw:"clear erase 지우기 전체 비우기 화이트보드 칠판" }),
    // 문서(PDF) 전용
    C("closeCurrent","×","현재 파일 닫기", () => { const s = curState(); if (s) callFn("closeDoc", s.id, { forgetWorkspace:true }); }, { when:hasDoc, sc:"closeCurrent", kw:"close 닫기 탭 파일" }),
    C("deleteCurrent","🗑️","현재 파일을 디스크에서 삭제", () => { const s = curState(); if (s) callFn("deleteDocsFromDisk", [s.id]); },
      { when:() => { const s = curState(); return !!(s && typeof canDeleteOriginalDoc === "function" && canDeleteOriginalDoc(s)); },
        kw:"delete remove 삭제 지우기 파일 디스크 제거 버리기" }),
    C("reopenClosed","↶","닫은 파일 다시 열기", () => callFn("reopenClosedDoc"), { sc:"reopenClosed", kw:"reopen restore 닫은 파일 탭 복원" }),
    C("previousFile","◀","이전 열린 파일", () => callFn("navigateTab", -1), { when:hasMultipleDocs, sc:"previousFile", kw:"previous 이전 파일 탭 이동" }),
    C("nextFile","▶","다음 열린 파일", () => callFn("navigateTab", 1), { when:hasMultipleDocs, sc:"nextFile", kw:"next 다음 파일 탭 이동" }),
    C("studyToggle","⇄","분할 작업 켜기 / 끄기", () => clickId("studyToggle"), { when:canStudy, kw:"study split 분할 작업 참고 나란히" }),
    C("pdfSign","✍️","PDF 서명 추가", () => clickId("btnSign"), { when:isPdf, kw:"sign signature 서명 도장" }),
    C("pdfText","🔤","PDF 텍스트 넣기", () => clickId("btnText"), { when:isPdf, kw:"text 텍스트 글자" }),
    C("pdfDate","📅","PDF 날짜 넣기", () => clickId("btnDate"), { when:isPdf, kw:"date 날짜" }),
    C("pdfCheck","✔️","PDF 체크 표시", () => clickId("btnCheck"), { when:isPdf, kw:"check 체크 확인 표시" }),
    C("pdfPen","🖍️","PDF 펜 · 형광펜 필기", () => clickId("btnPen"), { when:isPdf, kw:"pen highlight 펜 형광펜 필기 강조 마크업" }),
    C("pdfCodeLink","🔗","현재 Python 줄을 PDF에 연결", () => clickId("btnCodeLink"),
      { when:() => { try { return typeof targetPdfForCodeLink === "function" && !!targetPdfForCodeLink(); } catch(_){ return false; } },
        kw:"code link pin 코드 연결 파이썬 줄 핀" }),
    C("pdfFind","🔍","PDF에서 찾기", () => callFn("openPdfFind"), { when:isPdf, sc:"findInDocument", kw:"find search 찾기 검색" }),
    C("pdfOutline","📑","PDF 목차(책갈피)", () => clickId("btnOutline"), { when:() => { const s = curState(); return !!(s && s.kind === "pdf" && s.pdfOutline && s.pdfOutline.length); }, kw:"outline toc bookmark 목차 책갈피 북마크 차례" }),
    C("pdfPages","🗂️","페이지 썸네일 · 정리", () => clickId("btnPages"), { when:isPdf, kw:"pages 페이지 썸네일 추출 정리 삭제 회전" }),
    C("pdfMerge","➕","PDF 합치기", () => clickId("btnMergePdf"), { when:isPdf, kw:"merge 합치기 병합 이어붙이기" }),
    C("pdfNight","🌙","PDF 야간 보기(색 반전)", () => clickId("btnPdfNight"), { when:isPdf, kw:"night dark invert 야간 다크 반전 눈부심 어둡게" }),
    C("pdfDownload","💾","PDF 다운로드 / 저장", () => clickId("btnDownload"), { when:isPdf, sc:"saveCurrent", kw:"download save 다운로드 저장 내보내기" }),
    C("pdfUndo","↶","PDF 편집 실행 취소", () => callFn("undoPdfEdit"), { when:isPdf, kw:"undo 실행 취소 되돌리기" }),
    C("pdfRedo","↷","PDF 편집 다시 실행", () => callFn("redoPdfEdit"), { when:isPdf, kw:"redo 다시 실행 복구" }),
    // 코드 실행 / 인쇄 / 전체화면 (문맥)
    C("runCode","▶️","현재 코드 실행", () => { const s = curState(); const b = s && s.el && s.el.querySelector(".run-go"); if (b) b.click(); }, { when:canRun, sc:"runCode", kw:"run execute 실행 돌리기" }),
    C("print","🖨️","인쇄 / PDF로 저장", () => clickId("btnPrint"), { when:canPrint, kw:"print 인쇄 출력 pdf" }),
    C("fullscreen","⛶","문서 영역 전체화면", () => callFn("toggleViewerFullscreen"), { when:hasDoc, kw:"fullscreen 전체화면 크게" })
  ];

  // ── 검색 ─────────────────────────────
  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const localizedLabel = (cmd) => (typeof window.t === "function" ? window.t(cmd.label) : cmd.label);
  function score(cmd, q){
    // 화면에는 영어 레이블을 보여 주므로, 검색도 원문·번역문 양쪽을 대상으로 한다.
    const description = COMMAND_UI[cmd.id] && COMMAND_UI[cmd.id][2] || "";
    const hay = norm([cmd.label, localizedLabel(cmd), cmd.kw || "", description, translate(description)].join(" "));
    const i = hay.indexOf(norm(q));
    if (i >= 0) return 1000 - i;                    // 앞쪽에서 일치할수록 상위
    // "로또 뽑기"처럼 사이 낱말을 빼고 쳐도 찾도록, 띄어 쓴 낱말이 모두 들어 있으면 통째 일치보다 아래 순위로 보여 준다.
    const words = String(q || "").normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 2) return -1;
    const at = words.map(word => hay.indexOf(word));
    return at.some(pos => pos < 0) ? -1 : 500 - Math.min(...at);
  }
  const available = () => COMMANDS.filter(c => { if (!c.when) return true; try { return !!c.when(); } catch(_){ return false; } });
  function shortcutKey(cmd){
    if (!cmd.sc || typeof window.shortcutValue !== "function" || typeof window.shortcutDisplay !== "function") return "";
    try { return window.shortcutDisplay(window.shortcutValue(cmd.sc)) || ""; } catch(_){ return ""; }
  }

  // ── UI ─────────────────────────────
  const translate = (text) => typeof window.t === "function" ? window.t(text) : text;
  const countText = (count) => typeof window.tf === "function" ? window.tf("{n}개 기능", { n:count }) : count + "개 기능";
  const infoFor = (cmd) => {
    const [category, icon, description] = COMMAND_UI[cmd.id] || ["tools", "file", cmd.label];
    return { category, icon, description };
  };
  const groupFor = (cmd) => CATEGORIES.find(group => group.id === infoFor(cmd).category);
  const currentOrder = { runCode:0, pdfSign:0, nbRunAll:0, sheetEdit:0, boardEducation:0, mapToBoard:0,
    pyRevert:90, closeCurrent:95, boardClear:98, deleteCurrent:99 };
  const create = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = translate(text);
    return el;
  };
  const icon = (name, className="cmdk-icon") => {
    const el = create("span", className);
    el.setAttribute("aria-hidden", "true");
    if (typeof window.uiIcon === "function") el.innerHTML = window.uiIcon(name);
    return el;
  };
  const documentName = () => {
    const doc = curState();
    return doc ? String(doc.name || (doc.file && doc.file.name) || ($("activeFileName") && $("activeFileName").textContent) || translate("현재 문서")) : "";
  };
  function scopeFor(cmd){
    if (cmd.id === "pdfCodeLink") return "Python 코드와 PDF 문서";
    if (cmd.id.startsWith("pdf")) return "PDF 문서";
    if (cmd.id.startsWith("nb")) return "노트북 문서";
    if (cmd.id.startsWith("sheet")) return "표 문서";
    if (cmd.id.startsWith("board")) return "화이트보드";
    if (cmd.id.startsWith("map")) return "지도";
    if (cmd.id === "pyPkg") return "Python 문서";
    if (cmd.id === "jsPkg") return "JavaScript 문서";
    if (cmd.id.startsWith("py") || cmd.id === "runCode" || cmd.id === "goToLine") return "코드 편집기";
    return cmd.when ? "현재 문서·작업공간" : "공통 기능";
  }
  function commandPath(cmd){
    if (cmd.id === "pdfSign") return translate("PDF 도구") + " › " + translate("서명");
    return translate(groupFor(cmd).label) + " › " + localizedLabel(cmd);
  }

  let overlay = null, card = null, input = null, listEl = null, emptyEl = null, resultTitle = null, resultCount = null;
  let contextEl = null, clearButton = null, detailButton = null, detailPane = null, detailContent = null, detailRun = null;
  let tabs = [], options = [], items = [], activeIndex = 0, previousFocus = null, category = "all", detailsOpen = false;
  const focusableInPalette = () => overlay ? [...overlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]')]
    .filter(el => !el.disabled && el.tabIndex !== -1 && !el.closest("[hidden]")) : [];
  function trapFocus(e){
    if (e.key !== "Tab") return;
    const nodes = focusableInPalette();
    if (!nodes.length){ e.preventDefault(); return; }
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (!nodes.includes(document.activeElement)){ e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  function clampCard(){
    requestAnimationFrame(() => {
      if (overlay && !overlay.hidden && typeof card.__clampMovableModal === "function") card.__clampMovableModal(true);
    });
  }
  function setDetails(open){
    detailsOpen = open; detailPane.hidden = !open;
    detailButton.setAttribute("aria-expanded", String(open)); card.classList.toggle("has-details", open);
    // 이동 뒤 고정된 폭도 설명 패널의 폭에 맞추고 화면 안에 수납한다.
    card.style.width = ""; card.style.maxWidth = "";
    renderDetails(); clampCard();
  }
  function renderDetails(){
    const cmd = items[activeIndex];
    detailRun.disabled = !cmd;
    const fragment = document.createDocumentFragment();
    if (cmd){
      const info = infoFor(cmd);
      fragment.append(icon(info.icon, "cmdk-detail-icon"), create("h3", "cmdk-detail-title", localizedLabel(cmd)),
        create("p", "cmdk-detail-description", info.description), create("small", "cmdk-detail-caption", "사용 조건"));
      fragment.append(create("span", "cmdk-detail-scope", scopeFor(cmd)), create("small", "cmdk-detail-caption", "실행 위치"));
      const location = create("p", "cmdk-detail-path", commandPath(cmd));
      location.setAttribute("data-i18n-ignore", ""); fragment.append(location);
      const shortcut = shortcutKey(cmd);
      if (shortcut){
        fragment.append(create("small", "cmdk-detail-caption", "단축키"));
        const key = create("kbd", "cmdk-detail-shortcut", shortcut);
        key.setAttribute("data-i18n-ignore", ""); fragment.append(key);
      }
      detailRun.setAttribute("aria-label", localizedLabel(cmd) + " · " + translate("실행"));
    } else {
      fragment.append(icon("info", "cmdk-detail-icon"), create("p", "cmdk-detail-description", "기능을 선택하면 설명을 볼 수 있어요"));
      detailRun.setAttribute("aria-label", translate("선택한 기능 실행"));
    }
    detailContent.replaceChildren(fragment);
  }
  function build(){
    overlay = create("div", "cmdk-overlay"); overlay.hidden = true;
    card = create("div", "cmdk movable-card"); card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true"); card.setAttribute("aria-labelledby", "cmdkTitle"); card.setAttribute("data-i18n-ui", "");
    const header = create("div", "cmdk-head"), grip = icon("move", "cmdk-grip");
    grip.title = translate("제목줄을 끌어 창 이동");
    const title = create("strong", "cmdk-title", "기능 검색·실행"); title.id = "cmdkTitle";
    detailButton = create("button", "cmdk-detail-toggle"); detailButton.type = "button";
    detailButton.setAttribute("aria-label", translate("상세 설명"));
    detailButton.setAttribute("aria-controls", "cmdkDetails"); detailButton.setAttribute("aria-expanded", "false");
    detailButton.append(icon("info"), create("span", "", "상세 설명"));
    const openingKey = create("kbd", "cmdk-opening-key", "Ctrl+K"); openingKey.setAttribute("data-shortcut-action", "commandPalette");
    const closeButton = create("button", "cmdk-close"); closeButton.type = "button";
    closeButton.setAttribute("aria-label", translate("닫기")); closeButton.append(icon("close"));
    header.append(grip, title, detailButton, openingKey, closeButton);

    const searchWrap = create("div", "cmdk-inputwrap");
    input = create("input", "cmdk-input"); input.type = "search"; input.autocomplete = "off"; input.spellcheck = false;
    input.placeholder = translate("기능 이름을 검색하세요");
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-label", translate("명령 검색")); input.setAttribute("aria-controls", "cmdkList"); input.setAttribute("aria-expanded", "true");
    clearButton = create("button", "cmdk-clear"); clearButton.type = "button";
    clearButton.setAttribute("aria-label", translate("검색 지우기")); clearButton.append(icon("close"));
    searchWrap.append(icon("search", "cmdk-ico"), input, clearButton);

    const body = create("div", "cmdk-body"), navigation = create("div", "cmdk-categories");
    navigation.setAttribute("role", "tablist"); navigation.setAttribute("aria-label", translate("기능 카테고리"));
    navigation.setAttribute("aria-orientation", "vertical");
    for (const group of CATEGORIES){
      const tab = create("button", "cmdk-category"); tab.type = "button"; tab.id = "cmdkCategory-" + group.id;
      tab.dataset.category = group.id; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "cmdkResults");
      const count = create("span", "cmdk-category-count"); count.setAttribute("data-i18n-ignore", "");
      tab.append(icon(group.icon), create("span", "cmdk-category-label", group.label), count);
      tab.addEventListener("click", () => { category = group.id; input.value = ""; render(""); });
      tab.addEventListener("keydown", (e) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const index = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
          : (tabs.indexOf(tab) + (e.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[index].click(); tabs[index].focus();
      });
      tabs.push(tab); navigation.append(tab);
    }
    const work = create("div", "cmdk-work"), results = create("div", "cmdk-results");
    results.id = "cmdkResults"; results.setAttribute("role", "tabpanel");
    const summary = create("div", "cmdk-summary");
    resultTitle = create("strong", "", "전체"); resultCount = create("span", "cmdk-count");
    resultCount.setAttribute("data-i18n-ignore", ""); resultCount.setAttribute("role", "status"); resultCount.setAttribute("aria-live", "polite");
    summary.append(resultTitle, resultCount);
    contextEl = create("div", "cmdk-context"); contextEl.setAttribute("data-i18n-ignore", "");
    listEl = create("div", "cmdk-list"); listEl.id = "cmdkList"; listEl.setAttribute("role", "listbox");
    listEl.setAttribute("aria-label", translate("사용 가능한 기능"));
    emptyEl = create("div", "cmdk-empty"); emptyEl.hidden = true;
    results.append(summary, contextEl, listEl, emptyEl);
    detailPane = create("aside", "cmdk-details"); detailPane.id = "cmdkDetails"; detailPane.hidden = true;
    detailPane.setAttribute("aria-label", translate("기능 상세 설명"));
    detailContent = create("div", "cmdk-detail-content");
    detailRun = create("button", "cmdk-detail-run"); detailRun.type = "button";
    detailRun.append(icon("play"), create("span", "", "선택한 기능 실행"), create("kbd", "", "Enter"));
    detailPane.append(detailContent, detailRun); work.append(results, detailPane); body.append(navigation, work);

    const footer = create("div", "cmdk-footer"), keys = create("span", "cmdk-keys");
    keys.append(create("kbd", "", "↑ ↓"), create("span", "", "이동"), create("kbd", "", "Enter"), create("span", "", "실행"),
      create("kbd", "", "Esc"), create("span", "", "닫기"));
    footer.append(keys, create("span", "cmdk-search-scope", "사용 가능한 전체 기능 검색"));
    card.append(header, searchWrap, body, footer); overlay.append(card);
    // 공용 창 이동은 제목줄에서만 시작한다. 검색·목록·설명 영역의 선택은 그대로 둔다.
    [searchWrap, body, footer].forEach(region => region.addEventListener("mousedown", (e) => e.stopPropagation()));
    document.body.appendChild(overlay);
    if (typeof window.makeCardMovable === "function") window.makeCardMovable(card);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(overlay);
    input.addEventListener("input", (e) => { if (!e.isComposing) render(input.value); });
    input.addEventListener("compositionend", () => render(input.value));
    input.addEventListener("keydown", onInputKey);
    clearButton.addEventListener("click", () => { input.value = ""; render(""); input.focus(); });
    detailButton.addEventListener("click", () => setDetails(!detailsOpen));
    detailRun.addEventListener("click", () => run(activeIndex));
    closeButton.addEventListener("click", () => close());
    overlay.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229){ e.stopPropagation(); return; }
      if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
      trapFocus(e);
    });
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  }
  function render(query, preserveActive=false){
    const previousId = preserveActive && items[activeIndex] && items[activeIndex].id;
    const avail = available(), searching = !!String(query || "").trim();
    // 카테고리를 고른 상태에서도 검색은 현재 사용 가능한 모든 명령을 대상으로 한다.
    const matching = searching ? avail.map(c => ({ c, s:score(c, query) })).filter(x => x.s >= 0)
      .sort((a,b) => b.s - a.s).map(x => x.c) : avail.filter(c => category === "all" || infoFor(c).category === category);
    const groups = searching ? [] : CATEGORIES.slice(1).map(group => ({
      group, commands:matching.filter(cmd => infoFor(cmd).category === group.id)
        .sort((a,b) => group.id === "current" ? (currentOrder[a.id] ?? 50) - (currentOrder[b.id] ?? 50) : 0)
    })).filter(entry => entry.commands.length);
    items = searching ? matching : groups.flatMap(entry => entry.commands);
    activeIndex = Math.max(0, items.findIndex(cmd => cmd.id === previousId)); options = [];
    const selectedCategory = searching ? "all" : category;
    for (const tab of tabs){
      const id = tab.dataset.category, selected = id === selectedCategory;
      tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
      tab.querySelector(".cmdk-category-count").textContent = String(avail.filter(cmd => id === "all" || infoFor(cmd).category === id).length);
    }
    $("cmdkResults").setAttribute("aria-labelledby", "cmdkCategory-" + selectedCategory);
    resultTitle.textContent = translate(searching ? "검색 결과" : CATEGORIES.find(group => group.id === category).label);
    resultCount.textContent = countText(items.length);
    const name = documentName(); contextEl.hidden = !(name && !searching && (category === "current" || category === "all"));
    contextEl.textContent = name; clearButton.hidden = !input.value;
    emptyEl.hidden = items.length > 0; listEl.hidden = items.length === 0;
    emptyEl.textContent = translate(!searching && category === "current" ? "문서를 열면 관련 기능을 볼 수 있어요" : "일치하는 기능이 없어요");
    const fragment = document.createDocumentFragment();
    const addRow = (cmd) => {
      const idx = options.length, info = infoFor(cmd), row = create("div", "cmdk-item");
      row.id = "cmdkOption" + idx; row.dataset.command = cmd.id; row.setAttribute("role", "option");
      const copy = create("span", "cmdk-item-copy");
      copy.append(create("span", "cmdk-item-label", localizedLabel(cmd)), create("small", "cmdk-item-description", info.description));
      row.append(icon(info.icon, "cmdk-item-ico"), copy);
      const key = shortcutKey(cmd);
      if (key){ const kb = create("kbd", "cmdk-item-key", key); kb.setAttribute("data-i18n-ignore", ""); row.append(kb); }
      row.addEventListener("mousemove", () => { if (activeIndex !== idx) setActive(idx, false); });
      row.addEventListener("click", () => run(idx)); options.push(row); fragment.append(row);
    };
    if (searching) items.forEach(addRow);
    else groups.forEach(({ group, commands }) => {
      if (category === "all"){
        const heading = create("div", "cmdk-group-title", group.label); heading.setAttribute("role", "presentation"); fragment.append(heading);
      }
      commands.forEach(addRow);
    });
    listEl.replaceChildren(fragment); listEl.scrollTop = 0;
    setActive(activeIndex, false);
  }
  function setActive(idx, scroll=true){
    if (idx < 0 || idx >= items.length){
      input.removeAttribute("aria-activedescendant"); renderDetails(); return;
    }
    activeIndex = idx;
    options.forEach((el,i) => {
      const selected = i === idx; el.classList.toggle("active", selected); el.setAttribute("aria-selected", String(selected));
    });
    input.setAttribute("aria-activedescendant", "cmdkOption" + idx);
    if (scroll && options[idx]) options[idx].scrollIntoView({ block:"nearest" });
    renderDetails();
  }
  function move(delta){ if (items.length) setActive((activeIndex + delta + items.length) % items.length); }
  function onInputKey(e){
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown"){ e.preventDefault(); e.stopPropagation(); move(1); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); e.stopPropagation(); move(-1); }
    else if (e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); run(activeIndex); }
  }
  function run(idx){
    const c = items[idx]; if (!c || !overlay || overlay.hidden) return;
    if (!available().includes(c)){ render(input.value); return; }
    close(false);
    // 파일 선택창·새 모달의 포커스를 유지하도록 닫은 뒤 실행한다.
    setTimeout(() => {
      try {
        if (c.when && !c.when()){
          if (typeof window.toast === "function") window.toast(translate("현재 문서에서 사용할 수 없는 기능이에요."), 2000, { type:"info" });
          return;
        }
        c.run();
      } catch(err){
        console.error(err); if (typeof window.toast === "function") window.toast(translate("실행하지 못했어요."), 2000, { type:"error" });
      }
    }, 0);
  }
  function open(){
    if (document.querySelector(".modal:not([hidden])")) return;
    if (!overlay) build();
    if (!overlay.hidden) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    category = "all"; overlay.hidden = false; card.removeAttribute("style"); input.value = "";
    render(""); setDetails(detailsOpen);
    if (typeof window.syncShortcutHints === "function") window.syncShortcutHints(overlay);
    requestAnimationFrame(() => { if (!overlay.hidden){ try { input.focus(); input.select(); } catch(_){} } });
  }
  function close(restoreFocus=true){
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    const restore = previousFocus; previousFocus = null;
    if (restoreFocus && restore && restore.isConnected) requestAnimationFrame(() => {
      if (overlay.hidden){ try { restore.focus(); } catch(_){} }
    });
  }
  window.openCommandPalette = open;

  // 열린 팔레트는 언어 전환 뒤에도 결과 목록·검색 순위를 즉시 새 언어 기준으로 맞춘다.
  window.addEventListener("mni18nchange", () => {
    if (overlay && !overlay.hidden) render(input ? input.value : "", true);
  });

  // ── 상시 진입점(헤더 버튼·빈 화면 힌트) 연결 ──
  // 팔레트는 이미 완성돼 있으나 진입점이 도움말 안 단축키뿐이라 발견성이 낮았다.
  // 파일 타입과 무관한 헤더 버튼과 드롭존 힌트를 클릭 진입점으로 연결한다.
  ["commandPaletteOpen", "dzCommandPalette"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("click", (e) => { e.preventDefault(); open(); });
  });
  // 헤더 버튼의 kbd 라벨을 실제(커스텀 가능) 단축키와 맞춘다.
  (function syncKbd(){
    const kb = $("commandPaletteKbd");
    if (!kb || typeof window.shortcutValue !== "function" || typeof window.shortcutDisplay !== "function") return;
    try { const k = window.shortcutDisplay(window.shortcutValue("commandPalette")); if (k) kb.textContent = k; } catch(_){}
  })();

  // 팔레트가 열려 있으면 포커스가 어디에 있든 Esc 로 닫힌다.
  // (문서를 연 직후처럼 편집기가 포커스를 가져간 상황에서도 갇히지 않게 — 바깥 클릭과 같은 규칙)
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !overlay || overlay.hidden) return;
    if (overlay.contains(document.activeElement)) return;   // 안에 있으면 입력란 핸들러가 처리
    e.preventDefault(); e.stopPropagation();
    close();
  }, true);

  // ── 열기 단축키(기본 Ctrl+K, 설정 → 단축키에서 변경 가능) ──
  window.addEventListener("keydown", (e) => {
    const matched = typeof window.shortcutMatches === "function"
      ? window.shortcutMatches(e, "commandPalette")
      : ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "k");
    if (!matched || e.isComposing || e.keyCode === 229) return;
    if (overlay && !overlay.hidden){ e.preventDefault(); close(); return; }   // 토글: 이미 열려 있으면 닫기
    if (document.querySelector(".modal:not([hidden])")) return;
    e.preventDefault();
    open();
  }, true);
})();
