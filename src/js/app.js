"use strict";

/* ===== 이벤트 연결 ===== */
function wire(){
  setupSingleTab();          // 같은 앱이 여러 탭/창으로 동시에 떠 자동저장이 충돌하지 않게 — 한 번에 한 창만 활성
  setupWorkspaceUi();        // 상단 작업공간 전환·생성·관리
  if (typeof MNDiagnostics !== "undefined"){
    MNDiagnostics.wireSettings();
    let abnormalShown = false;
    const showPreviousAbnormal = () => {
      if (abnormalShown || !MNDiagnostics.previousAbnormal()) return;
      abnormalShown = true;
      if (typeof toast === "function") toast("직전 실행이 정상 종료되지 않았습니다. 설정 → 진단에서 마지막 기록을 확인할 수 있어요.", 5200, { type:"warning" });
    };
    window.addEventListener("mndiagnosticsabnormal", showPreviousAbnormal);
    setTimeout(showPreviousAbnormal, 800);
  }
  // 보기 전용 화면(PDF·한글·PPT·텍스트 보기)에서 고른 글자의 우클릭 메뉴 — 문서 영역에서 한 번만 받는다.
  if (typeof installViewSelectionContextMenu === "function") installViewSelectionContextMenu();
  wireScratchpad();
  wireImageMemo();
  // 일반 EXE 실행에서는 마지막 브라우저 탭이 닫히면 로컬 서버도 자동 종료한다.
  // 시작프로그램용 상시 서버(CLASSDOCK_NO_BROWSER=1)는 백엔드가 heartbeat 종료를 사용하지 않는다.
  (() => {
    if (location.protocol !== "http:" || !/^(127\.0\.0\.1|localhost)$/i.test(location.hostname)) return;
    const clientId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
    let closed = false, lastServerOk = null;
    // 서버 생존 표시: 하트비트 응답이 오면 초록(연결됨), 실패하면 빨강(끊김). 서버 모드에서만 보인다.
    const setServerStatus = (ok) => {
      const wrap = byId("serverStatus"), text = byId("serverStatusText"), settings = byId("settingsOpen");
      if (!wrap || !text || !settings || closed) return;
      const changed = lastServerOk !== null && lastServerOk !== !!ok;
      lastServerOk = !!ok;
      wrap.hidden = false;
      wrap.classList.toggle("ok", ok);
      wrap.classList.toggle("down", !ok);
      text.textContent = ok ? "서버 연결됨" : "서버 끊김";
      const detail = ok ? "로컬 서버와 연결되어 있습니다." : "로컬 서버가 종료되었습니다. ClassDock.exe 를 다시 실행하세요.";
      const settingsLabel = typeof t === "function" ? t("설정") : "설정", translatedDetail = typeof t === "function" ? t(detail) : detail;
      settings.title = settingsLabel + " · " + translatedDetail;
      settings.setAttribute("aria-label", settings.title);
      if (changed && typeof MNDiagnostics !== "undefined"){
        if (ok) MNDiagnostics.info("local_server_reconnected", "로컬 서버 연결이 복구되었습니다.");
        else MNDiagnostics.warn("local_server_disconnected", "로컬 서버 연결이 끊겼습니다.");
      }
    };
    const syncServerLanguage = () => { if (lastServerOk !== null) setServerStatus(lastServerOk); };
    const beat = () => {
      if (closed) return;
      fetch("/heartbeat?id=" + encodeURIComponent(clientId), {
        method: "POST", headers: { "X-ClassDock-Heartbeat": "1" }, cache: "no-store", keepalive: true
      }).then(r => setServerStatus(!!r && r.ok)).catch(() => setServerStatus(false));
    };
    beat();
    const timer = setInterval(beat, 5000);
    window.addEventListener("focus", beat);
    window.addEventListener("mni18nchange", syncServerLanguage);
    window.addEventListener("pagehide", () => {
      closed = true; clearInterval(timer);
      window.removeEventListener("mni18nchange", syncServerLanguage);
      try { fetch("/heartbeat-close?id=" + encodeURIComponent(clientId), { method:"POST", headers:{ "X-ClassDock-Heartbeat":"1" }, keepalive:true }); } catch(e){}
    }, { once: true });
  })();

  // 내부 드래그(이미지 등 페이지 요소를 끄는 동작)를 외부 파일 드롭과 구분 — 자기 창에 떨궈도 새 파일로 추가하지 않도록
  let internalDrag = false;
  const resetInternalDragState = () => {
    internalDrag = false;
    if (typeof resetDocumentDragState === "function") resetDocumentDragState();
  };
  byId("loadingCancel").onclick = cancelUiBatch;
  window.addEventListener("dragstart", (e) => {
    internalDrag = true;
    try { if (e.dataTransfer) e.dataTransfer.setData(INTERNAL_DRAG_MIME, "1"); } catch (_) {}
  }, true);

  // 드롭존
  const fileInput = byId("fileInput");
  byId("dzFileBtn").addEventListener("click", (e) => { e.stopPropagation(); pickFilesOrInput(fileInput); });
  fileInput.addEventListener("change", (e) => { const fs = e.target.files; if (fs.length){ queueFiles(fs); e.target.value = ""; } });
  // 폴더 열기(webkitdirectory) — 드래그가 막히는 file:// 에서도 폴더를 통째로 연다
  const folderInput = byId("folderInput");
  folderInput.addEventListener("change", async (e) => {
    const fs = [...e.target.files];
    const entries = [...(e.target.webkitEntries || [])];
    if (fs.length || entries.length){
      const folderPaths = await collectFolderEntryPaths(entries, fs);
      handleFolderInputSelection(fs, { folderPaths });
    }
    e.target.value = "";
  });
  folderInput.addEventListener("cancel", clearPendingFolderRefresh);
  byId("dzFolderBtn").addEventListener("click", (e) => { e.stopPropagation(); pickFolderOrInput(folderInput); });
  byId("dzNewPy").addEventListener("click", (e) => { e.stopPropagation(); newPythonScratch(); });
  if (byId("dzNewNotebook")) byId("dzNewNotebook").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newNotebookScratch === "function") newNotebookScratch(); });
  byId("dzNewSheet").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newSpreadsheetScratch === "function") newSpreadsheetScratch(); });
  byId("dzNewBoard").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newWhiteboard === "function") newWhiteboard(); });
  byId("dzNewText").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newTextScratch === "function") newTextScratch(); });
  if (byId("dzNewJs")) byId("dzNewJs").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newJsScratch === "function") newJsScratch(); });
  if (byId("dzNewJava")) byId("dzNewJava").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newJavaScratch === "function") newJavaScratch(); });
  if (byId("dzNewMnote")) byId("dzNewMnote").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newMnoteScratch === "function") newMnoteScratch(); });
  if (byId("dzNewMusic")) byId("dzNewMusic").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newMusicScratch === "function") newMusicScratch(); });
  if (byId("dzNewMap")) byId("dzNewMap").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newMapScratch === "function") newMapScratch(); });
  if (byId("dzNewTimeline")) byId("dzNewTimeline").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newTimelineScratch === "function") newTimelineScratch(); });
  if (byId("dzNewConcept")) byId("dzNewConcept").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newConceptScratch === "function") newConceptScratch(); });
  if (byId("dzNewStudy")) byId("dzNewStudy").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newStudyScratch === "function") newStudyScratch(); });
  if (byId("dzNewExam")) byId("dzNewExam").addEventListener("click", (e) => { e.stopPropagation(); if (typeof newExamPaper === "function") newExamPaper(); });
  if (byId("dzOpenLesson")) byId("dzOpenLesson").addEventListener("click", (e) => { e.stopPropagation(); if (typeof openLessonFilePicker === "function") openLessonFilePicker(); });
  if (byId("dzTaskBatch")) byId("dzTaskBatch").addEventListener("click", (e) => { e.stopPropagation(); if (typeof openTaskBatchReview === "function") openTaskBatchReview(); });
  byId("dzExamples").addEventListener("click", (e) => { e.stopPropagation(); openSnippetGallery(); });
  wireRecentItems();
  wireSidebarSelection();
  (() => {                                   // 드롭존 '＋ 다른 문서 만들기' — 사이드바의 실제 생성 형식과 맞춘다
    const btn = byId("dzNew"), menu = byId("dzNewMenu");
    if (!btn || !menu) return;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener("click", (e) => e.stopPropagation());
    items.forEach(it => it.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden){ setOpen(false); btn.focus(); } });
  })();
  ["dragenter","dragover"].forEach(ev => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.add("drag");
  }));
  ["dragleave","drop"].forEach(ev => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); dropzone.classList.remove("drag");
    if (ev === "drop"){
      const wasInternal = isInternalDragTransfer(e.dataTransfer, internalDrag);
      resetInternalDragState();
      if (!wasInternal) queueDroppedItems(e.dataTransfer);
    }
  }));

  // 창 전체로 파일이 떨어져 브라우저가 이동하는 것 방지 + 파일 처리는 여기 한 곳에서만
  const dropOverlay = byId("dropOverlay");
  let dragDepth = 0;
  let dropOverlayTimer = 0;
  const hideOverlay = () => { dragDepth = 0; clearTimeout(dropOverlayTimer); dropOverlayTimer = 0; dropOverlay.classList.remove("show"); };
  const armOverlayTimer = () => { clearTimeout(dropOverlayTimer); dropOverlayTimer = setTimeout(hideOverlay, 10000); };
  // 화면 전체 오버레이가 실제 드롭 대상이므로 창 버블링에만 기대지 않고 여기서 직접 받는다.
  dropOverlay.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  dropOverlay.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    hideOverlay();
    const wasInternal = isInternalDragTransfer(e.dataTransfer, internalDrag);
    resetInternalDragState();
    if (!wasInternal) queueDroppedItems(e.dataTransfer);
  });
  const draggingFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  const memoOwnsFileDrop = () => {
    const imageMemo = byId("imageMemo");
    const scratchpad = byId("scratchpad");
    return !!((imageMemo && !imageMemo.hidden) || (scratchpad && !scratchpad.hidden));
  };
  window.addEventListener("dragenter", (e) => {
    if (!draggingFiles(e) || isInternalDragTransfer(e.dataTransfer, false)) return;
    // 외부 Files 드롭은 이전 내부 드래그 플래그가 남아 있어도 업로드가 우선한다.
    if (internalDrag) resetInternalDragState();
    // 메모 창이 열렸으면 전역 오버레이가 창 위를 덮지 않게 한다.
    // 각 메모의 drop 핸들러가 이미지를 받고 stopPropagation 하므로 본문의 새 탭 열기와 중복되지 않는다.
    if (memoOwnsFileDrop()){ hideOverlay(); return; }
    dragDepth++; dropOverlay.classList.add("show"); armOverlayTimer(); // 오버레이가 떠서 iframe 위까지 덮음 → 어디든 드롭 가능
  });
  window.addEventListener("dragleave", (e) => {
    if (isInternalDragTransfer(e.dataTransfer, internalDrag)) return;
    if (--dragDepth <= 0) hideOverlay();                   // 창 밖으로 완전히 나가면 숨김
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    hideOverlay();
    const wasInternal = isInternalDragTransfer(e.dataTransfer, internalDrag);
    resetInternalDragState();
    if (wasInternal) return;                                             // 페이지 안에서 시작된 드래그(이미지 등)는 무시
    queueDroppedItems(e.dataTransfer);                                  // 어디에 떨궈도 새 탭으로 추가
  });
  window.addEventListener("dragend", () => { resetInternalDragState(); hideOverlay(); }, true);
  window.addEventListener("blur", () => { resetInternalDragState(); hideOverlay(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && internalDrag){ resetInternalDragState(); hideOverlay(); }
  }, true);

  // 모든 편집 문서는 hasUnsavedEdits 를 공통으로 사용한다. PDF는 자체 복구본을
  // 저장하므로 이 플래그를 쓰지 않고, 표·이미지도 여기서 경고한다.
  // 단, 자동 저장·복원이 꺼져 있으면 PDF 편집을 되살릴 수단이 없으므로 함께 경고한다.
  // 화이트보드는 편집 즉시 localStorage 에 자동 저장·복원되므로(PDF 복구본과 같은 안전망)
  // 닫기·새로고침 경고에서 제외한다. 같은 이유로 whiteboard.js 는 ● 자체를 켜지 않는다
  // (아래 boardEditsRecovered 는 예전 문서·복원 경로가 플래그를 켜 두었을 때를 위한 방어선).
  let suppressUnloadWarn = false;
  const pdfEditsAtRisk = (d) => d.kind === "pdf" && !appSettings.pdfRecovery
    && typeof pdfHasPendingEdits === "function" && pdfHasPendingEdits(d);
  const boardEditsRecovered = (d) => d.kind === "board";
  const hasUnsavedEdits = () => docs.some(d => (d.hasUnsavedEdits && !boardEditsRecovered(d)) || pdfEditsAtRisk(d));
  window.addEventListener("keydown", (e) => {
    const isReload = e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"));
    if (!isReload) return;
    if (!hasUnsavedEdits()) return;
    if (!byId("confirmModal").hidden) return;       // 확인창이 이미 떠 있으면 무시
    e.preventDefault();
    confirmDialog("저장하지 않은 편집 내용이 있습니다. 새로고침할까요?", "새로고침", "취소").then(ok => {
      if (ok){ suppressUnloadWarn = true; location.reload(); }
    });
  });

  // Ctrl 키만 빠르게 두 번 누르면 현재 Python 편집기로 포커스를 되돌린다.
  // Ctrl+클릭·Ctrl+단축키를 잘못 인식하지 않도록, 다른 키/포인터와 함께 쓰인 Ctrl은 제외한다.
  (() => {
    let controlDown = false, solo = false, lastTap = 0;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Control"){
        if (!e.repeat){ controlDown = true; solo = !e.altKey && !e.shiftKey && !e.metaKey; }
      } else if (controlDown) solo = false;
    }, true);
    window.addEventListener("pointerdown", () => { if (controlDown) solo = false; }, true);
    window.addEventListener("keyup", (e) => {
      if (e.key !== "Control") return;
      const wasSolo = controlDown && solo;
      controlDown = false; solo = false;
      if (!wasSolo){ lastTap = 0; return; }
      const now = Date.now();
      if (now - lastTap > 360){ lastTap = now; return; }
      lastTap = 0;
      const modalOpen = !!document.querySelector(".modal:not([hidden])");
      const scratchpad = byId("scratchpad");
      if (modalOpen || (scratchpad && !scratchpad.hidden)) return;
      const ta = state && state.codeEditor && state.codeEditor.ta;
      if (!ta || !ta.isConnected) return;
      try { ta.focus({ preventScroll: true }); } catch(_) { ta.focus(); }
    }, true);
    window.addEventListener("blur", () => { controlDown = false; solo = false; lastTap = 0; });
  })();
  // 탭 닫기처럼 가로챌 수 없는 경우엔 브라우저 기본 확인창으로 폴백.
  window.addEventListener("beforeunload", (e) => {
    // 백업 복원은 교체를 이미 확인했다. 이전 문서 저장과 추가 경고 없이 다시 불러온다.
    if (typeof MNBackup !== "undefined" && MNBackup.isRestoring()) return;
    // 화이트보드는 경고 없이 닫혀도 복원되도록, 디바운스를 건너뛰고 마지막 편집까지 즉시 저장한다.
    docs.forEach(d => {
      if (d.kind === "board" && typeof d.flushBoardRecovery === "function") d.flushBoardRecovery();
      else if (["timeline", "concept", "study"].includes(d.kind) && typeof d.flushBackupRecovery === "function") d.flushBackupRecovery();
    });
    if (typeof persistTabStateNow === "function") persistTabStateNow();
    if (suppressUnloadWarn) return;
    if (hasUnsavedEdits()){ e.preventDefault(); e.returnValue = ""; }
  });

  // 인쇄/PDF 저장 시 잘림 방지: PPTX 슬라이드를 인쇄 페이지 폭에 맞춰 "똑바로" 축소한다.
  // (페이지 방향은 강제하지 않는다 — landscape 를 강제하면 일부 브라우저가 내용을 90° 회전시켜 저장하는 버그가 있어서.)
  const PRINT_FIT_W = 700;                        // 세로 A4 인쇄 가능 폭(px) 근사
  const PRINT_FIT_H = 940;                        // 세로 A4 인쇄 가능 높이(px) 근사 — 높이로도 맞춰 1슬라이드=1페이지 보장
  window.addEventListener("beforeprint", () => {
    const host = state && state.el ? state.el.querySelector(".pptx-host") : null;
    if (!host) return;
    const slide = host.querySelector(".slide");
    const natW = slide ? (parseFloat(slide.style.width)  || slide.getBoundingClientRect().width  || 960) : 960;
    const natH = slide ? (parseFloat(slide.style.height) || slide.getBoundingClientRect().height || 540) : 540;
    host.style.setProperty("--pptx-print-zoom", Math.min(1, PRINT_FIT_W / natW, PRINT_FIT_H / natH));
    host.querySelectorAll(".slide").forEach(s => {           // 각 슬라이드를 컨테이너로 감싸 한 페이지에 하나씩 + 아래로 내림
      if (!s.parentElement || !s.parentElement.classList.contains("pptx-print-page")){
        const w = document.createElement("div"); w.className = "pptx-print-page";
        s.parentNode.insertBefore(w, s); w.appendChild(s);
      }
    });
  });
  window.addEventListener("afterprint", () => {
    const host = state && state.el ? state.el.querySelector(".pptx-host") : null;
    if (host) host.style.removeProperty("--pptx-print-zoom");
  });

  // 툴바
  byId("btnSign").onclick = openSig;
  byId("btnText").onclick = () => addTextElement("text", { fontSize: 18 });
  byId("btnDate").onclick = () => {
    const d = new Date();
    const s = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    addTextElement("date", { fontSize: 18, text: s });
  };
  byId("btnCheck").onclick = () => addTextElement("check", { fontSize: 30, color: "#16a34a", bold: true, text: "✓" });
  byId("btnPen").onclick = () => { if (typeof togglePenMode === "function") togglePenMode(); };
  byId("btnStudyPen").onclick = () => { if (typeof togglePenMode === "function") togglePenMode(); };
  // 분할 방향과 위치 교체는 분할 경계의 버튼 및 분할바에서 제어한다.
  // 찾기 단추(btnPdfFind·btnStudyFind)는 아래 페이지 컨트롤 묶음에서 칸별로 배선한다.
  byId("btnCodeLink").onclick = createCodeLinkFromActiveEditor;
  byId("btnPages").onclick = () => togglePdfPagePanel();
  byId("btnOutline").onclick = () => togglePdfOutlinePanel();
  byId("btnPdfNight").onclick = () => togglePdfNightMode();
  applyPdfNightMode();                        // 저장된 야간 보기 상태 복원
  byId("btnMergePdf").onclick = () => byId("mergePdfInput").click();
  byId("mergePdfInput").addEventListener("change", (e) => {
    const files = [...e.target.files]; e.target.value = "";
    if (files.length && state && state.kind === "pdf") mergePdfFiles(state, files);
  });
  byId("btnDownload").onclick = exportPdf;
  // 화이트보드는 판서가 <canvas> 라 화면 인쇄로는 도구막대만 찍히고 그림이 빠진다 —
  // 보드 그림 한 장을 만들어 그것만 인쇄한다(whiteboard.js 의 printBoard).
  byId("btnPrint").onclick = () => {
    if (state && state.kind === "board" && typeof state.printBoard === "function"){ state.printBoard(); return; }
    // 악보도 같은 사정이다 — 도구막대·재생바를 빼고 오선만 남겨 찍는다(music-editor.js).
    if (state && state.kind === "music" && typeof state.printScore === "function"){ state.printScore(); return; }
    // 지도도 같다 — 화면을 그대로 찍으면 도구막대만 나오므로 캡처한 그림 한 장을 찍는다(map-viewer.js).
    if (state && state.kind === "map" && typeof state.printMap === "function"){ state.printMap(); return; }
    if (state && state.kind === "timeline" && typeof state.printTimeline === "function"){ state.printTimeline(); return; }
    window.print();
  };
  byId("btnFullscreen").onclick = toggleViewerFullscreen;
  byId("btnOfficeFullscreen").onclick = toggleViewerFullscreen;
  byId("studyToggle").onclick = toggleStudyMode;
  if (byId("studyRoleSwap")) byId("studyRoleSwap").onclick = () => {         // 두 칸 사이 ⇄: 좌우/위아래 위치 바꾸기
    if (typeof setStudySwapped === "function") setStudySwapped(!studySwapped);
  };
  if (byId("studyDirectionToggle")) byId("studyDirectionToggle").onclick = () => {
    if (typeof setStudyStacked === "function") setStudyStacked(!studyStacked);
  };
  if (byId("studyChipLock")) byId("studyChipLock").onclick = () => {         // 참고 칩의 잠금 토글
    if (typeof setStudyReferenceLocked === "function") setStudyReferenceLocked(!studyReferenceLocked);
  };
  byId("fsExit").onclick = exitViewerFullscreen;
  byId("fsZoomIn").onclick  = () => { const d = fullscreenPdfTarget(); if (d) setPdfZoom((d.zoom || 1) * 1.25, d); showFullscreenControls(); };
  byId("fsZoomOut").onclick = () => { const d = fullscreenPdfTarget(); if (d) setPdfZoom((d.zoom || 1) / 1.25, d); showFullscreenControls(); };
  byId("fsZoomLabel").onclick = () => { const d = fullscreenPdfTarget(); if (d) setPdfZoom(1, d); showFullscreenControls(); };
  byId("fsControls").addEventListener("mousemove", armFullscreenControlsTimer);
  ["mousemove","mousedown","touchstart","keydown"].forEach(ev => {
    window.addEventListener(ev, () => {
      if (isViewerFullscreen()) showFullscreenControls();
      else {
        if (typeof showStudyControls === "function") showStudyControls();   // 분할화면 바 재노출
        if (typeof showPdfControls === "function") showPdfControls();       // PDF 단독 뷰 우측 상단 바 재노출
      }
    }, { passive: true });
  });
  document.addEventListener("fullscreenchange", () => {
    syncFullscreenButtons();
    scheduleViewerLayoutRefresh();
    if (isViewerFullscreen()) showFullscreenControls();
    else hideFullscreenControlsNow();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("viewer-fullscreen")) {
      e.preventDefault();
      exitViewerFullscreen();
    }
  });
  // 화면 확대/축소 (PDF)
  byId("zoomIn").onclick  = () => setPdfZoom(((state && state.zoom) || 1) * 1.25);
  byId("zoomOut").onclick = () => setPdfZoom(((state && state.zoom) || 1) / 1.25);
  byId("zoomLabel").onclick = () => setPdfZoom(1);
  /* 보기 방식(이어보기 ↔ 한 장씩)과 페이지 넘기기. 넘기기 단추는 한 장씩 볼 때만 나오고,
     같은 짝을 세 곳에 둔다 — 문서 위 알약(작업 칸), 전체화면, 분할 작업의 참고 칸. 알약마다
     제 칸의 PDF 를 조작한다: 분할에서 두 칸이 서로 다른 PDF 일 수 있기 때문이다. */
  if (byId("btnPdfPageMode")) byId("btnPdfPageMode").onclick = () => switchPdfPageMode(viewPdfTarget());
  for (const [prevId, nextId] of [["pagePrev", "pageNext"], ["fsPagePrev", "fsPageNext"]]){
    const pick = prevId === "pagePrev" ? viewPdfTarget : fullscreenPdfTarget;
    if (byId(prevId)) byId(prevId).onclick = () => { stepPdfSinglePage(pick(), -1); showFullscreenControls(); showStudyControls(); };
    if (byId(nextId)) byId(nextId).onclick = () => { stepPdfSinglePage(pick(), 1); showFullscreenControls(); showStudyControls(); };
  }
  // 분할 작업(참고 칸) 짝 — 참고 PDF 는 이 알약으로만 넘길 수 있다.
  if (byId("btnStudyPageMode")) byId("btnStudyPageMode").onclick = () => switchPdfPageMode(studyReferencePdf());
  for (const [id, delta] of [["studyPagePrev", -1], ["studyPageNext", 1]]){
    if (byId(id)) byId(id).onclick = () => { stepPdfSinglePage(studyReferencePdf(), delta); showStudyControls(); };
  }
  // 찾기는 그 알약이 얹혀 있는 칸의 PDF 에서 — 분할 중 작업 칸 찾기가 참고 PDF 로 새지 않게.
  byId("btnPdfFind").onclick = () => { if (typeof openPdfFind === "function") openPdfFind(viewPdfTarget()); };
  byId("btnStudyFind").onclick = () => { if (typeof openPdfFind === "function") openPdfFind(studyReferencePdf()); };
  /* 자판으로 넘기기. 한 장씩 볼 때만 가로채고, 글자를 치는 자리에서는 손대지 않는다. 이어보기에서
     PageUp/PageDown 은 브라우저의 스크롤이 그대로 맡는다 — 그 편이 익숙하다. */
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    /* 분할 작업에서는 마지막에 누른 칸의 PDF 를 넘긴다 — 두 칸이 서로 다른 PDF 일 수 있고,
       작업 칸에서 표를 옮기는 동안 화살표가 참고 PDF 를 넘겨 버려서도 안 된다. */
    const content = byId("content");
    const inStudy = !!(content && content.classList.contains("study-mode")) && !isViewerFullscreen();
    const doc = inStudy
      ? (typeof studyTargetPane !== "undefined" && studyTargetPane === "reference" ? studyReferencePdf() : viewPdfTarget())
      : fullscreenPdfTarget();
    if (!doc || typeof pdfIsSinglePage !== "function" || !pdfIsSinglePage(doc)) return;
    const target = e.target;
    if (target && typeof target.closest === "function" &&
        target.closest("input,textarea,select,[contenteditable='true']")) return;
    let delta = 0;
    if (e.key === "PageDown" || e.key === "ArrowRight") delta = 1;
    else if (e.key === "PageUp" || e.key === "ArrowLeft") delta = -1;
    if (!delta) return;
    e.preventDefault();
    stepPdfSinglePage(doc, delta);
  });
  // 페이지 입력: 숫자 입력 후 Enter → 해당 페이지로 이동(헤더·전체화면 공용)
  const wirePageInput = (numId, targetDoc, refresh) => {
    const input = byId(numId); if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter"){ e.preventDefault(); const doc = targetDoc(); if (doc) goToPdfPage(doc, input.value); input.blur(); }
      else if (e.key === "Escape"){ e.preventDefault(); refresh(); input.blur(); }
    });
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", refresh);
  };
  wirePageInput("pageNum", () => state && state.kind === "pdf" ? state : null, () => updatePdfPageIndicator(state));
  wirePageInput("fsPageNum", fullscreenPdfTarget, updateFullscreenPageIndicator);
  // 학습 화면 PDF 페이지 입력(고정된 PDF 기준 — 활성 문서는 코드라 별도 처리)
  (() => {
    const input = byId("studyPageNum"); if (!input) return;
    const ref = () => docs.find(d => d.id === studyPdfId && d.kind === "pdf");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter"){ e.preventDefault(); const r = ref(); if (r) goToPdfPage(r, input.value); updateStudyPageIndicator(); input.blur(); }
      else if (e.key === "Escape"){ e.preventDefault(); updateStudyPageIndicator(); input.blur(); }
    });
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => updateStudyPageIndicator());
  })();
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (!state || state.kind !== "pdf") return;
    if (e.key === "=" || e.key === "+"){ e.preventDefault(); setPdfZoom(((state.zoom) || 1) * 1.25); }
    else if (e.key === "-"){ e.preventDefault(); setPdfZoom(((state.zoom) || 1) / 1.25); }
    else if (e.key === "0"){ e.preventDefault(); setPdfZoom(1); }
  });
  byId("sbNewPy").onclick = () => newPythonScratch();
  if (byId("sbNewJs")) byId("sbNewJs").onclick = () => { if (typeof newJsScratch === "function") newJsScratch(); };
  if (byId("sbNewJava")) byId("sbNewJava").onclick = () => { if (typeof newJavaScratch === "function") newJavaScratch(); };
  if (byId("sbNewNotebook")) byId("sbNewNotebook").onclick = () => { if (typeof newNotebookScratch === "function") newNotebookScratch(); };
  byId("sbNewSheet").onclick = () => { if (typeof newSpreadsheetScratch === "function") newSpreadsheetScratch(); };
  byId("sbNewBoard").onclick = () => { if (typeof newWhiteboard === "function") newWhiteboard(); };
  byId("sbNewText").onclick = () => { if (typeof newTextScratch === "function") newTextScratch(); };
  if (byId("sbNewMnote")) byId("sbNewMnote").onclick = () => { if (typeof newMnoteScratch === "function") newMnoteScratch(); };
  if (byId("sbNewMusic")) byId("sbNewMusic").onclick = () => { if (typeof newMusicScratch === "function") newMusicScratch(); };
  if (byId("sbNewMap")) byId("sbNewMap").onclick = () => { if (typeof newMapScratch === "function") newMapScratch(); };
  if (byId("sbNewTimeline")) byId("sbNewTimeline").onclick = () => { if (typeof newTimelineScratch === "function") newTimelineScratch(); };
  if (byId("sbNewDbConn")) byId("sbNewDbConn").onclick = () => { if (typeof newDbConnScratch === "function") newDbConnScratch(); };
  if (byId("sbNewConcept")) byId("sbNewConcept").onclick = () => { if (typeof newConceptScratch === "function") newConceptScratch(); };
  if (byId("sbNewStudy")) byId("sbNewStudy").onclick = () => { if (typeof newStudyScratch === "function") newStudyScratch(); };
  if (byId("sbOpenLesson")) byId("sbOpenLesson").onclick = () => { if (typeof openLessonFilePicker === "function") openLessonFilePicker(); };
  if (byId("sbTaskBatch")) byId("sbTaskBatch").onclick = () => { if (typeof openTaskBatchReview === "function") openTaskBatchReview(); };
  if (byId("sbNewExam")) byId("sbNewExam").onclick = () => { if (typeof newExamPaper === "function") newExamPaper(); };
  if (byId("sbExamGrade")) byId("sbExamGrade").onclick = () => { if (typeof openExamGrading === "function") openExamGrading(null); };
  byId("sbExamples").onclick = () => openSnippetGallery();
  byId("sbList").addEventListener("keydown", onSidebarKey);   // 사이드바 ↑/↓ 파일 선택 이동, Enter/Space 로 열기
  const sidebarSearch = byId("sbSearch");
  sidebarSearch.addEventListener("input", onSidebarSearchInput);
  // 최근 검색어 드롭다운 — 입력창이 비어 있을 때(또는 ↓ 키) 지난 검색어를 보여주고, 고르면 바로 검색한다.
  // 기록은 Enter 를 눌렀거나 검색창을 떠날 때만 남긴다(타이핑 중간값이 쌓이지 않게).
  // 검색란 안에 담아 그 아래로 띄운다(흐름 안에 넣으면 검색어가 쌓일수록 파일 목록이 아래로 밀린다).
  const sidebarSearchHistory = (typeof MNSearchHistory === "object" && MNSearchHistory)
    ? MNSearchHistory.attach(sidebarSearch, {
        scope: "files",
        className: "sb-search-history",
        mount: sidebarSearch.closest(".sb-search"),
        onPick: () => onSidebarSearchInput()
      })
    : null;
  const rememberSidebarSearch = (minLength) => {
    if (!sidebarSearchHistory) return;
    const q = String(sidebarSearch.value || "").trim();
    if (q.length >= minLength) sidebarSearchHistory.remember(q);
  };
  sidebarSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) rememberSidebarSearch(1);
  });
  sidebarSearch.addEventListener("blur", () => rememberSidebarSearch(2));   // 한 글자 검색은 목록만 어지럽혀 제외
  sidebarSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){
      sidebarSearch.value = "";
      sidebarExtFilter = "";
      contentMatchIds = new Set(); contentMatchSnippets = new Map(); contentMatchQuery = ""; clearTimeout(contentSearchTimer); setContentStatus("");
      contentSearchBusyQuery = "";                       // 예약된 검색을 취소했으니 "검색 중…"도 걷는다
      contentCacheClear();                               // 검색을 닫았다 → 본문·소문자본 사본을 놓아준다
      renderSidebar();
      sidebarSearch.blur();
    }
  });
  // 파일과 폴더는 브라우저에서 선택 방식이 달라, 하나의 열기 버튼 아래 메뉴로 묶는다.
  (() => {
    const open = byId("sbOpen"), menu = byId("sbOpenMenu"), files = byId("sbOpenFiles"), folder = byId("sbOpenFolder");
    const setOpen = (visible) => {
      menu.hidden = !visible;
      open.setAttribute("aria-expanded", String(visible));
      if (visible) files.focus();
    };
    open.addEventListener("click", (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener("click", (e) => e.stopPropagation());
    files.addEventListener("click", () => { setOpen(false); pickFilesOrInput(byId("fileInput")); });
    folder.addEventListener("click", () => { setOpen(false); pickFolderOrInput(byId("folderInput")); });
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden){ setOpen(false); open.focus(); }
    });
  })();
  // 자주 쓰지 않는 작업은 더보기 메뉴에 두어 파일 목록의 세로 공간을 확보한다.
  (() => {
    const more = byId("sbMore"), menu = byId("sbMoreMenu"), refresh = byId("sbRefreshActive"),
      backupExport = byId("sbBackupExport"), backupRestore = byId("sbBackupRestore"),
      backupInput = byId("backupRestoreInput"), clear = byId("sbClearWorkspace");
    const setOpen = (open) => {
      menu.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      if (open) (refresh || clear).focus();
    };
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden){ setOpen(false); more.focus(); }
    });
    if (refresh) refresh.addEventListener("click", () => {
      setOpen(false);
      if (!activeId){ toast("새로고침할 파일을 먼저 선택해 주세요.", 2200); return; }
      refreshDocFromSource(activeId);
    });
    if (backupExport) backupExport.addEventListener("click", () => {
      setOpen(false);
      if (typeof MNBackup !== "undefined") MNBackup.exportBackup();
    });
    if (backupRestore && backupInput){
      backupRestore.addEventListener("click", () => {
        setOpen(false);
        backupInput.value = "";
        backupInput.click();
      });
      backupInput.addEventListener("change", () => {
        const file = backupInput.files && backupInput.files[0];
        if (file && typeof MNBackup !== "undefined") MNBackup.restoreBackup(file);
      });
    }
    clear.addEventListener("click", () => { setOpen(false); clearRememberedWorkspace(); });
  })();
  (() => {                                   // 사이드바 '새로 만들기'(+) 드롭다운
    const btn = byId("sbNew"), menu = byId("sbNewMenu");
    if (!btn || !menu) return;
    const home = menu.parentNode;
    const items = [byId("sbNewPy"), byId("sbNewJs"), byId("sbNewJava"), byId("sbNewNotebook"), byId("sbNewSheet"), byId("sbNewBoard"), byId("sbNewText"), byId("sbNewMnote"), byId("sbNewMap"), byId("sbOpenLesson"), byId("sbTaskBatch")].filter(Boolean);
    const placeMenu = () => {
      const rect = btn.getBoundingClientRect();
      document.body.appendChild(menu);               // 좁은 사이드바의 overflow:hidden에 잘리지 않게 화면 레이어로 이동
      menu.classList.add("sb-menu-viewport");
      menu.hidden = false;
      const pad = 8, gap = 7;
      const width = menu.offsetWidth, height = menu.offsetHeight;
      const left = Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad));
      let top = rect.top - height - gap;
      if (top < pad) top = Math.min(window.innerHeight - height - pad, rect.bottom + gap);
      menu.style.left = left + "px";
      menu.style.top = Math.max(pad, top) + "px";
      menu.style.right = "auto";
      menu.style.bottom = "auto";
    };
    const setOpen = (open) => {
      btn.setAttribute("aria-expanded", String(open));
      if (open){
        placeMenu();
        if (items[0]) items[0].focus();
      } else {
        menu.hidden = true;
        menu.classList.remove("sb-menu-viewport");
        menu.removeAttribute("style");
        home.appendChild(menu);
      }
    };
    btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener("click", (e) => e.stopPropagation());
    items.forEach(it => it.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden){ setOpen(false); btn.focus(); } });
    window.addEventListener("resize", () => { if (!menu.hidden) placeMenu(); });
  })();
  let shortcutDraft = normalizeShortcutMap(appSettings.shortcuts);
  let shortcutCaptureAction = "";
  let musicKeyboardDraft = normalizeMusicKeyboard(appSettings.musicKeyboard);
  let musicKeyboardCaptureAction = "";
  const shortcutError = byId("shortcutSettingsError");
  const musicKeyboardError = byId("musicKeyboardSettingsError");
  const setShortcutError = (message="") => { shortcutError.textContent = message; };
  const setMusicKeyboardError = (message="") => { musicKeyboardError.textContent = message; };
  const renderShortcutSettings = () => {
    const list = byId("shortcutSettingsList");
    const tr = (value) => typeof window.t === "function" ? window.t(value) : value;
    list.textContent = "";
    SHORTCUT_DEFINITIONS.forEach((item) => {
      const row = document.createElement("div"); row.className = "shortcut-setting-row";
      const copy = document.createElement("div"); copy.className = "shortcut-setting-copy";
      const label = document.createElement("strong"); label.textContent = tr(item.label);
      const description = document.createElement("small"); description.textContent = tr(item.description);
      copy.append(label, description);
      const button = document.createElement("button"); button.type = "button"; button.className = "shortcut-capture";
      button.dataset.action = item.id;
      const recording = shortcutCaptureAction === item.id;
      button.classList.toggle("recording", recording);
      button.textContent = recording ? "새 키를 누르세요…" : shortcutDisplay(shortcutDraft[item.id]);
      button.setAttribute("aria-label", item.label + " 단축키 " + (recording ? "입력 중" : shortcutDisplay(shortcutDraft[item.id])));
      button.textContent = recording ? tr("다른 단축키를 누르세요") : shortcutDisplay(shortcutDraft[item.id]);
      button.setAttribute("aria-label", tr(item.label) + " " + tr("단축키") + " " + (recording ? tr("입력 중") : shortcutDisplay(shortcutDraft[item.id])));
      button.addEventListener("click", () => {
        musicKeyboardCaptureAction = "";
        shortcutCaptureAction = item.id;
        setShortcutError("새 단축키를 누르세요. Esc를 누르면 취소됩니다.");
        renderShortcutSettings();
        const next = list.querySelector('[data-action="' + item.id + '"]');
        if (next) next.focus();
      });
      row.append(copy, button); list.appendChild(row);
    });
  };
  const renderMusicKeyboardSettings = () => {
    const list = byId("musicKeyboardSettingsList");
    const tr = (value) => typeof window.t === "function" ? window.t(value) : value;
    list.textContent = "";
    let currentGroup = "";
    MUSIC_KEYBOARD_DEFINITIONS.forEach((item) => {
      if (item.group !== currentGroup){
        currentGroup = item.group;
        const heading = document.createElement("strong");
        heading.className = "music-keyboard-group-title";
        heading.textContent = tr(currentGroup);
        list.appendChild(heading);
      }
      const row = document.createElement("div"); row.className = "shortcut-setting-row";
      const copy = document.createElement("div"); copy.className = "shortcut-setting-copy";
      const label = document.createElement("strong"); label.textContent = tr(item.label);
      const description = document.createElement("small");
      description.textContent = tr(item.description || "자판 작곡에서 사용하는 키");
      copy.append(label, description);
      const button = document.createElement("button"); button.type = "button"; button.className = "shortcut-capture";
      button.dataset.musicKeyboardAction = item.id;
      const recording = musicKeyboardCaptureAction === item.id;
      button.classList.toggle("recording", recording);
      button.textContent = recording ? "새 키를 누르세요…" : musicKeyboardCodeLabel(musicKeyboardDraft[item.id]);
      button.setAttribute("aria-label", `${tr(item.label)} ${tr("자판")} ${recording ? tr("입력 중") : button.textContent}`);
      button.addEventListener("click", () => {
        shortcutCaptureAction = "";
        musicKeyboardCaptureAction = item.id;
        setShortcutError("");
        setMusicKeyboardError("원하는 키 하나를 누르세요. Esc를 누르면 취소됩니다.");
        renderMusicKeyboardSettings();
        const next = list.querySelector('[data-music-keyboard-action="' + item.id + '"]');
        if (next) next.focus();
      });
      row.append(copy, button); list.appendChild(row);
    });
  };
  window.addEventListener("mni18nchange", () => {
    if (!byId("settingsModal").hidden){ renderShortcutSettings(); renderMusicKeyboardSettings(); }
  });
  window.addEventListener("keydown", (e) => {
    if (!shortcutCaptureAction || byId("settingsModal").hidden) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === "Escape"){
      shortcutCaptureAction = "";
      setShortcutError("");
      renderShortcutSettings();
      return;
    }
    const value = shortcutFromEventLike(e);
    if (!value) return;
    const invalid = validateShortcutChoice(value);
    if (invalid){ setShortcutError(invalid); return; }
    const duplicate = SHORTCUT_DEFINITIONS.find((item) =>
      item.id !== shortcutCaptureAction && normalizeShortcut(shortcutDraft[item.id]) === value);
    if (duplicate){
      setShortcutError("'" + duplicate.label + "'에서 이미 사용하는 단축키예요.");
      return;
    }
    shortcutDraft[shortcutCaptureAction] = value;
    shortcutCaptureAction = "";
    setShortcutError("");
    renderShortcutSettings();
  }, true);
  window.addEventListener("keydown", (e) => {
    if (!musicKeyboardCaptureAction || byId("settingsModal").hidden) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === "Escape"){
      musicKeyboardCaptureAction = "";
      setMusicKeyboardError("");
      renderMusicKeyboardSettings();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || !musicKeyboardCodeAllowed(e.code)){
      setMusicKeyboardError("문자·숫자·기호 키 하나를 눌러 주세요. 이동·삭제·기능 키는 사용할 수 없어요.");
      return;
    }
    const duplicate = MUSIC_KEYBOARD_DEFINITIONS.find((item) =>
      item.id !== musicKeyboardCaptureAction && musicKeyboardDraft[item.id] === e.code);
    if (duplicate){
      setMusicKeyboardError(`'${duplicate.label}'에서 이미 사용하는 키예요.`);
      return;
    }
    musicKeyboardDraft[musicKeyboardCaptureAction] = e.code;
    musicKeyboardCaptureAction = "";
    setMusicKeyboardError("");
    renderMusicKeyboardSettings();
  }, true);
  byId("settingsResetShortcuts").onclick = () => {
    shortcutCaptureAction = "";
    shortcutDraft = normalizeShortcutMap(DEFAULT_SHORTCUTS);
    setShortcutError("기본 단축키로 되돌렸습니다. 저장을 눌러 적용하세요.");
    renderShortcutSettings();
  };
  byId("settingsResetMusicKeyboard").onclick = () => {
    musicKeyboardCaptureAction = "";
    musicKeyboardDraft = normalizeMusicKeyboard(MUSIC_KEYBOARD_DEFAULTS);
    setMusicKeyboardError("기본 악보 자판으로 되돌렸습니다. 저장을 눌러 적용하세요.");
    renderMusicKeyboardSettings();
  };
  const saveFolderOpen = byId("saveFolderOpen");
  const imageMemoOpen = byId("imageMemoOpen");
  const headerMoreWrap = byId("headerMoreWrap");
  const headerMore = byId("headerMore");
  const headerMoreMenu = byId("headerMoreMenu");
  const settingSaveFolderWrap = byId("settingSaveFolderWrap");
  const settingSaveFolderPath = byId("settingSaveFolderPath");
  const settingSaveFolderOpen = byId("settingSaveFolderOpen");
  const settingSaveFolderChange = byId("settingSaveFolderChange");
  let currentSaveFolderPath = "";
  const syncHeaderMoreAvailability = () => {
    const vis = (appSettings && appSettings.toolVisibility) || {};
    const saveVisible = !!(saveFolderOpen && !saveFolderOpen.hidden && vis.hdrSaveFolder !== false);
    const imageVisible = !!(imageMemoOpen && vis.hdrImageMemo !== false);
    const available = saveVisible || imageVisible;
    if (headerMoreWrap) headerMoreWrap.hidden = !available;
    if (!available && headerMoreMenu && headerMore){
      headerMoreMenu.hidden = true;
      headerMore.setAttribute("aria-expanded", "false");
    }
  };
  const setSaveFolderPath = (path, status="ready") => {
    currentSaveFolderPath = String(path || "").trim();
    const available = !!currentSaveFolderPath;
    saveFolderOpen.hidden = !available;
    syncHeaderMoreAvailability();
    // 설정 항목 자체는 항상 표시한다. 경로 API를 쓸 수 없는 일반 HTML에서도 항목이
    // 사라진 것처럼 보이지 않게 하고, EXE에서만 변경할 수 있음을 명확히 안내한다.
    settingSaveFolderWrap.hidden = false;
    settingSaveFolderPath.textContent = available
      ? currentSaveFolderPath
      : (status === "loading"
          ? (typeof window.t === "function" ? window.t("저장 위치 확인 중…") : "저장 위치 확인 중…")
          : (typeof window.t === "function" ? window.t("EXE에서만 설정할 수 있습니다.") : "EXE에서만 설정할 수 있습니다."));
    settingSaveFolderPath.title = available ? currentSaveFolderPath : settingSaveFolderPath.textContent;
    settingSaveFolderOpen.disabled = !available;
    settingSaveFolderChange.disabled = !available;
    saveFolderOpen.title = "직전에 저장한 파일이 있는 폴더 열기" + (available ? " · 저장 루트: " + currentSaveFolderPath : "");
  };
  const saveFolderRequest = async (path, method="GET") => {
    const response = await fetch(path, {
      method,
      headers: { "X-ClassDock-Action":"1" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return (await response.text()).trim();
  };
  const refreshSaveFolder = async () => {
    setSaveFolderPath("", "loading");
    if (location.protocol !== "http:" && location.protocol !== "https:"){
      setSaveFolderPath("", "unavailable");
      return false;
    }
    try {
      const path = await saveFolderRequest("/save-root");
      setSaveFolderPath(path);
      return !!path;
    } catch(_){
      setSaveFolderPath("", "unavailable");
      return false;
    }
  };
  const openSaveFolder = async () => {
    try {
      const path = await saveFolderRequest("/open-save-folder", "POST");
      if (path) setSaveFolderPath(path);
    } catch(e){ toast("저장 폴더를 열지 못했어요.", 2200); }
  };
  const chooseSaveFolder = async () => {
    const originalLabel = settingSaveFolderChange.textContent;
    settingSaveFolderChange.disabled = true;
    settingSaveFolderChange.textContent = "선택창 확인…";
    toast("Windows 폴더 선택창을 열고 있어요.", 1800);
    try {
      await saveFolderRequest("/choose-save-folder", "POST");
      let result = null;
      for (let attempt = 0; attempt < 1200; attempt++){
        await new Promise(resolve => setTimeout(resolve, 250));
        const response = await fetch("/choose-save-folder-status", {
          method:"GET",
          headers:{ "X-ClassDock-Action":"1" },
          cache:"no-store"
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const status = await response.json();
        if (status && status.state !== "opening"){
          result = status;
          break;
        }
      }
      if (!result) throw new Error("folder-picker-timeout");
      if (result.state === "cancelled") return;
      if (result.state === "error") throw new Error(result.result || "folder-picker-error");
      if (result.state !== "saved" || !result.result) return;
      setSaveFolderPath(result.result);
      toast("자동 저장 위치를 변경했어요. 기존 파일은 이전 폴더에 그대로 있습니다.", 3400);
    } catch(e){ toast("저장 폴더를 변경하지 못했어요.", 2400); }
    finally {
      settingSaveFolderChange.disabled = false;
      settingSaveFolderChange.textContent = originalLabel;
    }
  };
  // 헤더 '저장 폴더' = 직전에 저장한 파일이 있는 폴더를 연다(아직 저장 전이면 저장 루트로 폴백).
  // 설정 '현재 폴더 보기' = 예전처럼 설정된 저장 루트를 연다.
  const openLastSavedFileFolder = async () => {
    const rel = (typeof window !== "undefined" && window.__mnLastSaveRel) ? String(window.__mnLastSaveRel) : "";
    if (!rel){ openSaveFolder(); return; }
    try {
      const res = await fetch("/open-file-folder", {
        method: "POST",
        headers: { "X-ClassDock-Action": "1", "X-Save-Path": encodeURIComponent(rel) },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
    } catch(e){ toast("저장한 파일 폴더를 열지 못했어요.", 2200); }
  };
  // 앱 모드(탭·주소창 없는 --app 창)는 브라우저가 뜨기 전에 런처가 정하므로 값이 EXE 쪽에 있다.
  // 체크박스는 '저장'을 눌러야 다음 실행부터 반영되고, 버튼은 지금 그 창을 하나 더 띄운다.
  let appModeSaved = null;   // 런처가 알려준 현재 값. null 이면 EXE가 아니거나 확인 실패.
  let appModeUsable = false;
  const APP_MODE_HINT = "화면을 넓게 쓰도록 브라우저 탭과 주소창 없이 엽니다.";
  const APP_MODE_UNAVAILABLE_HINT = "크롬 또는 엣지가 있어야 쓸 수 있어요.";
  const settingAppModeWrap = byId("settingAppModeWrap");
  const settingAppModeHint = byId("settingAppModeHint");
  const settingAppMode = byId("settingAppMode");
  const settingAppModeNow = byId("settingAppModeNow");
  const renderAppModeHint = () => {
    const text = appModeUsable ? APP_MODE_HINT : APP_MODE_UNAVAILABLE_HINT;
    settingAppModeHint.textContent = typeof window.t === "function" ? window.t(text) : text;
  };
  const refreshAppMode = async () => {
    appModeSaved = null;
    appModeUsable = false;
    settingAppModeWrap.hidden = true;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    try {
      const response = await fetch("/launcher-config", { headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const config = await response.json();
      appModeSaved = !!config.appMode;
      settingAppMode.checked = appModeSaved;
      // 미지원 상태에서는 새로 켜는 것은 막되, 이미 켜진 설정을 끄는 동작은 허용한다.
      appModeUsable = config.appModeAvailable !== false;
      settingAppMode.disabled = !appModeUsable && !appModeSaved;
      settingAppModeNow.disabled = !appModeUsable;
      renderAppModeHint();
      settingAppModeWrap.hidden = false;
    } catch(_){ /* 일반 HTML·앱 모드를 모르는 구버전 EXE → 항목을 감춘다 */ }
  };
  const saveAppMode = async () => {
    if (appModeSaved === null) return;
    const next = !!settingAppMode.checked;
    if (next === appModeSaved) return;
    try {
      const response = await fetch("/launcher-config?appMode=" + (next ? "1" : "0"), {
        method:"POST", headers:{ "X-ClassDock-Action":"1" }, cache:"no-store"
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      appModeSaved = next;
      settingAppMode.disabled = !appModeUsable && !appModeSaved;
      toast(next ? "다음 실행부터 앱 모드로 열립니다." : "다음 실행부터 보통 브라우저 창으로 열립니다.", 2800);
    } catch(_){ toast("앱 모드 설정을 저장하지 못했어요.", 2400); }
  };
  const reopenInAppMode = async () => {
    settingAppModeNow.disabled = true;
    try {
      const response = await fetch("/reopen-app-mode", { method:"POST", headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      toast("앱 모드 창을 열었어요. 같은 작업 화면이니 이 탭은 닫으셔도 됩니다.", 3800);
    } catch(_){ toast("앱 모드 창을 열지 못했어요.", 2400); }
    finally { settingAppModeNow.disabled = false; }
  };
  saveFolderOpen.onclick = openLastSavedFileFolder;
  // 저장 완료 토스트의 '폴더 열기' 버튼이 같은 동작을 쓸 수 있게 노출(EXE 로컬 서버에서만 목록에 뜸)
  try { window.__mnOpenLastSavedFolder = openLastSavedFileFolder; } catch(_){}
  settingSaveFolderOpen.onclick = openSaveFolder;
  settingSaveFolderChange.onclick = chooseSaveFolder;
  settingAppModeNow.onclick = reopenInAppMode;
  window.addEventListener("mni18nchange", renderAppModeHint);
  refreshSaveFolder();
  const syncPetFocusSettingFields = () => {
    const enabled = !!byId("settingPetFocus").checked;
    byId("settingPetFocusMin").disabled = !enabled;
    byId("settingPetBreakMin").disabled = !enabled;
    byId("settingPetQuietTyping").disabled = !enabled;
  };
  byId("settingPetFocus").addEventListener("change", syncPetFocusSettingFields);
  const syncJavaAutoCheckSetting = () => {
    byId("settingJavaCheckOnAutoSave").disabled = !byId("settingAutoSave").checked;
  };
  byId("settingAutoSave").addEventListener("change", syncJavaAutoCheckSetting);
  const mapSearchProviderInput = byId("settingMapSearchProvider");
  const mapSearchKeyWrap = byId("settingMapSearchKeyWrap");
  const mapSearchKeyInput = byId("settingMapSearchKey");
  const mapSearchRemember = byId("settingMapSearchRemember");
  const mapSearchRememberWrap = byId("settingMapSearchRememberWrap");
  const mapSearchStatus = byId("settingMapSearchStatus");
  const mapSearchTest = byId("settingMapSearchTest");
  const mapSearchClear = byId("settingMapSearchClear");
  let mapSearchKeyStatus = { available:false, hasKey:false, remembered:false, persistentSupported:false };
  // 지도 화면은 설정 창과 떨어져 있으므로 키 상태를 복사해 두고 변경 이벤트로 알려 준다.
  // 실제 키 문자열은 런처에만 남고, 브라우저에는 보유 여부만 전달한다.
  const publishMapSearchKeyStatus = () => {
    const detail = { ...mapSearchKeyStatus };
    window.__classDockMapSearchKeyStatus = detail;
    window.dispatchEvent(new CustomEvent("classdock-map-search-status-change", { detail }));
  };
  publishMapSearchKeyStatus();
  const setMapSearchStatus = (text, kind) => {
    mapSearchStatus.textContent = typeof window.t === "function" ? window.t(text) : text;
    mapSearchStatus.classList.toggle("ok", kind === "ok");
    mapSearchStatus.classList.toggle("bad", kind === "bad");
  };
  const syncMapSearchFields = () => {
    const kakao = mapSearchProviderInput.value === "kakao";
    mapSearchKeyWrap.hidden = !kakao;
    if (!kakao) return;
    const available = mapSearchKeyStatus.available;
    mapSearchKeyInput.disabled = !available;
    mapSearchTest.disabled = !available;
    mapSearchClear.disabled = !available || !mapSearchKeyStatus.hasKey;
    mapSearchRemember.disabled = !available || !mapSearchKeyStatus.persistentSupported;
    mapSearchRememberWrap.hidden = !mapSearchKeyStatus.persistentSupported;
    mapSearchRemember.checked = !!mapSearchKeyStatus.remembered;
    mapSearchKeyInput.placeholder = mapSearchKeyStatus.hasKey ? "저장된 키가 있습니다 — 바꿀 때만 입력" : "REST API 키 입력";
  };
  const refreshMapSearchKeyStatus = async (message, kind) => {
    mapSearchKeyStatus = { available:false, hasKey:false, remembered:false, persistentSupported:false };
    publishMapSearchKeyStatus();
    try {
      const response = await fetch("/map-search-key-status", { headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const status = await response.json();
      mapSearchKeyStatus = { available:true, hasKey:!!status.hasKey, remembered:!!status.remembered,
        persistentSupported:status.persistentSupported !== false };
      // 앱 모드가 일반 웹 창과 다른 Chromium 프로필로 열려도 런처에 저장한 공급자를 이어 쓴다.
      if (status.provider === "kakao" || status.provider === "osm"){
        mapSearchProviderInput.value = status.provider;
        if (appSettings.mapSearchProvider !== status.provider) saveAppSettings({ mapSearchProvider:status.provider });
      }
      publishMapSearchKeyStatus();
      if (message) setMapSearchStatus(message, kind);
      else if (mapSearchKeyStatus.hasKey) setMapSearchStatus(mapSearchKeyStatus.remembered
        ? "카카오 키가 이 Windows 사용자 계정에 암호화되어 있습니다."
        : "카카오 키를 이번 실행 동안 기억하고 있습니다.", "ok");
      else setMapSearchStatus("카카오 REST API 키가 아직 없습니다.", "");
    } catch(_){ setMapSearchStatus("카카오 키 설정은 ClassDock.exe에서 사용할 수 있습니다.", "bad"); }
    syncMapSearchFields();
  };
  const saveMapSearchProviderToLauncher = async (provider) => {
    try {
      const value = provider === "kakao" ? "kakao" : "osm";
      const response = await fetch("/map-search-provider?value=" + value, {
        method:"POST", headers:{ "X-ClassDock-Action":"1" }, cache:"no-store"
      });
      if (response.ok) publishMapSearchKeyStatus();
    } catch(_){}
  };
  mapSearchProviderInput.addEventListener("change", syncMapSearchFields);
  mapSearchTest.addEventListener("click", async () => {
    const key = mapSearchKeyInput.value.trim();
    if (!key){ setMapSearchStatus("저장할 카카오 REST API 키를 입력해 주세요.", "bad"); mapSearchKeyInput.focus(); return; }
    mapSearchTest.disabled = true; mapSearchClear.disabled = true;
    setMapSearchStatus("카카오 연결을 시험하는 중…", "");
    try {
      const response = await fetch("/map-search-key?remember=" + (mapSearchRemember.checked ? "1" : "0"), {
        method:"POST", headers:{ "X-ClassDock-Action":"1", "Content-Type":"text/plain;charset=utf-8" },
        body:key, cache:"no-store"
      });
      if (!response.ok) throw new Error((await response.text()) || "HTTP " + response.status);
      mapSearchKeyInput.value = "";
      // '키 저장·연결 시험'은 런처에 즉시 반영되는 동작이다. 공급자만 아래 설정 저장을 한 번 더
      // 눌러야 바뀌면 연결 성공 직후 지도에서는 여전히 OSM을 써 혼란스럽다 — 성공한 순간부터
      // 카카오를 현재 공급자로 저장한다.
      mapSearchProviderInput.value = "kakao";
      saveAppSettings({ mapSearchProvider:"kakao" });
      await refreshMapSearchKeyStatus("카카오 연결에 성공했고 키를 저장했습니다.", "ok");
    } catch(error){
      setMapSearchStatus(error && error.message === "kakao-key-save-failed"
        ? "키 연결에는 성공했지만 암호화 저장에 실패했습니다."
        : "카카오 키를 확인하지 못했습니다. REST API 키인지 확인해 주세요.", "bad");
      syncMapSearchFields();
    }
  });
  mapSearchClear.addEventListener("click", async () => {
    mapSearchClear.disabled = true;
    try {
      const response = await fetch("/map-search-key", { method:"DELETE", headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      mapSearchKeyInput.value = "";
      await refreshMapSearchKeyStatus("카카오 키를 지웠습니다.", "ok");
    } catch(_){ setMapSearchStatus("카카오 키를 지우지 못했습니다.", "bad"); syncMapSearchFields(); }
  });
  // 지도 검색 전에 앱 모드/일반 창이 같은 런처 공급자 설정을 보도록 시작과 함께 동기화한다.
  window.__classDockMapSearchProviderReady = refreshMapSearchKeyStatus();

  /* ── 환율(수출입은행 인증키) ──
     지도 검색 키와 같은 규칙이다 — 키 문자열은 런처에만 남고 브라우저에는 보유 여부만 전달한다.
     환율 창은 설정 창과 떨어져 있으므로 상태를 복사해 두고 변경 이벤트로 알려 준다. */
  const exchangeRateKeyInput = byId("settingExchangeRateKey");
  const exchangeRateRemember = byId("settingExchangeRateRemember");
  const exchangeRateRememberWrap = byId("settingExchangeRateRememberWrap");
  const exchangeRateStatusText = byId("settingExchangeRateStatus");
  const exchangeRateTest = byId("settingExchangeRateTest");
  const exchangeRateClear = byId("settingExchangeRateClear");
  let exchangeRateKeyStatus = { available:false, hasKey:false, remembered:false, persistentSupported:false };
  const publishExchangeRateKeyStatus = () => {
    const detail = { ...exchangeRateKeyStatus };
    window.__classDockExchangeRateKeyStatus = detail;
    window.dispatchEvent(new CustomEvent("classdock-exchange-rate-status-change", { detail }));
  };
  publishExchangeRateKeyStatus();
  const setExchangeRateStatus = (text, kind) => {
    exchangeRateStatusText.textContent = typeof window.t === "function" ? window.t(text) : text;
    exchangeRateStatusText.classList.toggle("ok", kind === "ok");
    exchangeRateStatusText.classList.toggle("bad", kind === "bad");
  };
  const syncExchangeRateFields = () => {
    const available = exchangeRateKeyStatus.available;
    exchangeRateKeyInput.disabled = !available;
    exchangeRateTest.disabled = !available;
    exchangeRateClear.disabled = !available || !exchangeRateKeyStatus.hasKey;
    exchangeRateRemember.disabled = !available || !exchangeRateKeyStatus.persistentSupported;
    exchangeRateRememberWrap.hidden = !exchangeRateKeyStatus.persistentSupported;
    exchangeRateRemember.checked = !!exchangeRateKeyStatus.remembered;
    exchangeRateKeyInput.placeholder = exchangeRateKeyStatus.hasKey ? "저장된 키가 있습니다 — 바꿀 때만 입력" : "인증키 입력";
  };
  const refreshExchangeRateKeyStatus = async (message, kind) => {
    exchangeRateKeyStatus = { available:false, hasKey:false, remembered:false, persistentSupported:false };
    publishExchangeRateKeyStatus();
    try {
      const response = await fetch("/exchange-rate-key-status", { headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const status = await response.json();
      exchangeRateKeyStatus = { available:true, hasKey:!!status.hasKey, remembered:!!status.remembered,
        persistentSupported:status.persistentSupported !== false };
      publishExchangeRateKeyStatus();
      if (message) setExchangeRateStatus(message, kind);
      else if (exchangeRateKeyStatus.hasKey) setExchangeRateStatus(exchangeRateKeyStatus.remembered
        ? "수출입은행 인증키가 이 Windows 사용자 계정에 암호화되어 있습니다."
        : "수출입은행 인증키를 이번 실행 동안 기억하고 있습니다.", "ok");
      else setExchangeRateStatus("인증키가 없어 ECB 참고환율만 볼 수 있습니다.", "");
    } catch(_){ setExchangeRateStatus("환율 키 설정은 ClassDock.exe에서 사용할 수 있습니다.", "bad"); }
    syncExchangeRateFields();
  };
  exchangeRateTest.addEventListener("click", async () => {
    const key = exchangeRateKeyInput.value.trim();
    if (!key){ setExchangeRateStatus("저장할 수출입은행 인증키를 입력해 주세요.", "bad"); exchangeRateKeyInput.focus(); return; }
    exchangeRateTest.disabled = true; exchangeRateClear.disabled = true;
    setExchangeRateStatus("수출입은행 연결을 시험하는 중…", "");
    try {
      const response = await fetch("/exchange-rate-key?remember=" + (exchangeRateRemember.checked ? "1" : "0"), {
        method:"POST", headers:{ "X-ClassDock-Action":"1", "Content-Type":"text/plain;charset=utf-8" },
        body:key, cache:"no-store"
      });
      if (!response.ok) throw new Error((await response.text()) || "HTTP " + response.status);
      exchangeRateKeyInput.value = "";
      await refreshExchangeRateKeyStatus("수출입은행 연결에 성공했고 키를 저장했습니다.", "ok");
    } catch(error){
      const reason = error && error.message;
      // 한도 초과는 키가 멀쩡한데도 실패하는 경우라 "키가 틀렸다"고 말하면 엉뚱한 곳을 고치게 된다.
      setExchangeRateStatus(reason === "rate-limit-reached"
        ? "오늘 조회 한도(1,000회)를 다 써서 확인하지 못했습니다. 내일 다시 시도해 주세요."
        : reason === "rate-key-save-failed"
          ? "키 연결에는 성공했지만 암호화 저장에 실패했습니다."
          : "인증키를 확인하지 못했습니다. 수출입은행에서 발급받은 인증키인지 확인해 주세요.", "bad");
      syncExchangeRateFields();
    }
  });
  exchangeRateClear.addEventListener("click", async () => {
    exchangeRateClear.disabled = true;
    try {
      const response = await fetch("/exchange-rate-key", { method:"DELETE", headers:{ "X-ClassDock-Action":"1" }, cache:"no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      exchangeRateKeyInput.value = "";
      await refreshExchangeRateKeyStatus("수출입은행 인증키를 지웠습니다.", "ok");
    } catch(_){ setExchangeRateStatus("인증키를 지우지 못했습니다.", "bad"); syncExchangeRateFields(); }
  });
  // 환율 창은 이 상태값을 보고 기본 출처를 고른다 — 창을 열기 전에 한 번 받아 둔다.
  window.__classDockExchangeRateKeyReady = refreshExchangeRateKeyStatus();
  const setSettingsTab = (name) => {
    document.querySelectorAll("#settingsTabs .settings-tab").forEach((tab) => {
      const on = tab.dataset.settingsTab === name;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("#settingsModal .settings-section").forEach((sec) => {
      sec.hidden = sec.dataset.settingsPanel !== name;
      if (!sec.hidden) sec.scrollTop = 0;     // 긴 탭에서 스크롤한 뒤 넘어와도 항상 맨 위부터
    });
  };
  const LIGHT_BACKGROUND_VALUES = new Set(["cool", "warm", "mint", "lavender", "sky"]);
  let lightBackgroundDraft = "cool";
  const normalizeLightBackground = (value) => LIGHT_BACKGROUND_VALUES.has(value) ? value : "cool";
  const currentLightBackground = () => normalizeLightBackground(document.documentElement.getAttribute("data-light-background"));
  const lightBackgroundButtons = [...document.querySelectorAll(".light-background-choice[data-light-background]")];
  const syncLightBackgroundButtons = () => lightBackgroundButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lightBackground === lightBackgroundDraft));
  });
  const applyLightBackground = (value) => {
    const next = normalizeLightBackground(value);
    document.documentElement.setAttribute("data-light-background", next);
    try { localStorage.setItem("lightBackground", next); } catch(_){}
  };
  lightBackgroundButtons.forEach((button) => button.addEventListener("click", () => {
    lightBackgroundDraft = normalizeLightBackground(button.dataset.lightBackground);
    syncLightBackgroundButtons();
  }));
  // 새 화이트보드의 기본 배경색. 프리셋 목록(BOARD_BG_PRESETS) 하나로 버튼을 만들어 팔레트를
  // 설정 화면과 보드 도구막대에 이중으로 적어 두지 않는다.
  let boardBgDraft = BOARD_BG_DEFAULT;
  let boardBgCustom = null, boardPatternSelect = null, boardPatternDraft = null;
  const boardBgHost = byId("settingBoardBg");
  const syncBoardBgChoices = () => {
    if (!boardBgHost) return;
    boardBgHost.querySelectorAll(".board-bg-choice").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.boardBg === boardBgDraft));
    });
    if (boardBgCustom && boardBgCustom.value !== boardBgDraft) boardBgCustom.value = boardBgDraft;
    if (boardPatternSelect) boardPatternSelect.value = boardPatternDraft ? boardPatternDraft.id : BOARD_PATTERN_NONE;
  };
  const buildBoardBgChoices = () => {
    if (!boardBgHost || boardBgHost.childElementCount) return;
    for (const preset of BOARD_BG_PRESETS){
      const button = document.createElement("button");
      button.type = "button"; button.className = "board-bg-choice";
      button.dataset.boardBg = preset.color; button.style.background = preset.color;
      // 이름은 한국어로 넣고 번역은 i18n 바인딩에 맡긴다 — 언어를 바꿔도 다시 그릴 필요가 없다.
      button.title = preset.label; button.setAttribute("aria-label", preset.label);
      button.addEventListener("click", () => { boardBgDraft = preset.color; syncBoardBgChoices(); });
      boardBgHost.appendChild(button);
    }
    boardBgCustom = document.createElement("input");
    boardBgCustom.type = "color"; boardBgCustom.className = "wb-color-input board-bg-custom";
    boardBgCustom.title = "배경색 직접 고르기"; boardBgCustom.setAttribute("aria-label", "배경색 직접 고르기");
    boardBgCustom.addEventListener("input", () => { boardBgDraft = normalizeBoardBg(boardBgCustom.value); syncBoardBgChoices(); });
    boardBgHost.appendChild(boardBgCustom);
    // 무늬(모눈·오선 등)는 색과 달리 종류가 많아 목록으로 고른다. 간격·진하기 같은 세부는 보드마다
    // 다르게 쓰는 값이라 설정에 두지 않고 보드 도구막대의 배경 판에서만 조절한다.
    boardPatternSelect = document.createElement("select");
    boardPatternSelect.className = "board-pattern-select";
    boardPatternSelect.title = "새 보드 기본 무늬"; boardPatternSelect.setAttribute("aria-label", "새 보드 기본 무늬");
    for (const preset of BOARD_PATTERNS){
      const option = document.createElement("option");
      option.value = preset.id; option.textContent = preset.label;
      boardPatternSelect.appendChild(option);
    }
    boardPatternSelect.addEventListener("change", () => {
      boardPatternDraft = normalizeBoardPattern({ id:boardPatternSelect.value });
      syncBoardBgChoices();
    });
    boardBgHost.appendChild(boardPatternSelect);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(boardBgHost);
  };
  document.querySelectorAll("#settingsTabs .settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => setSettingsTab(tab.dataset.settingsTab));
  });
  (() => {                                   // 헤더 '더보기' 드롭다운(저장 폴더·이미지 메모)
    const btn = headerMore, menu = headerMoreMenu;
    if (!btn || !menu) return;
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener("click", (e) => e.stopPropagation());
    [byId("saveFolderOpen"), byId("imageMemoOpen")].forEach(it => it && it.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden){ setOpen(false); btn.focus(); } });
    // 열린 채로 숨겨지면 다시 노출했을 때 펼쳐진 상태로 나타난다 — 숨김 즉시 닫아 둔다.
    document.addEventListener("mn-tool-visibility", () => {
      syncHeaderMoreAvailability();
    });
    syncHeaderMoreAvailability();
  })();
  // 헤더 PDF 메뉴(편집·페이지)도 마찬가지로 숨김과 동시에 접는다.
  document.addEventListener("mn-tool-visibility", (ev) => {
    const vis = (ev && ev.detail) || {};
    for (const [id, sel] of [["hdrPdfEdit", ".hdr-tool-pdfedit"], ["hdrPdfPage", ".hdr-tool-pdfpage"]]){
      if (vis[id] !== false) continue;
      document.querySelectorAll("header details" + sel + "[open]").forEach((d) => { d.open = false; });
    }
  });
  // '도구' 탭 — 화면별 하위 탭에서 비노출/노출 목록 사이로 옮긴다. 저장 형식은 예전 체크박스와
  // 같은 { 도구id:boolean } 이라 기존 설정·실제 툴바 숨김 CSS 는 그대로 이어 쓴다.
  const TOOL_VISIBILITY_TARGETS = Object.freeze([
    { id:"header", fixed:"설정 · 저장 · 집중 모드 · 분할 작업" },
    { id:"py", fixed:"실행 · 저장" },
    { id:"javascript", fixed:"실행 · 저장 · 원본 되돌리기" },
    { id:"java", fixed:"실행 · 저장" },
    { id:"notebook", fixed:"실행 · 저장" },
    { id:"image", fixed:"저장" },
    { id:"whiteboard", fixed:"되돌리기 · 다시 실행 · 도구막대 다시 보이기" },
    { id:"map", fixed:"제목 · 도구 보이기 · 되돌리기 · 다시 실행 · 저장" },
    { id:"music", fixed:"제목 · 도구 보이기 · 되돌리기 · 다시 실행 · 저장" }
  ]);
  let toolTransferBuilt = false;
  let activeToolTarget = "header";
  let toolVisibilityDraft = null;
  const toolsForTarget = (target) => typeof TOGGLEABLE_TOOLS === "undefined"
    ? [] : TOGGLEABLE_TOOLS.filter((tool) => tool.target === target);
  const syncToolTransferActions = () => {
    const hidden = byId("settingToolsHidden"), visible = byId("settingToolsVisible");
    const show = byId("settingToolsShow"), hide = byId("settingToolsHide");
    if (show) show.disabled = !hidden || hidden.selectedOptions.length === 0;
    if (hide) hide.disabled = !visible || visible.selectedOptions.length === 0;
  };
  const fillToolList = (select, tools, selectedIds) => {
    if (!select) return;
    select.replaceChildren();
    for (const tool of tools){
      const option = document.createElement("option");
      option.value = tool.id; option.textContent = tool.label; option.title = tool.label;
      option.selected = selectedIds.has(tool.id);
      select.appendChild(option);
    }
  };
  const renderToolVisibilityTransfer = (selectedIds=new Set(), focusSide="") => {
    if (!toolVisibilityDraft || typeof TOGGLEABLE_TOOLS === "undefined") return;
    const all = toolsForTarget(activeToolTarget);
    const hiddenTools = all.filter((tool) => toolVisibilityDraft[tool.id] === false);
    const visibleTools = all.filter((tool) => toolVisibilityDraft[tool.id] !== false);
    const hidden = byId("settingToolsHidden"), visible = byId("settingToolsVisible");
    fillToolList(hidden, hiddenTools, selectedIds);
    fillToolList(visible, visibleTools, selectedIds);
    const hiddenCount = byId("settingToolsHiddenCount"), visibleCount = byId("settingToolsVisibleCount");
    if (hiddenCount) hiddenCount.textContent = hiddenTools.length + "개";
    if (visibleCount) visibleCount.textContent = visibleTools.length + "개";
    document.querySelectorAll("#settingToolScopeTabs .settings-tool-scope-tab").forEach((tab) => {
      const target = tab.dataset.toolTarget;
      const on = target === activeToolTarget;
      const targetTools = toolsForTarget(target);
      const shown = targetTools.filter((tool) => toolVisibilityDraft[tool.id] !== false).length;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      const count = tab.querySelector(".settings-tool-scope-count");
      if (count) count.textContent = shown + "/" + targetTools.length;
    });
    const fixed = TOOL_VISIBILITY_TARGETS.find((item) => item.id === activeToolTarget);
    if (byId("settingToolsFixed")) byId("settingToolsFixed").textContent = fixed ? fixed.fixed : "필수 버튼";
    const activeTab = document.querySelector('#settingToolScopeTabs [data-tool-target="' + activeToolTarget + '"]');
    if (byId("settingToolTransfer") && activeTab) byId("settingToolTransfer").setAttribute("aria-labelledby", activeTab.id);
    syncToolTransferActions();
    const focusList = focusSide === "visible" ? visible : focusSide === "hidden" ? hidden : null;
    if (focusList) focusList.focus();
  };
  const setToolVisibilityTarget = (target, focusTab=false) => {
    if (!TOOL_VISIBILITY_TARGETS.some((item) => item.id === target)) return;
    activeToolTarget = target;
    renderToolVisibilityTransfer();
    if (focusTab){
      const tab = document.querySelector('#settingToolScopeTabs [data-tool-target="' + target + '"]');
      if (tab) tab.focus();
    }
  };
  const moveSelectedTools = (makeVisible) => {
    const source = byId(makeVisible ? "settingToolsHidden" : "settingToolsVisible");
    if (!source || !toolVisibilityDraft) return;
    const ids = new Set([...source.selectedOptions].map((option) => option.value));
    if (!ids.size) return;
    for (const id of ids) toolVisibilityDraft[id] = !!makeVisible;
    renderToolVisibilityTransfer(ids, makeVisible ? "visible" : "hidden");
  };
  const buildToolVisibilityTransfer = () => {
    if (toolTransferBuilt || typeof TOGGLEABLE_TOOLS === "undefined") return;
    const tabs = [...document.querySelectorAll("#settingToolScopeTabs .settings-tool-scope-tab")];
    const hidden = byId("settingToolsHidden"), visible = byId("settingToolsVisible");
    if (!tabs.length || !hidden || !visible || !byId("settingToolsShow") || !byId("settingToolsHide")) return;
    tabs.forEach((tab, index) => {
      tab.id = "settingToolScope-" + tab.dataset.toolTarget;
      tab.setAttribute("aria-controls", "settingToolTransfer");
      tab.addEventListener("click", () => setToolVisibilityTarget(tab.dataset.toolTarget));
      tab.addEventListener("keydown", (e) => {
        let next = -1;
        if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault(); setToolVisibilityTarget(tabs[next].dataset.toolTarget, true);
      });
    });
    hidden.addEventListener("change", syncToolTransferActions);
    visible.addEventListener("change", syncToolTransferActions);
    hidden.addEventListener("dblclick", () => moveSelectedTools(true));
    visible.addEventListener("dblclick", () => moveSelectedTools(false));
    hidden.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); moveSelectedTools(true); } });
    visible.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); moveSelectedTools(false); } });
    byId("settingToolsShow").addEventListener("click", () => moveSelectedTools(true));
    byId("settingToolsHide").addEventListener("click", () => moveSelectedTools(false));
    toolTransferBuilt = true;
  };
  const syncToolVisibilityTransfer = () => {
    buildToolVisibilityTransfer();
    if (typeof TOGGLEABLE_TOOLS === "undefined") return;
    const vis = appSettings.toolVisibility || {};
    toolVisibilityDraft = {};
    for (const tool of TOGGLEABLE_TOOLS) toolVisibilityDraft[tool.id] = vis[tool.id] !== false;
    renderToolVisibilityTransfer();
  };
  const collectToolVisibility = () => {
    const out = {};
    if (typeof TOGGLEABLE_TOOLS === "undefined") return out;
    for (const tool of TOGGLEABLE_TOOLS){
      out[tool.id] = toolVisibilityDraft ? toolVisibilityDraft[tool.id] !== false : (appSettings.toolVisibility || {})[tool.id] !== false;
    }
    return out;
  };
  // ── 코드 색(구문 강조) 설정 ──────────────────────────────────────
  // 저장 버튼을 누를 때까지는 초안(codeColorDraft)만 바꾸고, 미리보기에 그 초안 색을 직접 얹어 보여준다.
  // 초안은 normalizeCodeColors 형태({light:{…},dark:{…}}, 기본색과 같은 항목은 비움)를 그대로 쓴다.
  // 주석·메시지는 화면 언어를 따르므로 그릴 때마다 만든다(길이가 달라져 범위도 함께 계산한다).
  const tr = (text) => (typeof window.t === "function" ? window.t(text) : text);
  // 짧은 낱말은 사전에 넣지 않고(다른 화면까지 번역됨) labelEn 을 직접 고른다.
  const uiLabel = (item) => ((window.MNI18N && window.MNI18N.lang) === "en" && item.labelEn) ? item.labelEn : item.label;
  const CODE_COLOR_SAMPLE_DEF = 'def area(radius, unit="cm"):';
  const codeColorSample = () => [
    "# " + tr("원의 넓이를 구해요"),
    "import math",
    "",
    "@lru_cache",
    CODE_COLOR_SAMPLE_DEF,
    "    if radius <= 0:",
    '        raise ValueError("' + tr("반지름은 0보다 커야 해요") + '")',
    "    return round(math.pi * radius ** 2, 2)",
    "",
    "print(area(3))"
  ].join("\n");
  // 매개변수색(tk-param)은 렉서가 아니라 의미 분석 결과로 칠해지므로 미리보기에서도 범위를 직접 넘긴다.
  const codeColorSampleParams = (sample) => {
    const at = sample.indexOf(CODE_COLOR_SAMPLE_DEF);
    if (at < 0) return [];
    return ["radius", "unit"].map((name) => {
      const start = at + CODE_COLOR_SAMPLE_DEF.indexOf(name);
      return { start, end:start + name.length, cls:"tk-param" };
    });
  };
  let codeColorDraft = normalizeCodeColors();
  let codeColorInputsBuilt = false;
  const CODE_COLOR_CHIP_IDS = ["keyword", "string", "function", "comment"];
  const codeColorInputId = (id) => "settingCodeColor-" + id;
  const draftColor = (id) => {
    const theme = currentThemeName();
    return codeColorValue(theme, id, codeColorDraft);
  };
  const setDraftColor = (id, hex) => {
    const theme = currentThemeName(), value = normalizeHexColor(hex);
    if (!value) return;
    if (value === CODE_COLOR_DEFAULTS[theme][id]) delete codeColorDraft[theme][id];
    else codeColorDraft[theme][id] = value;
  };
  const buildCodeColorInputs = () => {
    if (codeColorInputsBuilt) return;
    const host = byId("settingCodeColorList"), presetHost = byId("settingCodeColorPresets");
    if (!host || !presetHost || typeof CODE_COLOR_DEFS === "undefined") return;
    for (const def of CODE_COLOR_DEFS){
      const label = document.createElement("label"); label.className = "code-color-item"; label.dataset.codeColor = def.id;
      const input = document.createElement("input"); input.type = "color"; input.id = codeColorInputId(def.id);
      input.addEventListener("input", () => { setDraftColor(def.id, input.value); renderCodeColorSettings(); });
      const text = document.createElement("span");
      const strong = document.createElement("b"); strong.dataset.codeColorLabel = def.id;   // 이름은 render 가 현재 언어로 채운다
      const small = document.createElement("small"); small.textContent = def.hint;   // 코드 예시라 번역하지 않는다
      text.append(strong, small);
      label.append(input, text); host.appendChild(label);
    }
    for (const preset of CODE_COLOR_PRESETS){
      const button = document.createElement("button");
      button.type = "button"; button.className = "code-color-preset"; button.dataset.codeColorPreset = preset.id;
      // 프리셋 미리보기 점 — 색은 테마를 타므로 그릴 때마다 renderCodeColorSettings 가 다시 칠한다.
      const chips = document.createElement("span"); chips.className = "code-color-preset-chips";
      for (const id of CODE_COLOR_CHIP_IDS){
        const chip = document.createElement("i"); chip.dataset.codeColorChip = id;
        chips.appendChild(chip);
      }
      const name = document.createElement("span"); name.dataset.codeColorPresetLabel = preset.id;
      button.append(chips, name);
      button.addEventListener("click", () => {
        const theme = currentThemeName();
        // 화면에 표시한 현재 테마만 바꾸고 반대 테마에서 직접 고른 색은 보존한다.
        codeColorDraft = normalizeCodeColors({
          ...codeColorDraft,
          [theme]:(preset.colors && preset.colors[theme]) || {}
        });
        renderCodeColorSettings();
      });
      presetHost.appendChild(button);
    }
    codeColorInputsBuilt = true;
  };
  // 초안 색을 미리보기·색 고르개·프리셋 선택 표시·대비 경고에 한 번에 반영한다.
  function renderCodeColorSettings(){
    buildCodeColorInputs();
    if (typeof CODE_COLOR_DEFS === "undefined") return;
    const theme = currentThemeName();
    const en = (window.MNI18N && window.MNI18N.lang) === "en";
    const themeLabel = byId("settingCodeColorTheme");
    // 아래 문구들은 설정 창을 처음 열 때 만들어져 초기 번역 스캔을 놓치므로 그릴 때마다 직접 채운다.
    if (themeLabel) themeLabel.textContent = theme === "dark"
      ? (en ? "dark mode" : "다크 모드") : (en ? "light mode" : "라이트 모드");
    document.querySelectorAll("[data-code-color-label]").forEach((el) => {
      const def = CODE_COLOR_DEFS.find((item) => item.id === el.dataset.codeColorLabel);
      if (def) el.textContent = uiLabel(def);
    });
    document.querySelectorAll("[data-code-color-preset-label]").forEach((el) => {
      const preset = CODE_COLOR_PRESETS.find((item) => item.id === el.dataset.codeColorPresetLabel);
      if (preset) el.textContent = uiLabel(preset);
    });
    const preview = byId("settingCodeColorPreview");
    const lowContrast = [];
    for (const def of CODE_COLOR_DEFS){
      const hex = draftColor(def.id);
      const input = byId(codeColorInputId(def.id));
      if (input && input.value !== hex) input.value = hex;
      if (preview) preview.style.setProperty(def.varName, hex);
      const dim = colorContrastRatio(hex, CODE_COLOR_BACKGROUNDS[theme]) < 2.2;
      const item = input && input.closest(".code-color-item");
      if (item) item.classList.toggle("is-low-contrast", dim);
      if (dim) lowContrast.push(uiLabel(def));
    }
    if (preview && typeof highlightCode === "function"){
      const sample = codeColorSample();
      preview.innerHTML = highlightCode(sample, "python", codeColorSampleParams(sample));
    }
    const warn = byId("settingCodeColorWarn");
    if (warn) warn.textContent = lowContrast.length
      ? (typeof window.tf === "function"
          ? window.tf("{names} 색이 배경과 너무 비슷해 잘 안 보일 수 있어요.", { names: lowContrast.join("·") })
          : lowContrast.join("·") + " 색이 배경과 너무 비슷해 잘 안 보일 수 있어요.")
      : "";
    document.querySelectorAll("#settingCodeColorPresets .code-color-preset").forEach((button) => {
      const preset = CODE_COLOR_PRESETS.find((item) => item.id === button.dataset.codeColorPreset);
      if (!preset) return;
      // 프리셋 선택 표시도 지금 보고 있는 테마끼리만 비교한다.
      const on = JSON.stringify(normalizeCodeColors(preset.colors)[theme]) === JSON.stringify(codeColorDraft[theme]);
      button.setAttribute("aria-pressed", String(on));
      // 점 색은 지금 테마 기준 — 기본 프리셋(colors:null)은 팔레트 기본색을 그대로 보여준다.
      button.querySelectorAll("[data-code-color-chip]").forEach((chip) => {
        const id = chip.dataset.codeColorChip;
        chip.style.color = (preset.colors && normalizeHexColor(preset.colors[theme][id])) || CODE_COLOR_DEFAULTS[theme][id];
      });
    });
  }
  if (byId("settingCodeColorReset")) byId("settingCodeColorReset").onclick = () => {
    const theme = currentThemeName();
    codeColorDraft = normalizeCodeColors({ ...codeColorDraft, [theme]:{} });
    renderCodeColorSettings();
  };
  // 설정 창을 열어 둔 채 언어를 바꿔도 이름·예제가 그 언어를 따라오게 한다.
  window.addEventListener("mni18nchange", () => {
    if (codeColorInputsBuilt && !byId("settingsModal").hidden) renderCodeColorSettings();
  });
  byId("settingsOpen").onclick = () => {
    setSettingsTab("general");
    lightBackgroundDraft = currentLightBackground();
    syncLightBackgroundButtons();
    byId("settingUiScale").value = String(currentUiScale());
    byId("settingPdfZoom").value = String(defaultPdfZoom());
    byId("settingPerformance").value = appSettings.performance === "quality" ? "quality" : "memory";
    byId("settingAutoRestore").checked = !!appSettings.autoRestore;
    byId("settingAutoOpenFirstFile").checked = appSettings.autoOpenFirstFile === true;
    byId("settingSearchHistory").checked = appSettings.searchHistory !== false;
    mapSearchProviderInput.value = appSettings.mapSearchProvider === "kakao" ? "kakao" : "osm";
    mapSearchKeyInput.value = "";
    syncMapSearchFields();
    refreshMapSearchKeyStatus();
    refreshSearchHistoryCount();
    byId("settingPdfRecovery").checked = !!appSettings.pdfRecovery;
    byId("settingPptxExactByDefault").checked = appSettings.pptxExactByDefault === true;
    byId("settingAutoSave").checked = !!appSettings.autoSave;
    byId("settingJavaCheckOnAutoSave").checked = appSettings.javaCheckOnAutoSave === true;
    syncJavaAutoCheckSetting();
    byId("settingPyFormatOnSave").checked = appSettings.pyFormatOnSave !== false;
    byId("settingOfficeReplaceAttached").checked = appSettings.officeReplaceAttached === true;
    byId("settingOfficeReplaceTracked").checked = appSettings.officeReplaceTracked === true;
    codeColorDraft = normalizeCodeColors(appSettings.codeColors);
    renderCodeColorSettings();
    boardBgDraft = normalizeBoardBg(appSettings.boardBg);
    boardPatternDraft = normalizeBoardPattern(appSettings.boardPattern);
    buildBoardBgChoices();
    syncBoardBgChoices();
    syncToolVisibilityTransfer();
    byId("settingPet").checked = !!appSettings.petEnabled;
    byId("settingPetCount").value = String(appSettings.petCount || 1);
    const petFocus = typeof normalizePetFocus === "function" ? normalizePetFocus(appSettings.petFocus) : { enabled:true, focusMin:25, breakMin:5, quietTyping:true };
    byId("settingPetFocus").checked = !!petFocus.enabled;
    byId("settingPetFocusMin").value = String(petFocus.focusMin);
    byId("settingPetBreakMin").value = String(petFocus.breakMin);
    byId("settingPetQuietTyping").checked = !!petFocus.quietTyping;
    syncPetFocusSettingFields();
    const ss = appSettings.screensaver || { enabled:false, idleMin:5 };
    byId("settingScreensaver").checked = !!ss.enabled;
    byId("settingScreensaverIdle").value = String(ss.idleMin || 5);
    byId("settingScreensaverSound").checked = !!ss.sound;
    byId("settingScreensaverMode").value = ss.mode === "web" ? "web" : "video";
    byId("settingScreensaverUrl").value = ss.url || "";
    clearScreensaverPreview();
    syncScreensaverModeFields();
    byId("settingMouseSideButtons").checked = appSettings.mouseSideButtons !== false;
    shortcutCaptureAction = "";
    shortcutDraft = normalizeShortcutMap(appSettings.shortcuts);
    musicKeyboardCaptureAction = "";
    musicKeyboardDraft = normalizeMusicKeyboard(appSettings.musicKeyboard);
    setShortcutError("");
    setMusicKeyboardError("");
    renderShortcutSettings();
    renderMusicKeyboardSettings();
    refreshSaveFolder();
    refreshAppMode();
    byId("settingsModal").hidden = false;
  };
  byId("settingsCancel").onclick = () => {
    shortcutCaptureAction = "";
    musicKeyboardCaptureAction = "";
    clearScreensaverPreview();   // 미리보기 프레임을 남겨 두면 설정을 닫아도 계속 돌아간다
    byId("settingsModal").hidden = true;
  };
  byId("settingsSave").onclick = () => {
    const conflict = shortcutConflict(shortcutDraft);
    if (conflict){
      const first = SHORTCUT_DEFINITIONS.find((item) => item.id === conflict.first);
      const second = SHORTCUT_DEFINITIONS.find((item) => item.id === conflict.second);
      setShortcutError("'" + first.label + "'과 '" + second.label + "'의 단축키가 같습니다.");
      return;
    }
    // 대기 화면 웹 주소 — 잘못된 주소로 저장하면 대기 화면이 검은 화면으로 뜨므로 저장을 막는다.
    const ssMode = byId("settingScreensaverMode").value === "web" ? "web" : "video";
    const ssUrl = normalizeScreensaverUrl(byId("settingScreensaverUrl").value);
    if (ssMode === "web" && !ssUrl){
      toast(typeof window.t === "function" ? window.t("대기 화면 웹 주소가 올바르지 않아요. http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.")
        : "대기 화면 웹 주소가 올바르지 않아요. http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.", 3800);
      byId("settingScreensaverUrl").focus();
      return;
    }
    const previousPerformance = appSettings.performance;
    applyLightBackground(lightBackgroundDraft);
    saveAppSettings({
      uiScale: Number(byId("settingUiScale").value), pdfZoom: Number(byId("settingPdfZoom").value),
      performance: byId("settingPerformance").value, autoRestore: byId("settingAutoRestore").checked,
      autoOpenFirstFile: byId("settingAutoOpenFirstFile").checked,
      searchHistory: byId("settingSearchHistory").checked,
      mapSearchProvider: mapSearchProviderInput.value === "kakao" ? "kakao" : "osm",
      pdfRecovery: byId("settingPdfRecovery").checked,
      pptxExactByDefault: byId("settingPptxExactByDefault").checked,
      autoSave: byId("settingAutoSave").checked,
      javaCheckOnAutoSave: byId("settingJavaCheckOnAutoSave").checked,
      pyFormatOnSave: byId("settingPyFormatOnSave").checked,
      officeReplaceAttached: byId("settingOfficeReplaceAttached").checked,
      officeReplaceTracked: byId("settingOfficeReplaceTracked").checked,
      petEnabled: byId("settingPet").checked, petCount: Number(byId("settingPetCount").value) || 1,
      petFocus: { enabled: byId("settingPetFocus").checked, focusMin: Number(byId("settingPetFocusMin").value) || 25,
        breakMin: Number(byId("settingPetBreakMin").value) || 5, quietTyping: byId("settingPetQuietTyping").checked },
      screensaver: { enabled: byId("settingScreensaver").checked, idleMin: Number(byId("settingScreensaverIdle").value) || 5,
        sound: byId("settingScreensaverSound").checked, mode: ssMode, url: ssUrl },
      toolVisibility: collectToolVisibility(),
      codeColors: codeColorDraft,
      boardBg: boardBgDraft,
      boardPattern: boardPatternDraft,
      mouseSideButtons: byId("settingMouseSideButtons").checked,
      shortcuts:shortcutDraft,
      musicKeyboard:musicKeyboardDraft
    });
    saveMapSearchProviderToLauncher(appSettings.mapSearchProvider);
    saveAppMode();   // 런처 파일에 남는 값이라 saveAppSettings(localStorage) 와는 따로 저장한다
    if (typeof applyToolVisibility === "function") applyToolVisibility();
    if (typeof applyCodeColors === "function") applyCodeColors();
    if (typeof applyScreensaverSettings === "function") applyScreensaverSettings();
    if (typeof applyPetSettings === "function") applyPetSettings();
    if (typeof applyPetFocusSettings === "function") applyPetFocusSettings();
    docs.forEach(doc => { if (typeof doc.schedulePythonAutosave === "function") doc.schedulePythonAutosave(); });
    applyUiScale();
    syncShortcutHints();
    if (state && state.kind === "pdf" && !appSettings.pdfRecovery) state.recoveryDirty = false;
    clearScreensaverPreview();
    byId("settingsModal").hidden = true;
    updateDocumentStatus(state);
    if (previousPerformance !== appSettings.performance){
      docs.filter(d => d.kind === "pdf" && d.pages).forEach(d => {
        d.pages.forEach(releasePageCanvas);
        startLazyRender(d);
        if (d.id === activeId) refreshVisibleQuality(d);
      });
    }
    scheduleViewerLayoutRefresh();
    // 기억을 끄면 남아 있던 검색어도 함께 지운다 — 껐는데 기록이 그대로 남아 있으면 끈 의미가 없다.
    if (!appSettings.searchHistory && typeof MNSearchHistory === "object" && MNSearchHistory) MNSearchHistory.clear();
    toast("설정을 저장했어요. 화면 크기와 단축키는 바로 적용됩니다.", 2800);
  };
  // 검색 기록(최근 검색어) — 몇 개가 남아 있는지 보여주고, 지우기는 저장 버튼과 무관하게 바로 적용한다.
  function refreshSearchHistoryCount(){
    const el = byId("settingSearchHistoryCount"), button = byId("settingSearchHistoryClear");
    if (!el || !button) return;
    const count = (typeof MNSearchHistory === "object" && MNSearchHistory) ? MNSearchHistory.size() : 0;
    el.textContent = count ? window.tf("({n}개 기억 중)", { n: count }) : "(비어 있음)";
    button.disabled = !count;
  }
  if (byId("settingSearchHistoryClear")) byId("settingSearchHistoryClear").onclick = () => {
    if (typeof MNSearchHistory === "object" && MNSearchHistory) MNSearchHistory.clear();
    refreshSearchHistoryCount();
    toast("검색 기록을 지웠어요.", 1800);
  };
  // 대기 화면(화면보호기) 영상 선택/지우기 — 파일 작업이라 즉시 반영(켜짐·시간은 저장 버튼을 따름).
  const screensaverT = (text) => (typeof window.t === "function" ? window.t(text) : text);
  function translateScreensaverNote(note){
    const timed = String(note || "").match(/^시작 시간 (\d+)초를 함께 옮겼어요\.$/);
    if (timed && typeof window.tf === "function") return window.tf("시작 시간 {n}초를 함께 옮겼어요.", { n:Number(timed[1]) });
    return screensaverT(note);
  }
  let screensaverPreviewRun = 0;
  function refreshScreensaverName(){
    const el = byId("settingScreensaverName"); if (!el) return;
    const names = (typeof screensaverVideoNames === "function") ? screensaverVideoNames() : [];
    const videoText = names.length > 1 ? ("영상 " + names.length + "개: " + names[0] + " 외 " + (names.length - 1) + "개 (차례대로 반복)")
      : names.length === 1 ? ("영상: " + names[0]) : "기본 애니메이션(시계)";
    // 웹 주소 모드면 주소가 주인공이고, 영상·애니메이션은 페이지가 안 열릴 때의 대비책이라 함께 적어 준다.
    if (byId("settingScreensaverMode") && byId("settingScreensaverMode").value === "web"){
      const url = (byId("settingScreensaverUrl").value || "").trim();
      el.textContent = (url ? "웹 주소: " + url : "웹 주소: (아직 입력 전)") + " · 안 열리면 " + videoText;
      return;
    }
    el.textContent = videoText;
  }
  // 웹 주소 칸은 그 모드일 때만 보인다.
  function syncScreensaverModeFields(){
    const row = byId("settingScreensaverWebRow"), mode = byId("settingScreensaverMode");
    if (row && mode) row.hidden = mode.value !== "web";
    refreshScreensaverName();
    syncScreensaverYoutubeButton();
  }
  // 미리보기 프레임은 남겨 두면 설정을 닫은 뒤에도 계속 돌아간다 — 열고 닫을 때마다 비운다.
  function clearScreensaverPreview(){
    screensaverPreviewRun++;
    const host = byId("settingScreensaverPreview"), result = byId("settingScreensaverTestResult"), button = byId("settingScreensaverTest");
    if (host){ host.textContent = ""; host.hidden = true; }
    if (result){ result.textContent = ""; result.hidden = true; result.classList.remove("ok", "bad"); }
    if (button){ button.disabled = false; button.textContent = screensaverT("미리보기 · 테스트"); }
  }
  // 유튜브 주소는 그대로는 안 열린다 — 바꿔 줄 수 있을 때만 버튼을 띄운다.
  // 조용히 바꿔치기하지 않는다: 누른 뒤에 무엇을 왜 바꿨는지 그대로 보여 준다.
  function syncScreensaverYoutubeButton(){
    const button = byId("settingScreensaverYoutube"), input = byId("settingScreensaverUrl");
    if (!button || !input) return;
    button.hidden = !(typeof youtubeEmbedUrl === "function" && youtubeEmbedUrl(input.value));
  }
  if (byId("settingScreensaverMode")) byId("settingScreensaverMode").onchange = () => { clearScreensaverPreview(); syncScreensaverModeFields(); };
  if (byId("settingScreensaverUrl")) byId("settingScreensaverUrl").addEventListener("input", () => {
    clearScreensaverPreview();
    refreshScreensaverName(); syncScreensaverYoutubeButton();
  });
  if (byId("settingScreensaverYoutube")){
    byId("settingScreensaverYoutube").onclick = () => {
      const input = byId("settingScreensaverUrl"), result = byId("settingScreensaverTestResult");
      const converted = (typeof youtubeEmbedUrl === "function") ? youtubeEmbedUrl(input.value) : null;
      if (!converted) return;
      input.value = converted.url;
      clearScreensaverPreview();
      result.hidden = false; result.classList.remove("ok", "bad");
      result.textContent = screensaverT("퍼가기 주소로 바꿨어요.") + " "
        + converted.notes.map(translateScreensaverNote).join(" ") + " "
        + screensaverT("실제로 재생되는지 미리보기 · 테스트로 확인해 주세요.");
      refreshScreensaverName(); syncScreensaverYoutubeButton();
    };
  }
  if (byId("settingScreensaverTest")){
    byId("settingScreensaverTest").onclick = async () => {
      const button = byId("settingScreensaverTest"), host = byId("settingScreensaverPreview"), result = byId("settingScreensaverTestResult");
      if (typeof testScreensaverUrl !== "function") return;
      const run = ++screensaverPreviewRun;
      button.disabled = true;
      const label = button.textContent;
      button.textContent = screensaverT("여는 중…");
      host.hidden = false;
      result.hidden = false; result.classList.remove("ok", "bad"); result.textContent = screensaverT("페이지를 여는 중이에요…");
      const res = await testScreensaverUrl(byId("settingScreensaverUrl").value, host);
      if (run !== screensaverPreviewRun) return;   // 주소 수정·설정 닫기 뒤 도착한 예전 결과는 버린다
      button.disabled = false; button.textContent = label;
      result.classList.add(res.ok ? "ok" : "bad");
      result.textContent = (res.ok ? "✔ " : "✘ ") + res.message;
      if (res.ok && res.url){ byId("settingScreensaverUrl").value = res.url; refreshScreensaverName(); }   // https:// 를 붙였으면 칸에도 반영
      else if (!res.ok){ host.textContent = ""; host.hidden = true; }
    };
  }
  const ssVideoInput = byId("screensaverVideoInput");
  if (byId("settingScreensaverVideo") && ssVideoInput){
    byId("settingScreensaverVideo").onclick = () => ssVideoInput.click();
    ssVideoInput.addEventListener("change", async () => {
      const files = ssVideoInput.files ? [...ssVideoInput.files] : [];
      if (files.length && typeof setScreensaverVideos === "function") await setScreensaverVideos(files);
      ssVideoInput.value = ""; refreshScreensaverName();
    });
  }
  if (byId("settingScreensaverClear")){
    byId("settingScreensaverClear").onclick = async () => { if (typeof clearScreensaverVideo === "function") await clearScreensaverVideo(); refreshScreensaverName(); };
  }
  if (byId("settingScreensaverStart")){
    // 클릭 제스처가 있는 이 순간에만 전체화면이 허용된다(유휴 자동 표시는 창 안 오버레이).
    byId("settingScreensaverStart").onclick = () => { if (typeof startScreensaverNow === "function") startScreensaverNow(); };
  }
  if (typeof initScreensaver === "function") initScreensaver();
  if (typeof initPet === "function") initPet();
  if (typeof initPetFocus === "function") initPetFocus();
  if (byId("btnPetDex")) byId("btnPetDex").onclick = () => { if (typeof openPetDex === "function") openPetDex(); };
  if (byId("petDexClose")) byId("petDexClose").onclick = () => { byId("petDexModal").hidden = true; };
  if (typeof initPetCustom === "function") initPetCustom();
  if (byId("btnPetSay")) byId("btnPetSay").onclick = () => { if (typeof openPetSayings === "function") openPetSayings(); };
  if (byId("petSayClose")) byId("petSayClose").onclick = () => { byId("petSayModal").hidden = true; };
  if (byId("btnPetBuilder")) byId("btnPetBuilder").onclick = () => { if (typeof openPetBuilder === "function") openPetBuilder(); };
  if (byId("petBuilderClose")) byId("petBuilderClose").onclick = () => { byId("petBuilderModal").hidden = true; };
  document.querySelectorAll(".tool-menu").forEach(menu => menu.querySelectorAll("button").forEach(button => button.addEventListener("click", () => { menu.open = false; })));
  document.addEventListener("click", (e) => document.querySelectorAll(".tool-menu[open]").forEach(menu => { if (!menu.contains(e.target)) menu.open = false; }));
  byId("helpOpen").onclick = () => { byId("helpModal").hidden = false; };
  byId("helpClose").onclick = () => { byId("helpModal").hidden = true; };

  // 처음 사용 안내(온보딩): 최초 1회 자동으로 열고, 도움말의 '처음 사용 안내 보기'로 다시 볼 수 있다.
  const ONBOARDED_KEY = "mn_onboarded_v1";
  const openWelcome = () => { const m = byId("welcomeModal"); if (m) m.hidden = false; };
  const closeWelcome = () => { const m = byId("welcomeModal"); if (m) m.hidden = true; try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch(_){} };
  const welcomeCloseBtn = byId("welcomeClose"); if (welcomeCloseBtn) welcomeCloseBtn.onclick = closeWelcome;
  const welcomeExamplesBtn = byId("welcomeExamples");
  if (welcomeExamplesBtn) welcomeExamplesBtn.onclick = () => { closeWelcome(); if (typeof openSnippetGallery === "function") openSnippetGallery(); };
  const welcomeReopenBtn = byId("welcomeReopen");
  if (welcomeReopenBtn) welcomeReopenBtn.onclick = () => { byId("helpModal").hidden = true; openWelcome(); };
  const helpManualBtn = byId("helpManual");
  if (helpManualBtn) helpManualBtn.onclick = () => openUserManual();
  try { if (!localStorage.getItem(ONBOARDED_KEY)) setTimeout(openWelcome, 700); } catch(_){}

  // 정적 모달 공통 ESC 닫기. 단순히 hidden 만 바꾸지 않고 기존 취소 버튼을 눌러
  // 암호·텍스트·확인 Promise 와 설정 임시 상태가 정상적으로 정리되게 한다.
  const modalCancelButtons = {
    sigModal: "sigCancel",
    pwModal: "pwCancel",
    textModal: "textCancel",
    confirmModal: "confirmCancel",
    settingsModal: "settingsCancel",
    helpModal: "helpClose",
    welcomeModal: "welcomeClose",
    petDexModal: "petDexClose",
    petSayModal: "petSayClose",
    petBuilderModal: "petBuilderClose"
  };
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.isComposing || e.keyCode === 229 || shortcutCaptureAction) return;
    const visible = [...document.querySelectorAll(".modal:not([hidden])")]
      .filter(modal => modal.id && modalCancelButtons[modal.id]);
    if (!visible.length) return;                           // 동적 모달은 각자의 ESC 정리 함수를 사용
    const focused = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest(".modal:not([hidden])") : null;
    const modal = focused && modalCancelButtons[focused.id] ? focused : visible[visible.length - 1];
    const cancel = byId(modalCancelButtons[modal.id]);
    if (!cancel) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel.click();
  }, true);

  // 사이드바 파일 통계: 클릭으로 열기/닫기, 바깥 클릭 시 닫기
  (() => {
    const wrap = byId("fileStatsWrap"), pop = byId("fileStatsPop"), chip = byId("fileStats");
    if (!wrap) return;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      wrap.dataset.pin = open ? "1" : "0";
      chip.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)){
        pop.hidden = true;
        wrap.dataset.pin = "0";
        chip.setAttribute("aria-expanded", "false");
      }
    });
  })();
  byId("sidebarToggle").onclick = (e) => {
    if (!sidebarIsOpen()){
      // e.detail === 0 이면 Enter·Space 로 누른 것 → 키보드 동선이므로 목록으로 포커스까지 넘긴다.
      // 파일이 없어 목록이 비었을 때도 "보이기" 쪽으로 붙는다 — 버튼 문구와 어긋나게 접힘 설정을 켜지 않는다.
      openSidebar({ moveFocus: !!e && e.detail === 0 });
    } else {
      sidebarCollapsed = true;
      try { localStorage.setItem("sidebarCollapsed", "true"); } catch(e){}
      refreshChrome();
    }
    scheduleViewerLayoutRefresh();
  };
  byId("sidebarBackdrop").onclick = () => {
    if (sidebarCollapsed) return;
    sidebarCollapsed = true;
    try { localStorage.setItem("sidebarCollapsed", "true"); } catch(e){}
    refreshChrome();
    byId("sidebarToggle").focus();
  };

  // 자주 쓰는 파일 작업 단축키. 편집기 안에서도 Ctrl+S는 현재 문서를 저장한다.
  window.addEventListener("keydown", (e) => {
    if (document.querySelector(".modal:not([hidden])")) return;
    if (e.key === "Escape" && !sidebarCollapsed && !byId("sidebar").hidden){
      e.preventDefault();
      sidebarCollapsed = true;
      try { localStorage.setItem("sidebarCollapsed", "true"); } catch(e){}
      refreshChrome();
      byId("sidebarToggle").focus();
      return;
    }
    // 왼쪽 사이드바 숨기기 / 보이기 (기본 Alt+←/→ — 브라우저 뒤로·앞으로가기는 막는다)
    const sbHide = shortcutMatches(e, "sidebarHide"), sbShow = shortcutMatches(e, "sidebarShow");
    if (sbHide || sbShow){
      e.preventDefault();
      const wantCollapsed = sbHide;
      if (sidebarCollapsed !== wantCollapsed){
        if (wantCollapsed){
          sidebarCollapsed = true;
          try { localStorage.setItem("sidebarCollapsed", "true"); } catch(_){}
          refreshChrome();
        } else {
          openSidebar({ moveFocus: true });      // 키보드로 열었으니 마지막으로 보던 파일명에 커서를 둔다
        }
        scheduleViewerLayoutRefresh();
      }
      return;
    }
    if (shortcutMatches(e, "newPython")){
      e.preventDefault();
      if (typeof newPythonScratch === "function") newPythonScratch();
      return;
    }
    // 문서를 열어 설명하는 도중에도 손을 떼지 않고 판서로 넘어갈 수 있게 한다(탭바 ＋ 버튼과 같은 동작).
    if (shortcutMatches(e, "newBoard")){
      e.preventDefault();
      if (typeof newWhiteboard === "function") newWhiteboard();
      return;
    }
    if (shortcutMatches(e, "screensaverStart")){
      // 키 입력도 사용자 제스처라 전체화면이 허용된다(설정을 열지 않고 바로 시작).
      e.preventDefault();
      if (typeof startScreensaverNow === "function") startScreensaverNow();
      return;
    }
    const key = String(e.key || "").toLowerCase();
    const previous = shortcutMatches(e, "previousFile"), next = shortcutMatches(e, "nextFile");
    if (previous || next){
      const target = e.target;
      const editing = !!(target && target.closest && target.closest("input,textarea,[contenteditable='true']"));
      const codeEditor = !!(target && target.closest && target.closest(".code-input"));
      // 코드 편집기에선 Ctrl+←/→ 에 걸린 편집 기능이 없어 탭 전환에 쓴다.
      // 그 외 입력란(검색·파일명 등)에선 단어 단위 커서 이동 등 기본 동작을 보존한다.
      if (editing && !codeEditor) return;
      if (tabOrder.length < 2) return;                  // 열린 탭이 2개 이상일 때만 전환
      e.preventDefault();
      navigateTab(previous ? -1 : 1);                  // 열린 탭 좌/우 순환
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "z" && state && state.kind === "pdf"){
      e.preventDefault();
      if (e.shiftKey) redoPdfEdit(state);
      else undoPdfEdit(state);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "y" && state && state.kind === "pdf"){
      e.preventDefault(); redoPdfEdit(state); return;
    }
    if (shortcutMatches(e, "openFolder")){
      e.preventDefault();
      pickFolderOrInput(folderInput);
      return;
    }
    if (shortcutMatches(e, "openFiles")){
      e.preventDefault(); pickFilesOrInput(fileInput); return;
    }
    if (shortcutMatches(e, "saveCurrent")){
      if (state && state.notebookModel && typeof saveNotebook === "function"){
        e.preventDefault();
        saveNotebook(state);
        return;
      }
      if (state && state.kind === "pdf") { e.preventDefault(); exportPdf(); return; }
      // 화이트보드는 디스크 파일 형식이 없어 .run-save 가 없다. 여기서 안 받으면 브라우저 기본
      // "웹페이지 저장(HTML)" 대화상자가 떠 버리므로, 툴바 PNG 버튼과 같은 동작으로 받는다.
      if (state && state.kind === "board" && typeof state.saveBoardPng === "function"){
        e.preventDefault(); state.saveBoardPng(); return;
      }
      // 시험지 화면들도 kind 가 "office" 이고 .run-save 가 없어 아래 어느 경로에도 안 걸린다 —
      // 화이트보드와 똑같은 이유로 여기서 받지 않으면 브라우저 기본 저장 대화상자가 떠 버린다.
      if (state && state.examEdit){
        e.preventDefault();
        if (typeof examSaveMaster === "function") examSaveMaster(state);   // [💾 원본 저장] 버튼과 같은 길
        return;
      }
      // 채점·응시 화면은 따로 저장할 파일이 없다(채점 결과도 답안도 자동 저장). 기본 동작만 막고 알려 준다.
      // 특히 제출 확정은 되돌릴 수 없어 Ctrl+S 에 걸지 않는다 — 손버릇으로 누른 한 번에 시험이 끝나면 안 된다.
      if (state && state.examGrade){
        e.preventDefault();
        toast("채점 결과는 자동으로 저장돼요. 파일로 남기려면 [⬇ 성적 CSV]를 누르세요.", 3200);
        return;
      }
      if (state && state.examTake){
        e.preventDefault();
        toast("답안은 자동으로 저장되고 있어요. 다 풀었으면 [📤 제출 확정하기]를 누르세요.", 3200);
        return;
      }
      if (state && state.examLocked){        // 아직 암호를 안 넣은 시험지 — 저장할 내용 자체가 없다
        e.preventDefault();
        toast("암호를 넣어 시험지를 연 뒤에 저장할 수 있어요.", 3000);
        return;
      }
      const save = state && state.el && state.el.querySelector(".run-save");
      if (save) {
        e.preventDefault();
        if (save.disabled) return;
        save.click();
      }
      return;
    }
    if (shortcutMatches(e, "closeCurrent") && state){
      e.preventDefault();
      requestCloseDoc(state.id, { forgetWorkspace: true });
      return;
    }
    if (shortcutMatches(e, "reopenClosed")){
      e.preventDefault();
      reopenClosedDoc();
      return;
    }
    if (shortcutMatches(e, "findInDocument")){
      const target = typeof pdfFindTarget === "function"
        ? pdfFindTarget()
        : (state && state.kind === "pdf" ? state : null);
      if (target){
        e.preventDefault();
        if (typeof openPdfFind === "function") openPdfFind(target);
        return;
      }
      if (state && typeof state.openDocFind === "function"){   // 텍스트·코드·HTML 소스 읽기 전용 보기에서 찾기
        e.preventDefault();
        state.openDocFind();
        return;
      }
    }
    if (shortcutMatches(e, "goToLine") && state && typeof state.openGotoLine === "function"){
      e.preventDefault();
      state.openGotoLine();
      return;
    }
    if (shortcutMatches(e, "focusSearch") && workspaceActiveDocs().length){
      e.preventDefault();
      const seed = document.activeElement === sidebarSearch
        ? "" : currentSelectionSeed();                   // focus()·select() 가 선택을 지우기 전에 붙잡는다(검색창 자신은 제외)
      if (sidebarCollapsed) openSidebar({ reveal: false });   // 포커스는 아래 검색창으로 간다
      if (seed && seed !== sidebarSearch.value){         // 문서에서 선택해 둔 글자가 있으면 검색어로 딸려간다
        sidebarSearch.value = seed;
        sidebarSearch.dispatchEvent(new Event("input", { bubbles: true }));   // 이름·본문 검색 즉시 실행
      }
      sidebarSearch.focus(); sidebarSearch.select();
    }
  });

  // 마우스 측면 버튼(4=뒤로, 5=앞으로)으로 열린 탭 좌/우 이동.
  // ▶ 기능을 꺼도 preventDefault 는 항상 한다: 이 앱은 한 페이지짜리라 브라우저 '뒤로'가
  //    곧 화면 이탈이고, 저장까지 끝낸 문서만 열려 있으면 beforeunload 경고도 안 떠서
  //    열어 둔 탭이 통째로 사라진다(사고 방지가 기능보다 먼저다).
  // ▶ 크로미움(Chrome·Edge)에서만 이 버튼이 DOM 으로 들어온다. Firefox(Windows)는 브라우저가
  //    먼저 삼켜서 아무 이벤트도 오지 않는다 — 그쪽에선 조용히 동작하지 않는다.
  // ▶ 창(capture) 단계에서 전파를 끊는 이유: 모달 오버레이 닫기 핸들러들이 버튼 번호를
  //    보지 않아(e.target === overlay 만 확인) 측면 클릭에도 창이 닫혀 버린다.
  (() => {
    const onSideButton = (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type !== "mousedown") return;                 // 한 번 누를 때 한 번만 이동
      if (appSettings.mouseSideButtons === false) return;
      if (document.querySelector(".modal:not([hidden])")) return;
      if (tabOrder.length < 2) return;                    // 열린 탭이 2개 이상일 때만 전환
      navigateTab(e.button === 3 ? -1 : 1);
    };
    // mouseup·auxclick 까지 막아야 일부 버전에서 뒤로가기가 새어 나가지 않는다.
    for (const type of ["mousedown", "mouseup", "auxclick"]) window.addEventListener(type, onSideButton, true);
  })();

  syncShortcutHints();
  if (typeof shortcutDefaultsMigrated !== "undefined" && shortcutDefaultsMigrated){
    toast("단축키가 변경됐어요. 문서 찾기는 Ctrl+F, 열린 파일 검색은 Ctrl+Shift+F를 사용합니다.", 5200);
  }
  if (typeof startMemStat === "function") startMemStat();   // 메모리 사용량 칩 폴링 시작

  // 사이드바 너비 드래그 조절
  (function(){
    const resizer = byId("sbResizer"), sidebar = byId("sidebar");
    try { const saved = localStorage.getItem("sbWidth"); if (saved) sidebar.style.width = saved; } catch(e){}
    const saveWidth = () => { try { localStorage.setItem("sbWidth", sidebar.style.width); } catch(e){} };
    const fitToLongestName = () => {
      if (!workspaceActiveNodes().length) return;
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      const sample = sidebar.querySelector(".sb-name");
      const font = sample ? getComputedStyle(sample) : getComputedStyle(sidebar);
      ctx.font = `${font.fontWeight || "400"} ${font.fontSize || "13px"} ${font.fontFamily || "sans-serif"}`;
      const depthOf = (node) => {
        let depth = 0, current = node;
        while (current && current.parentId != null){ depth++; current = navNodes.find(n => n.nodeId === current.parentId); }
        return depth;
      };
      let needed = 150;
      for (const node of workspaceActiveNodes()){
        const doc = node.type === "doc" ? docs.find(d => d.id === node.docId) : null;
        const name = node.type === "group" ? node.name : (doc && doc.name);
        if (!name) continue;
        // 좌우 패딩 + 트위스트 + 배지 + 닫기 + gap + 스크롤바 여유 + 폴더 깊이 들여쓰기.
        needed = Math.max(needed, Math.ceil(ctx.measureText(name).width + 112 + depthOf(node) * 16));
      }
      sidebar.style.width = Math.max(150, Math.min(needed, 600)) + "px";
      saveWidth();
      scheduleViewerLayoutRefresh();
      toast(needed > 600 ? "가장 긴 파일명에 맞췄어요. 최대 너비는 600px입니다." : "파일명 길이에 맞춰 사이드바를 조절했어요.", 1800);
    };
    resizer.addEventListener("dblclick", (e) => { e.preventDefault(); fitToLongestName(); });
    resizer.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add("dragging");
      const startX = e.clientX, startW = sidebar.getBoundingClientRect().width;
      const move = (ev) => {
        let w = startW + (ev.clientX - startX);
        w = Math.max(150, Math.min(w, 600));         // 최소 150 ~ 최대 600px
        sidebar.style.width = w + "px";
      };
      const up = () => {
        resizer.classList.remove("dragging");
        resizer.removeEventListener("pointermove", move);
        resizer.removeEventListener("pointerup", up);
        saveWidth();
      };
      resizer.addEventListener("pointermove", move);
      resizer.addEventListener("pointerup", up);
    });
  })();

  // 테마(다크모드) 토글
  (function(){
    const btn = byId("themeToggle");
    const root = document.documentElement;
    const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
    const sync = () => {
      const dark = root.getAttribute("data-theme") === "dark";
      btn.innerHTML = dark ? SUN : MOON;
      const _tt = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
      btn.title = (typeof window.t === "function") ? window.t(_tt) : _tt;
    };
    btn.onclick = () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch(e){}
      // 코드 색은 <html> 인라인 스타일로 얹혀 테마 규칙을 이기므로, 테마를 바꾼 뒤 반드시 다시 칠한다.
      // (안 하면 라이트로 돌아와도 다크에서 고른 색이 그대로 남는다.)
      if (typeof applyCodeColors === "function") applyCodeColors();
      if (!byId("settingsModal").hidden) renderCodeColorSettings();
      sync();
    };
    sync();
  })();

  // 서명 모달
  byId("sigClear").onclick = clearPad;
  byId("sigCancel").onclick = closeSig;
  byId("sigInsert").onclick = insertSig;
  byId("sigReuse").onclick = () => { if (lastSig) placeSignature(lastSig.dataUrl, lastSig.aspect); };
  byId("sigUpload").onclick = () => byId("sigFile").click();
  byId("sigFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const res = imageToSignature(img);
      if (!res){ toast("이미지에서 서명을 찾지 못했어요."); return; }
      placeSignature(res.dataUrl, res.aspect);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast("이미지를 불러오지 못했습니다."); };
    img.src = url;
  });
  initPad();

  // Delete 키로 선택 요소 삭제 (편집 중이 아닐 때만)
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && state && state.kind === "pdf" && state.selected){
      const ae = document.activeElement;
      if (ae && ae.isContentEditable) return;
      e.preventDefault(); removeEl(state.selected);
    }
  });

  if (typeof pdfjsLib === "undefined" || typeof PDFLib === "undefined"){
    toast("라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.", 5000);
  }

  setupMovableModals();
}

/* ===== 사이드바 다중 선택 바 =====
   Ctrl/Shift 클릭으로 고른 파일들을 한꺼번에 닫거나 디스크에서 지운다.
   "파일 닫기"는 앱에서만 치우고, "삭제"는 실제 파일을 지운다 — 두 동작을 확실히 갈라 놓는다. */
function wireSidebarSelection(){
  const closeBtn = byId("sbSelectionClose"), deleteBtn = byId("sbSelectionDelete"), clearBtn = byId("sbSelectionClear");
  if (closeBtn) closeBtn.addEventListener("click", async () => {
    const ids = selectedDocIds();
    if (!ids.length) return;
    let closed = 0;
    for (const id of ids){
      const doc = docs.find(item => item.id === id);
      if ((doc && workspaceDetachDocFromActive(doc)) || await requestCloseDoc(id, { forgetWorkspace: true }) === true) closed++;
    }
    renderSidebar();
    const cancelled = ids.length - closed;
    const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
    const _tf = (s, vars) => (typeof window.tf === "function" ? window.tf(s, vars) : s.replace(/\{(\w+)\}/g, (_, key) => vars[key]));
    if (!closed) toast(_t("파일 닫기를 취소했어요."), 2200);
    else if (cancelled) toast(_tf("파일 {closed}개를 닫았어요. {cancelled}개는 취소했어요.", { closed, cancelled }), 2800);
    else toast(closed === 1 ? _t("파일을 닫았어요.") : _tf("파일 {n}개를 닫았어요.", { n:closed }), 2200);
  });
  if (deleteBtn) deleteBtn.addEventListener("click", () => {
    const ids = selectedDocIds();
    if (ids.length) deleteDocsFromDisk(ids);
  });
  if (clearBtn) clearBtn.addEventListener("click", () => clearSidebarSelection());
  // Esc 로 선택을 푼다 — 입력 중이거나 다른 창이 떠 있을 때는 그쪽이 먼저 처리한다.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !sidebarSelection.size) return;
    if (document.querySelector(".modal:not([hidden])") || document.querySelector(".cmdk-overlay:not([hidden])")) return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable)) return;
    e.preventDefault();
    clearSidebarSelection();
  });
}

/* ===== 자세한 사용법 열기 =====
   단일 파일(EXE·오프라인 HTML)에는 사용법 문서가 통째로 심겨 있어 Blob 으로 새 탭에 띄운다.
   원본 HTML·서버 서빙에서는 옆에 있는 사용법.html 을 그대로 연다. */
let _manualUrl = "";
function openUserManual(){
  const embedded = document.querySelector("script[data-mn-manual]");
  let url = "사용법.html";
  if (embedded){
    if (!_manualUrl){
      try {
        _manualUrl = URL.createObjectURL(new Blob([embedded.textContent || ""], { type: "text/html;charset=utf-8" }));
      } catch(e){ console.warn("사용법 문서를 준비하지 못했어요:", e); }
    }
    if (_manualUrl) url = _manualUrl;
  }
  const opened = window.open(url, "_blank");
  if (opened){
    try { opened.opener = null; } catch(_){}
  }
  if (!opened && typeof toast === "function"){
    // 앱 모드 창에는 주소창이 없으므로 '주소창 옆' 같은 위치 안내는 쓰지 않는다.
    toast("팝업이 막혀 사용법을 열지 못했어요. 브라우저 설정에서 이 사이트의 팝업을 허용해 주세요.", 4200, { type: "error" });
  }
}

/* ===== 최근 연 항목(빈 화면) =====
   MNRecent 가 들고 있는 목록을 드롭존에 그린다. 항목을 누르면 보관해 둔 파일·폴더 핸들로
   바로 다시 열고(권한 확인 1회), ×로 목록에서만 지운다(디스크의 파일은 건드리지 않는다). */
function recentWhenLabel(at){
  const past = Date.now() - (Number(at) || 0);
  if (!(Number(at) > 0)) return "";
  const minutes = Math.floor(past / 60000);
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const _tf = (s, vars) => (typeof window.tf === "function" ? window.tf(s, vars) : s.replace("{n}", vars.n));
  if (minutes < 1) return _t("방금");
  if (minutes < 60) return _tf("{n}분 전", { n:minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return _tf("{n}시간 전", { n:hours });
  const days = Math.floor(hours / 24);
  return days < 7 ? _tf("{n}일 전", { n:days }) : new Date(Number(at)).toLocaleDateString();
}

function renderRecentItems(){
  const wrap = byId("dzRecent"), list = byId("dzRecentList");
  if (!wrap || !list || typeof MNRecent === "undefined") return;
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const _tf = (s, vars) => (typeof window.tf === "function" ? window.tf(s, vars) : s.replace(/\{(\w+)\}/g, (_, key) => vars[key]));
  const rows = MNRecent.list();
  wrap.hidden = rows.length === 0;
  if (!rows.length){ list.innerHTML = ""; return; }
  const frag = document.createDocumentFragment();
  for (const row of rows){
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dz-recent-item";
    item.setAttribute("role", "listitem");
    item.title = row.path;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", row.type === "folder"
      ? "M3 6h7l2 2h9v11H3z"
      : "M6 2h8l4 4v16H6zM14 2v4h4");
    icon.appendChild(shape);
    const name = document.createElement("span");
    name.className = "dz-recent-name";
    name.textContent = row.name;
    const when = document.createElement("span");
    when.className = "dz-recent-when";
    when.textContent = recentWhenLabel(row.at);
    const drop = document.createElement("span");
    drop.className = "dz-recent-drop";
    drop.setAttribute("role", "button");
    drop.setAttribute("tabindex", "0");
    drop.setAttribute("aria-label", _tf("{name} 을(를) 최근 목록에서 지우기", { name:row.name }));
    drop.title = _t("최근 목록에서만 지우기 (파일은 그대로)");
    drop.textContent = "×";
    const forget = (e) => { e.stopPropagation(); e.preventDefault(); MNRecent.forget(row.type, row.path); };
    drop.addEventListener("click", forget);
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") forget(e); });
    item.append(icon, name, when, drop);
    item.addEventListener("click", (e) => {
      e.stopPropagation();                                   // 드롭존 클릭(=파일 선택창)과 겹치지 않게
      MNRecent.openWithFeedback(row);
    });
    frag.appendChild(item);
  }
  list.innerHTML = "";
  list.appendChild(frag);
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(wrap);
}

function wireRecentItems(){
  if (typeof MNRecent === "undefined") return;
  const _t = (s) => (typeof window.t === "function" ? window.t(s) : s);
  const clearBtn = byId("dzRecentClear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    MNRecent.clear();
    if (typeof toast === "function") toast(_t("최근 목록을 지웠어요. 파일은 그대로예요."), 2400);
  });
  window.addEventListener("mnrecentchange", renderRecentItems);
  renderRecentItems();
}

/* ===== 가장자리 크기 조절 핸들(모달·메모창 공용) =====
   대상 요소의 네 변·네 모서리에 잡을 곳을 만든다. CSS resize 는 우하단 한 곳만 지원하므로 직접 만든다.
   핸들을 요소 '안'에 두면 (1) 내부 스크롤에 같이 밀리고 (2) 오른쪽 세로 스크롤바를 덮어 스크롤 드래그를 뺏는다.
   그래서 별도의 fixed 레이어를 host 에 붙이고 요소 테두리에 걸치게(바깥 8px·안쪽 2px) 띄운다.
   opts: host(레이어를 담을 요소·기본 body) / enabled(지금 조절 가능한가) / min({w,h}) /
         onStart(시작 직전: 위치 고정·max 해제) / onEnd(끝난 뒤: 정리·저장) / grip(우하단 손잡이 표시)
   반환: { sync, destroy } — sync 는 대상이 움직였을 때 핸들 위치를 다시 맞춘다 */
function attachEdgeResize(target, opts){
  opts = opts || {};
  const MARGIN = 6, OUT = 8, IN = 2, CORNER = 16;
  const DIRS = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
  const call = (fn) => (typeof fn === "function" ? fn() : fn);
  const hostOf = () => call(opts.host) || document.body;
  const enabled = () => (opts.enabled ? !!call(opts.enabled) : true);
  const minSize = () => {
    const m = call(opts.min) || {};
    return { w: m.w || 200, h: m.h || 140 };
  };
  let layer = null, handles = null;
  const ensure = () => {
    // 대상이 본문을 innerHTML 로 다시 그리면 레이어만 떨어져 나갈 수 있어 붙어 있는지 확인한다
    if (layer && !layer.isConnected) hostOf().appendChild(layer);
    if (layer) return layer;
    layer = document.createElement("div");
    layer.className = "edge-resize-layer" + (opts.grip === false ? "" : " has-grip");
    layer.hidden = true;
    // body 에 붙는 경우(메모창 등) 대상보다 위로 올려야 한다. 모달은 오버레이 안이라 기본값으로 충분.
    if (opts.zIndex) layer.style.zIndex = call(opts.zIndex);
    handles = {};
    DIRS.forEach(dir => {
      const h = document.createElement("div");
      h.className = "edge-resize-handle dir-" + dir;
      h.setAttribute("aria-hidden", "true");
      h.addEventListener("pointerdown", (e) => startResize(e, dir));
      handles[dir] = h;
      layer.appendChild(h);
    });
    hostOf().appendChild(layer);
    return layer;
  };
  const sync = () => {
    if (!target.isConnected){ destroy(); return; }
    if (!enabled()){ if (layer) layer.hidden = true; return; }
    ensure().hidden = false;
    const r = target.getBoundingClientRect();
    const midW = Math.max(0, r.width - OUT * 2), midH = Math.max(0, r.height - OUT * 2);
    const put = (dir, left, top, w, h) => {
      const s = handles[dir].style;
      s.left = left + "px"; s.top = top + "px"; s.width = w + "px"; s.height = h + "px";
    };
    put("n",  r.left + OUT,  r.top - OUT,    midW,     OUT + IN);
    put("s",  r.left + OUT,  r.bottom - IN,  midW,     OUT + IN);
    put("w",  r.left - OUT,  r.top + OUT,    OUT + IN, midH);
    put("e",  r.right - IN,  r.top + OUT,    OUT + IN, midH);
    put("nw", r.left - OUT,  r.top - OUT,    CORNER,   CORNER);
    put("ne", r.right - OUT, r.top - OUT,    CORNER,   CORNER);
    put("sw", r.left - OUT,  r.bottom - OUT, CORNER,   CORNER);
    put("se", r.right - OUT, r.bottom - OUT, CORNER,   CORNER);
  };
  const startResize = (e, dir) => {
    if (!enabled()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (opts.onStart) opts.onStart();
    const start = target.getBoundingClientRect();
    target.style.width = start.width + "px";
    target.style.height = start.height + "px";
    const x0 = e.clientX, y0 = e.clientY;
    const min = minSize();
    const maxW = Math.max(min.w, window.innerWidth - MARGIN * 2);
    const maxH = Math.max(min.h, window.innerHeight - MARGIN * 2);
    document.body.classList.add("edge-resizing");
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch(_){}
    const onMove = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let w = start.width, h = start.height, left = start.left, top = start.top;
      if (dir.indexOf("e") >= 0) w = Math.min(start.width + dx, window.innerWidth - MARGIN - start.left);
      if (dir.indexOf("w") >= 0) w = Math.min(start.width - dx, start.right - MARGIN);
      if (dir.indexOf("s") >= 0) h = Math.min(start.height + dy, window.innerHeight - MARGIN - start.top);
      if (dir.indexOf("n") >= 0) h = Math.min(start.height - dy, start.bottom - MARGIN);
      w = Math.max(min.w, Math.min(w, maxW));
      h = Math.max(min.h, Math.min(h, maxH));
      if (dir.indexOf("w") >= 0) left = start.right - w;   // 반대편 모서리를 붙박아 둔다
      if (dir.indexOf("n") >= 0) top = start.bottom - h;
      target.style.left = left + "px"; target.style.top = top + "px";
      target.style.width = w + "px";   target.style.height = h + "px";
      sync();
    };
    // 포인터 캡처가 걸리면 이벤트가 핸들로 리타겟되어 document 까지 올라오므로,
    // 캡처가 안 되는 환경에서도 document 리스너면 드래그가 끊기지 않는다
    const onUp = () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.body.classList.remove("edge-resizing");
      swallowNextClick();
      if (opts.onEnd) opts.onEnd();
      sync();
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  };
  const destroy = () => {
    if (layer) layer.remove();
    layer = null; handles = null;
  };
  window.addEventListener("resize", () => requestAnimationFrame(sync));
  requestAnimationFrame(sync);
  return { sync, destroy };
}

/* ===== 떠 있는 창(메모창·화이트보드 도구상자 공용) =====
   헤더를 끌어 옮기고, 네 변·네 모서리로 크기를 조절한다. 위치·크기는 storageKey 에 저장한다.
   좌표는 늘 화면(뷰포트) 기준이다 — 무대 안에 absolute 로 놓인 창도 처음 끌 때 fixed 로 바꿔 다는데,
   그 순간의 화면 좌표를 그대로 넣으므로 눈에는 창이 움직이지 않는다(.is-floating 이 붙는다).
   opts: storageKey / min({w,h}) / locked(지금은 못 움직이는 상태인가) / bounds(가둘 범위·기본 화면 전체) /
         host(크기 조절 핸들 레이어를 담을 곳) / handle(창이 직접 그린 우하단 손잡이 그림) /
         grip(공용 손잡이 표시) / compact(좁은 화면 판정 미디어쿼리)
   반환: { clampOnOpen, destroy } */
function makeFloatingPanel(panel, head, opts){
  opts = opts || {};
  const MARGIN = 6;
  const call = (fn) => (typeof fn === "function" ? fn() : fn);
  const storageKey = opts.storageKey || "";
  const minSize = () => {
    const m = call(opts.min) || {};
    return { w: m.w || 280, h: m.h || 200 };
  };
  const compactLayout = () => {
    const query = opts.compact || "(max-width:600px), (max-height:520px)";
    try { return window.matchMedia(query).matches; }
    catch(_){ return window.innerWidth <= 600 || window.innerHeight <= 520; }
  };
  const locked = () => compactLayout() || !!call(opts.locked);
  // 창을 가둘 범위(화면 좌표). bounds 를 주면 그 안에만 — 화이트보드 도구상자는 헤더 아래 작업 영역에 둔다.
  const area = () => {
    const b = call(opts.bounds);
    if (!b) return { left:MARGIN, top:MARGIN, right:window.innerWidth - MARGIN, bottom:window.innerHeight - MARGIN };
    return { left:b.left + MARGIN, top:b.top + MARGIN, right:b.right - MARGIN, bottom:b.bottom - MARGIN };
  };
  let pinned = false;
  let edge = null;                                  // 아래에서 attachEdgeResize 로 채운다
  const syncEdge = () => { if (edge) edge.sync(); }; // 창이 움직이면 가장자리 핸들도 따라가야 한다
  const save = () => {
    if (!pinned || !storageKey || locked()) return;
    const r = panel.getBoundingClientRect();
    try { localStorage.setItem(storageKey, JSON.stringify({ left:Math.round(r.left), top:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height) })); } catch(_){}
  };
  const place = (left, top, w, h) => {
    panel.style.position = "fixed";
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    panel.style.transform = "none";
    panel.classList.add("is-floating");
    pinned = true;
  };
  const pin = () => {
    if (pinned) return;
    const r = panel.getBoundingClientRect();
    place(r.left, r.top, r.width, r.height);
  };
  const clamp = () => {
    if (!pinned || panel.hidden || locked()) return;
    const box = area();
    const min = minSize();
    let r = panel.getBoundingClientRect();
    const width = Math.min(r.width, Math.max(min.w, box.right - box.left));
    const height = Math.min(r.height, Math.max(min.h, box.bottom - box.top));
    if (Math.abs(width - r.width) > 0.5) panel.style.width = width + "px";
    if (Math.abs(height - r.height) > 0.5) panel.style.height = height + "px";
    r = panel.getBoundingClientRect();
    panel.style.left = Math.max(box.left, Math.min(r.left, box.right - r.width)) + "px";
    panel.style.top = Math.max(box.top, Math.min(r.top, box.bottom - r.height)) + "px";
    syncEdge();
  };
  if (storageKey){
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      // 예전 창 전체 최대화 저장본은 확대 전 좌표로 되돌리고, 이후에는 일반 좌표만 저장한다.
      const saved = stored && stored.max ? stored.prev : stored;
      const min = minSize();
      if (saved && saved.w >= min.w && saved.h >= min.h){
        place(saved.left, saved.top, saved.w, saved.h);
        if (stored && stored.max) localStorage.setItem(storageKey, JSON.stringify(saved));
      } else if (stored && stored.max){
        localStorage.removeItem(storageKey);
      }
    } catch(_){}
  }
  head.addEventListener("pointerdown", event => {
    if (locked() || event.target.closest("button, input, textarea, select")) return;
    event.preventDefault();
    pin();
    const rect = panel.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    head.setPointerCapture(event.pointerId);
    const move = next => {
      panel.style.left = (next.clientX - dx) + "px";
      panel.style.top = (next.clientY - dy) + "px";
      syncEdge();
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      clamp();
      save();
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  });
  // 크기 조절은 네 변·네 모서리 어디서나(모달과 같은 공용 핸들).
  edge = typeof attachEdgeResize === "function" ? attachEdgeResize(panel, {
    host: opts.host,
    enabled: () => !panel.hidden && !locked(),
    min: minSize,
    grip: opts.grip !== false,
    zIndex: opts.zIndex || (() => {
      let z = 0;
      try { z = parseInt(getComputedStyle(panel).zIndex, 10) || 0; } catch(_){}
      return (z || 130) + 1;           // 창 바로 위(테두리에 걸치는 띠라 창을 가리지 않는다)
    }),
    onStart: pin,
    onEnd: () => { clamp(); save(); }
  }) : null;
  if (opts.handle) opts.handle.style.pointerEvents = "none";
  // 창을 닫을 때(hidden) 핸들도 같이 숨기고, 열 때 다시 맞춘다
  const observer = typeof MutationObserver !== "undefined"
    ? new MutationObserver(() => requestAnimationFrame(syncEdge))
    : null;
  if (observer) observer.observe(panel, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
  const onWindowResize = () => clamp();
  window.addEventListener("resize", onWindowResize);
  return {
    clampOnOpen: () => { clamp(); syncEdge(); },
    destroy: () => {
      window.removeEventListener("resize", onWindowResize);
      if (observer) observer.disconnect();
      if (edge) edge.destroy();
    }
  };
}

/* 크기 조절·이동 직후의 click 한 번을 삼킨다.
   창에서 눌러 바깥(오버레이) 위에서 손을 떼면 click 의 공통 조상이 오버레이라
   여러 모달이 쓰는 '바깥 클릭 닫기'(e.target === modal)가 오작동한다. */
function swallowNextClick(){
  const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  document.addEventListener("click", kill, true);
  setTimeout(() => document.removeEventListener("click", kill, true), 0);
}

/* ===== 모달 이동·크기 조절 =====
   모든 .modal-card 를 헤더(빈 영역) 드래그로 이동, 네 변·네 모서리 아무 데나 잡아 크기 조절 가능하게 한다.
   - 버튼·입력·텍스트(선택용 dd 등)에서 시작한 드래그는 무시 → 본문 클릭/선택은 그대로
   - 크기 조절은 CSS resize(우하단 전용) 대신 공용 attachEdgeResize 로 8방향 핸들을 띄운다
   - 정적 모달(HTML)·동적 모달(런타임 생성) 모두 커버(MutationObserver) */
function makeCardMovable(card){
  if (!card || card.__movable) return;
  card.__movable = true;
  card.classList.add("modal-movable");
  const MIN_VISIBLE = 40;
  const EDGE_MARGIN = 6;
  const MIN_H = 140;                                              // .modal-movable 의 min-height 와 맞춘다
  const minWidth = () => Math.min(300, window.innerWidth - 12);   // 〃 min-width
  const compactLayout = () => {
    try { return window.matchMedia("(max-width:640px)").matches; }
    catch(_){ return window.innerWidth <= 640; }
  };
  const modalIsVisible = () => {
    const modal = card.closest(".modal");
    return !!card.isConnected && !card.hidden && (!modal || !modal.hidden);
  };
  // 카드를 화면 좌표에 고정한다(이동·좌/상단 리사이즈의 전제: flex 가운데 정렬을 끊어야 한다)
  const pinCard = (rect) => {
    const r = rect || card.getBoundingClientRect();
    card.style.position = "fixed";
    card.style.margin = "0";
    card.style.transform = "none";
    card.style.left = r.left + "px";
    card.style.top = r.top + "px";
    return r;
  };
  let edgeResize = null;                      // 아래에서 attachEdgeResize 로 채운다
  const syncHandles = () => { if (edgeResize) edgeResize.sync(); };
  const clampCard = (forceFullyInside=false) => {
    if (!modalIsVisible() || compactLayout()){ syncHandles(); return; }
    let rect = card.getBoundingClientRect();
    const maxWidth = Math.max(280, window.innerWidth - EDGE_MARGIN * 2);
    const maxHeight = Math.max(140, window.innerHeight - EDGE_MARGIN * 2);
    const nextWidth = Math.min(rect.width, maxWidth);
    const nextHeight = Math.min(rect.height, maxHeight);
    if (Math.abs(nextWidth - rect.width) > 0.5) card.style.width = nextWidth + "px";
    if (Math.abs(nextHeight - rect.height) > 0.5) card.style.height = nextHeight + "px";
    rect = card.getBoundingClientRect();
    const minLeft = forceFullyInside ? EDGE_MARGIN : Math.min(EDGE_MARGIN, window.innerWidth - MIN_VISIBLE - rect.width);
    const maxLeft = forceFullyInside ? window.innerWidth - rect.width - EDGE_MARGIN : window.innerWidth - MIN_VISIBLE;
    const minTop = forceFullyInside ? EDGE_MARGIN : Math.min(EDGE_MARGIN, window.innerHeight - MIN_VISIBLE - rect.height);
    const maxTop = forceFullyInside ? window.innerHeight - rect.height - EDGE_MARGIN : window.innerHeight - MIN_VISIBLE;
    const left = Math.max(minLeft, Math.min(rect.left, maxLeft));
    const top = Math.max(minTop, Math.min(rect.top, maxTop));
    if (Math.abs(left - rect.left) > 0.5 || Math.abs(top - rect.top) > 0.5){
      pinCard(rect);
      card.style.left = left + "px";
      card.style.top = top + "px";
    }
    syncHandles();
  };
  card.__clampMovableModal = clampCard;
  // 핸들 레이어는 모달 오버레이의 자식으로 둔다 → 동적 모달이 통째로 제거될 때 핸들도 같이 사라진다
  edgeResize = attachEdgeResize(card, {
    host: () => card.closest(".modal") || document.body,
    enabled: () => modalIsVisible() && !compactLayout(),
    min: () => ({ w: minWidth(), h: MIN_H }),
    onStart: () => {
      pinCard();
      // CSS 의 max-width/max-height(92vh 등)가 사용자가 정한 크기를 되돌리지 못하게 인라인으로 해제
      card.style.maxWidth = "none";
      card.style.maxHeight = "none";
    },
    onEnd: () => clampCard(false)
  });
  window.addEventListener("resize", () => requestAnimationFrame(() => clampCard(true)));
  if (typeof ResizeObserver !== "undefined"){
    const ro = new ResizeObserver(() => clampCard(false));
    ro.observe(card);
  }
  // 드래그 시작을 무시할 대상: 상호작용·텍스트 선택 영역
  const IGNORE = "button,input,textarea,select,a,canvas,label,dd,pre,code,[contenteditable],.modal-actions,.py-terminal-log,.leaflet-container,.db-erd-viewport,.db-erd-relation-detail";
  card.addEventListener("mousedown", (e) => {
    if (compactLayout()) return;
    if (e.button !== 0) return;
    if (e.target.closest(IGNORE)) return;
    const rect = pinCard();
    card.style.width = rect.width + "px";
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    e.preventDefault();
    let moved = false;
    const onMove = (ev) => {
      const liveRect = card.getBoundingClientRect();
      let x = ev.clientX - offX, y = ev.clientY - offY;
      x = Math.max(MIN_VISIBLE - liveRect.width, Math.min(x, window.innerWidth - MIN_VISIBLE));
      y = Math.max(MIN_VISIBLE - liveRect.height, Math.min(y, window.innerHeight - MIN_VISIBLE));
      card.style.left = x + "px"; card.style.top = y + "px";
      moved = true;
      syncHandles();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      // 카드에서 눌러 배경 위에서 놓으면 '바깥 클릭 닫기'가 오작동한다(리사이즈와 같은 함정)
      if (moved) swallowNextClick();
      clampCard(true);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
  // 표시/숨김·클래스 변화로도 핸들을 따라가게 한다(모달 대부분이 hidden 속성으로 열고 닫힌다)
  if (typeof MutationObserver !== "undefined"){
    const vis = new MutationObserver(() => requestAnimationFrame(syncHandles));
    vis.observe(card, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    const parentModal = card.closest(".modal");
    if (parentModal) vis.observe(parentModal, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
  }
  requestAnimationFrame(syncHandles);
}
function setupMovableModals(){
  document.querySelectorAll(".modal-card").forEach(makeCardMovable);
  if (typeof MutationObserver === "undefined") return;
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => m.addedNodes && m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.classList && n.classList.contains("modal-card")) makeCardMovable(n);
      if (n.querySelectorAll) n.querySelectorAll(".modal-card").forEach(makeCardMovable);
    }));
    muts.forEach(m => {
      if (m.type !== "attributes" || m.attributeName !== "hidden") return;
      const modal = m.target && m.target.classList && m.target.classList.contains("modal") ? m.target : null;
      if (!modal || modal.hidden) return;
      requestAnimationFrame(() => modal.querySelectorAll(".modal-card").forEach(card => {
        if (typeof card.__clampMovableModal === "function") card.__clampMovableModal(true);
      }));
    });
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

/* ===== 단일 탭 가드 =====
   같은 origin(고정 포트)으로 여러 탭/창이 동시에 뜨면 자동저장(작업공간·탭 순서)이 서로 덮어쓰는 충돌이 난다.
   localStorage 하트비트로 '한 번에 한 창만 활성'을 보장한다. 새로 연 창이 활성권을 가져가고(takeover),
   기존 창은 안내 오버레이로 잠시 멈춘다. 활성 창이 닫히면 남은 창이 자동으로 이어받는다. */
function setupSingleTab(){
  const KEY = "classdock:active-tab";
  const myId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  let amActive = false, overlay = null;
  const readActive = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch(_){ return null; } };
  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement("div"); overlay.className = "single-tab-overlay"; overlay.hidden = true;
    const box = document.createElement("div"); box.className = "single-tab-box";
    const h = document.createElement("h2"); h.textContent = "다른 창에서 사용 중이에요";
    const p = document.createElement("p"); p.innerHTML = "같은 앱이 다른 탭·창에서 열려 있어, 이 창은 잠시 멈췄어요.<br>저장 충돌을 막기 위해 한 번에 한 창만 활성화됩니다.";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "single-tab-take"; btn.textContent = "이 창에서 계속하기";
    btn.addEventListener("click", claim);
    box.append(h, p, btn); overlay.appendChild(box); document.body.appendChild(overlay);
    return overlay;
  };
  const setActive = (active) => {
    amActive = active; window.__tabActive = active;
    ensureOverlay().hidden = active;
    document.body.classList.toggle("tab-passive", !active);
  };
  const beat = () => { if (amActive){ try { localStorage.setItem(KEY, JSON.stringify({ id: myId, ts: Date.now() })); } catch(_){} } };
  function claim(){ setActive(true); beat(); }      // 활성권 잡기(다른 탭은 storage 이벤트로 passive 전환)
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !amActive) return;
    const v = readActive();
    if (v && v.id && v.id !== myId) setActive(false);   // 다른 탭이 새로 잡음 → 나는 멈춤
  });
  setInterval(() => {
    if (amActive){ beat(); return; }
    const v = readActive();
    if (!v || (Date.now() - (v.ts || 0)) > 6000) claim();   // 활성 창이 사라짐(하트비트 끊김) → 자동 이어받기
  }, 2500);
  window.addEventListener("beforeunload", () => { const v = readActive(); if (amActive && v && v.id === myId){ try { localStorage.removeItem(KEY); } catch(_){} } });
  claim();                                          // 로드 시 takeover
}
wire();
{
  const importedBackup = typeof MNBackup !== "undefined" && MNBackup.hasPendingRestore();
  Promise.resolve(restoreLastWorkspace(importedBackup)).then((restoreResult) => {
    finalizeWorkspaceRestore(restoreResult);
    if (importedBackup) MNBackup.finishPendingRestore();
  }, () => {
    finalizeWorkspaceRestore({ attempted:true, restored:false, failed:true });
    if (importedBackup) MNBackup.finishPendingRestore();
  });
}
