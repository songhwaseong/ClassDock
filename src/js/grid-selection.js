"use strict";

/* 표 선택 로직 — 스프레드시트 뷰어와 DB 클라이언트 결과 표가 함께 쓴다.
 *
 * DOM 을 모르는 순수 계산만 둔다. 화면에 어떻게 칠할지는 쓰는 쪽이 정하고(스프레드시트는
 * 캔버스, DB 결과 표는 <table>), 여기서는 "어느 칸이 선택됐는가"만 셈한다.
 *
 * 칸 하나를 `행 * 열수 + 열` 정수 하나(key)로 눌러 담는다. Set 하나로 흩어진 선택까지
 * 표현할 수 있어 Ctrl 추가 선택·빼기 선택이 특별한 경우가 되지 않는다.
 */
const MNGridSelection = (() => {

  // 행·열 머리에서 시작한 선택은 포인터가 좁은 머리 띠를 벗어나도 시작 축을 유지한다.
  // elementFromPoint 에 넘길 좌표를 그 축으로 투영해 행 선택은 Y, 열 선택은 X 만 따라가게 한다.
  function gridSelectionDragHitPoint(kind, point, sheetRect, cornerRect, colRect){
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    let x = clamp(point.x, sheetRect.left + 2, sheetRect.right - 2);
    let y = clamp(point.y, sheetRect.top + 2, sheetRect.bottom - 2);
    if (kind === "row"){
      x = clamp(cornerRect.left + 2, sheetRect.left + 2, sheetRect.right - 2);
      y = Math.max(y, Math.min(sheetRect.bottom - 2, colRect.bottom + 2));
    } else if (kind === "col"){
      x = Math.max(x, Math.min(sheetRect.right - 2, cornerRect.right + 2));
      y = clamp(colRect.top + 2, sheetRect.top + 2, sheetRect.bottom - 2);
    } else if (kind === "cell"){
      x = Math.max(x, Math.min(sheetRect.right - 2, cornerRect.right + 2));
      y = Math.max(y, Math.min(sheetRect.bottom - 2, colRect.bottom + 2));
    }
    return { x, y };
  }

  function gridSelectionRangeKeys(range, maxCols){
    const keys = new Set();
    if (!range || !(maxCols > 0)) return keys;
    for (let r = range.row1; r <= range.row2; r++)
      for (let c = range.col1; c <= range.col2; c++) keys.add(r * maxCols + c);
    return keys;
  }

  function gridSelectionRangeCovered(keys, range, maxCols){
    if (!keys || !range) return false;
    for (let r = range.row1; r <= range.row2; r++)
      for (let c = range.col1; c <= range.col2; c++)
        if (!keys.has(r * maxCols + c)) return false;
    return true;
  }

  function gridSelectionCombineKeys(baseKeys, range, mode, maxCols){
    const result = new Set(mode === "replace" ? [] : (baseKeys || []));
    const rangeKeys = gridSelectionRangeKeys(range, maxCols);
    rangeKeys.forEach(key => {
      if (mode === "subtract") result.delete(key);
      else result.add(key);
    });
    return result;
  }

  function gridSelectionBoundsFromKeys(keys, maxCols){
    if (!keys || !keys.size || !(maxCols > 0)) return null;
    let row1 = Infinity, row2 = -Infinity, col1 = Infinity, col2 = -Infinity;
    keys.forEach(key => {
      const row = Math.floor(key / maxCols), col = key % maxCols;
      if (row < row1) row1 = row;
      if (row > row2) row2 = row;
      if (col < col1) col1 = col;
      if (col > col2) col2 = col;
    });
    const area = (row2 - row1 + 1) * (col2 - col1 + 1);
    return { row1, row2, col1, col2, contiguous:keys.size === area, count:keys.size };
  }

  // 두 칸을 잡아 정규화한 사각 범위. 어느 쪽을 먼저 눌렀든 같은 범위가 나온다.
  function gridSelectionRangeBetween(anchor, focus){
    if (!anchor || !focus) return null;
    return {
      row1: Math.min(anchor.row, focus.row), row2: Math.max(anchor.row, focus.row),
      col1: Math.min(anchor.col, focus.col), col2: Math.max(anchor.col, focus.col)
    };
  }

  /* 선택한 칸을 붙여 넣기 좋은 글자로 옮긴다(탭으로 열, 줄바꿈으로 행 — 엑셀·시트가 읽는 형식).
     흩어진 선택도 사각형으로 감싸 옮기되, 선택하지 않은 칸은 빈칸으로 둔다 — 고르지 않은
     값을 끼워 넣으면 붙여 넣은 쪽에서 그 사실을 알 수 없다.
     cellText(row, col) 은 그 칸의 글자를 돌려준다(없으면 빈 문자열). */
  function gridSelectionToText(keys, maxCols, cellText){
    const bounds = gridSelectionBoundsFromKeys(keys, maxCols);
    if (!bounds) return "";
    const lines = [];
    for (let r = bounds.row1; r <= bounds.row2; r++){
      const cells = [];
      for (let c = bounds.col1; c <= bounds.col2; c++)
        cells.push(keys.has(r * maxCols + c) ? String(cellText(r, c) == null ? "" : cellText(r, c)) : "");
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  }

  return {
    gridSelectionDragHitPoint, gridSelectionRangeKeys, gridSelectionRangeCovered,
    gridSelectionCombineKeys, gridSelectionBoundsFromKeys, gridSelectionRangeBetween,
    gridSelectionToText
  };
})();

if (typeof module === "object" && module.exports) module.exports = MNGridSelection;
