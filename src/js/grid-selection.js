"use strict";

/* 표 선택 로직 — 스프레드시트 뷰어와 DB 클라이언트 결과 표가 함께 쓴다.
 *
 * DOM 을 모르는 순수 계산만 둔다. 화면에 어떻게 칠할지는 쓰는 쪽이 정하고(스프레드시트는
 * 캔버스, DB 결과 표는 <table>), 여기서는 "어느 칸이 선택됐는가"만 셈한다.
 *
 * 칸 하나를 `행 * 열수 + 열` 정수 하나(key)로 눌러 담는다. Set 하나로 흩어진 선택까지
 * 표현할 수 있어 Ctrl 추가 선택·빼기 선택이 특별한 경우가 되지 않는다.
 *
 * 클립보드로 오가는 셈(내보낼 글자·읽어 들인 격자·붙여넣을 자리)도 여기 둔다. 두 표가
 * 서로 복사·붙여넣기를 하므로 규칙이 갈라지면 한쪽에서 복사한 것이 다른 쪽에서 어긋난다.
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
    // 탭·줄바꿈·따옴표가 든 값은 TSV 규칙으로 감싼다. 그대로 이어 붙이면 이 함수를
    // gridClipboardTable 로 되읽을 때 한 칸이 여러 행·열로 갈리거나 따옴표가 사라진다.
    const clipboardCell = (value) => {
      const text = String(value == null ? "" : value);
      return /["\t\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const lines = [];
    for (let r = bounds.row1; r <= bounds.row2; r++){
      const cells = [];
      for (let c = bounds.col1; c <= bounds.col2; c++)
        cells.push(keys.has(r * maxCols + c) ? clipboardCell(cellText(r, c)) : "");
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  }

  /* 클립보드 글자(엑셀·구글시트·이 앱의 표에서 복사한 것)를 2차원 배열로 읽는다.
     탭=열, 줄바꿈=행. 큰따옴표로 감싼 칸 안에는 탭·줄바꿈·`""`(이스케이프)가 들어올 수 있다.
     gridSelectionToText 가 내보내는 형식을 그대로 되읽는 짝이라 같은 자리에 둔다. */
  function gridClipboardTable(text){
    const source = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [], field = "", quoted = false, i = 0;
    while (i < source.length){
      const ch = source[i];
      if (quoted){
        if (ch === '"'){
          if (source[i + 1] === '"'){ field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      // 큰따옴표는 칸의 첫 글자일 때만 인용 부호다. 중간에 나온 따옴표까지 문법으로
      // 삼으면 외부 앱에서 온 `He said "hi"` 같은 평문이 조용히 변형된다.
      if (ch === '"' && field === ""){ quoted = true; i++; continue; }
      if (ch === "\t"){ row.push(field); field = ""; i++; continue; }
      if (ch === "\n"){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    row.push(field); rows.push(row);
    // 마지막 줄바꿈이 만든 빈 행(단일 빈 칸) 제거
    if (rows.length > 1){
      const last = rows[rows.length - 1];
      if (last.length === 1 && last[0] === "") rows.pop();
    }
    return rows;
  }

  /* 붙여넣은 격자를 표의 칸 자리에 맞춘다. 화면을 모르는 순수 계산이다.

     칸 하나만 복사했으면 고른 칸 전부를 그 값으로 채운다(엑셀과 같은 규칙).
     그 밖에는 anchor(고른 범위의 좌상단)부터 격자 크기만큼 채우고, 표 밖으로 넘친 행·열은
     버린 수만 돌려준다 — 결과 표의 행은 서버의 행이지 시트의 칸이 아니라 늘릴 수 없다.
       grid   : 붙여넣을 격자(string[][])
       anchor : { row, col } 채우기 시작 자리
       size   : { rows, cols } 표의 크기
       spots  : 채우기 모드에서 채울 칸 목록([{row,col}], 흩어진 선택도 그대로) */
  function gridPastePlan(grid, anchor, size, spots){
    const cells = [];
    const rows = Array.isArray(grid) ? grid : [];
    const height = size && size.rows > 0 ? size.rows : 0;
    const width = size && size.cols > 0 ? size.cols : 0;
    const single = rows.length === 1 && rows[0].length === 1;
    if (single && spots && spots.length){
      const value = rows[0][0];
      spots.forEach((spot) => {
        if (spot.row >= 0 && spot.row < height && spot.col >= 0 && spot.col < width)
          cells.push({ row:spot.row, col:spot.col, value });
      });
      cells.sort((left, right) => (left.row - right.row) || (left.col - right.col));
      return { cells, fill:true, overflowRows:0, overflowCols:0 };
    }
    if (!anchor) return { cells, fill:false, overflowRows:0, overflowCols:0 };
    let overflowRows = 0, overflowCols = 0;
    for (let r = 0; r < rows.length; r++){
      const row = anchor.row + r;
      if (row >= height){ overflowRows = rows.length - r; break; }
      const line = rows[r] || [];
      for (let c = 0; c < line.length; c++){
        const col = anchor.col + c;
        if (col >= width){ overflowCols = Math.max(overflowCols, line.length - c); break; }
        cells.push({ row, col, value:line[c] });
      }
    }
    return { cells, fill:false, overflowRows, overflowCols };
  }

  return {
    gridSelectionDragHitPoint, gridSelectionRangeKeys, gridSelectionRangeCovered,
    gridSelectionCombineKeys, gridSelectionBoundsFromKeys, gridSelectionRangeBetween,
    gridSelectionToText, gridClipboardTable, gridPastePlan
  };
})();

if (typeof module === "object" && module.exports) module.exports = MNGridSelection;
