"use strict";

const MNInteractionCore = (() => {
  const INTERNAL_DRAG_MIME = "application/x-manneung-internal-drag";

  function studyPaneSelectionAction(referenceId, workId, targetPane, selectedId) {
    const split = referenceId != null && workId != null && referenceId !== workId;
    if (!split) return "activate";
    const pane = targetPane === "reference" ? "reference" : "work";
    const targetId = pane === "reference" ? referenceId : workId;
    if (selectedId === referenceId || selectedId === workId)
      return selectedId === targetId ? "keep" : "swap";
    return pane === "reference" ? "replace-reference" : "replace-work";
  }
  
  // 분할바 가운데 종료 버튼 — 남길(마지막에 클릭한 타깃) 칸의 문서 id 를 돌려준다. 분할이 아니면 null.
  function studySplitEndKeepId(referenceId, workId, targetPane) {
    const split = referenceId != null && workId != null && referenceId !== workId;
    if (!split) return null;
    return targetPane === "reference" ? referenceId : workId;
  }
  
  // 화면에서 본 첫 칸(왼쪽/위쪽)이 어느 역할인지. 위치 바꾸기(swapped)면 자리가 뒤집힌다.
  function splitDropRoleForSide(side, swapped) {
    const first = side === "left" || side === "top";
    return first !== !!swapped ? "reference" : "work";
  }
  
  // 드롭 안내의 시각적 경계와 실제 판정이 같은 분할 비율을 사용하도록 순수 계산으로 분리한다.
  function splitDropSideAtPoint(clientX, clientY, rect, stacked, splitRatio=0.5) {
    const ratio = Number.isFinite(Number(splitRatio))
      ? Math.max(0, Math.min(1, Number(splitRatio)))
      : 0.5;
    if (stacked) return clientY < rect.top + rect.height * ratio ? "top" : "bottom";
    return clientX < rect.left + rect.width * ratio ? "left" : "right";
  }
  
  // 상단 탭을 본문 칸에 끌어다 놓았을 때 수행할 상태 전이를 DOM과 분리해 결정한다.
  // mateId 는 분할 진입 시 반대편에 세울 짝(직전에 보던 문서)이며, 없으면 null.
  function tabDropSplitAction(referenceId, workId, role, draggedId, mateId) {
    const split = referenceId != null && workId != null && referenceId !== workId;
    if (role === "reference") {
      if (draggedId === referenceId) return "keep";
      if (split) return draggedId === workId ? "swap" : "replace-reference";
      if (draggedId === workId) return mateId != null ? "pin-with-mate" : "pin-only";
      return "replace-reference";
    }
    if (split) {
      if (draggedId === workId) return "keep";
      if (draggedId === referenceId) return "swap";
      return "replace-work";
    }
    if (draggedId === workId) return mateId != null ? "mate-as-reference" : "keep";
    return "pin-current";
  }
  
  // 폴더 드롭에서는 브라우저가 DataTransfer.items만 채우고 files는 비워 둘 수 있다.
  function dataTransferHasFileItems(dataTransfer) {
    if (!dataTransfer) return false;
    if (dataTransfer.files && dataTransfer.files.length) return true;
    const items = dataTransfer.items;
    if (!items || !items.length) return false;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i] && items[i].kind === "file") return true;
    }
    return false;
  }
  
  function isInternalDragTransfer(dataTransfer, fallbackActive=false) {
    let types = [];
    try { types = dataTransfer && dataTransfer.types ? [...dataTransfer.types] : []; } catch (_) {}
    if (types.includes(INTERNAL_DRAG_MIME)) return true;
    // 외부 파일·폴더는 stale 된 내부 플래그보다 항상 우선한다.
    return !!fallbackActive && !types.includes("Files");
  }
  
  function droppedTransferNeedsFolderPicker(dataTransfer, files) {
    const batch = files ? [...files] : [];
    let fileItems = [];
    try {
      fileItems = dataTransfer && dataTransfer.items
        ? [...dataTransfer.items].filter(item => item && item.kind === "file")
        : [];
    } catch (_) {}
    if (!batch.length) return fileItems.length > 0;
    if (batch.length !== 1 || fileItems.length > 1) return false;
    const file = batch[0];
    return !!file && Number(file.size) === 0 && !String(file.type || "");
  }
  
  // 드롭 항목은 이벤트가 끝난 뒤 무효화될 수 있으므로 엔트리와 핸들 Promise를 즉시 확보한다.
  function captureDroppedFileItems(dataTransfer) {
    const files = dataTransfer && dataTransfer.files ? [...dataTransfer.files] : [];
    const items = dataTransfer && dataTransfer.items ? [...dataTransfer.items] : [];
    const entries = [];
    const handlePromises = [];
    for (const item of items) {
      if (!item || item.kind !== "file") continue;
      const getEntry = typeof item.getAsEntry === "function"
        ? item.getAsEntry
        : (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry : null);
      let entry = null;
      try { entry = getEntry ? getEntry.call(item) : null; } catch (_) {}
      if (entry) entries.push(entry);
      if (typeof item.getAsFileSystemHandle === "function") {
        try {
          handlePromises.push(Promise.resolve(item.getAsFileSystemHandle()).catch(() => null));
        } catch (_) {
          handlePromises.push(Promise.resolve(null));
        }
      }
    }
    return { files, entries, handlePromises };
  }
  
  // 참고 잠금 중 포인터 입력은 읽기·선택 표면만 통과시킨다.
  // 표는 한 번 클릭 선택까지만 허용하고, 편집 진입인 더블클릭·메뉴는 차단한다.
  function studyReadonlyPointerAllowed(surface, eventType) {
    if (surface === "content" || surface === "text-selection" || surface === "code-link") return true;
    if (surface === "sheet-selection") return eventType === "pointerdown" || eventType === "click";
    return false;
  }
  
  // 참고 잠금 중 텍스트 선택·복사와 문서 탐색에 필요한 키만 허용한다.
  function studyReadonlyKeyAllowed(eventLike={}) {
    const key = String(eventLike.key || "").toLowerCase();
    if ((eventLike.ctrlKey || eventLike.metaKey) && ["a", "c", "f", "g"].includes(key)) return true;
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "pageup", "pagedown", "home", "end", "escape", "tab", "f3"].includes(key)) return true;
    return key === " " && !eventLike.textEntry && !eventLike.activationControl;
  }

  return {
    studyPaneSelectionAction, studySplitEndKeepId, splitDropRoleForSide, splitDropSideAtPoint, tabDropSplitAction, dataTransferHasFileItems, isInternalDragTransfer, droppedTransferNeedsFolderPicker, captureDroppedFileItems, studyReadonlyPointerAllowed, studyReadonlyKeyAllowed, INTERNAL_DRAG_MIME
  };
})();

if (typeof module === "object" && module.exports) module.exports = MNInteractionCore;
