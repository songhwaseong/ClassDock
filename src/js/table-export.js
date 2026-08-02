"use strict";

/* 표 블록을 바깥으로 꺼내는 공용 모듈 — MNTableExport.
   메모창(scratchpad)과 블록 문서(mnote)의 표 블록은 모양이 같아서
   ({ rows:[["셀",…],…], header:true|false }) 꺼내는 규칙을 여기 한 곳에만 둔다.
   저장·복사·새 탭은 앱에 이미 있는 경로를 그대로 재사용한다:
     - 복사   : copyDocumentMenuText (문서 우클릭 메뉴와 같은 클립보드 폴백)
     - CSV    : saveTextDoc (EXE=작업 폴더 저장, 브라우저=위치 선택 → 다운로드 폴백)
     - 편집기 : handleFiles (CSV→XLSX 변환 탭과 같은 방식)
   메모·문서 자체의 저장 상태는 절대 건드리지 않는다(saveTextDoc 에 doc 을 넘기지 않는 이유). */
const MNTableExport = (() => {
  const CSV_MIME = "text/csv;charset=utf-8";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const BOM = "﻿";                       // 엑셀에서 UTF-8 한글이 깨지지 않도록(다른 CSV 내보내기와 동일)

  // 어떤 표 블록이든 직사각형 문자열 배열로 눕힌다(짧은 행은 빈 셀로 채움).
  function rowsOf(block){
    const raw = (block && Array.isArray(block.rows)) ? block.rows : [];
    const rows = raw.filter(Array.isArray).map(row => row.map(cell => String(cell == null ? "" : cell)));
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    for (const row of rows) while (row.length < width) row.push("");
    return rows;
  }

  const hasContent = (block) => rowsOf(block).some(row => row.some(cell => cell.trim()));

  // 탭·줄바꿈이 셀 안에 있으면 TSV 격자가 무너진다 — 붙여넣기 때와 같이 공백으로 눕힌다.
  const flatten = (value) => String(value).replace(/[\t\r\n]+/g, " ");

  // RFC 4180: 쉼표·따옴표·줄바꿈이 든 셀만 인용하고, 안의 따옴표는 두 번 쓴다.
  function csvCell(value){
    const text = String(value == null ? "" : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(block){
    return rowsOf(block).map(row => row.map(csvCell).join(",")).join("\r\n");
  }

  function toTsv(block){
    return rowsOf(block).map(row => row.map(flatten).join("\t")).join("\n");
  }

  function sanitizeName(value){
    return String(value == null ? "" : value)
      .replace(/[\\/:*?"<>|\r\n]/g, "").trim().replace(/[. ]+$/g, "").slice(0, 80) || "표";
  }

  // 블록 문서 파일명에서 실제 원본 확장자만 벗긴다. 제목 안의 점(예: "2.5학기")은 보존한다.
  const stripSourceExtension = value => String(value == null ? "" : value).replace(/\.mnote$/i, "");

  // "메모 이름 표" — 한 메모·문서에 표가 여럿이면 "메모 이름 표2" 처럼 번호를 붙인다.
  function suggestBase(name, index, total){
    return sanitizeName(stripSourceExtension(name)) + " 표" + ((total | 0) > 1 ? String((index | 0) + 1) : "");
  }

  const fileName = (base, ext) => sanitizeName(base) + "." + ext;

  function siblingWorkspacePath(doc, name){
    const source = String((doc && (doc.workspacePath || doc.relPath)) || "")
      .replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = source.lastIndexOf("/");
    return slash >= 0 ? source.slice(0, slash + 1) + name : name;
  }

  const notifyWith = (opts) => (typeof opts.notify === "function" ? opts.notify : () => {});
  const warn = (message, opts) => {
    notifyWith(opts)(message);
    if (typeof toast === "function") toast(message, 2400);
    return false;
  };

  // copyDocumentMenuText 가 없을 때(부분 로드·테스트)를 위한 최소 폴백.
  async function fallbackCopy(text){
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch(_){ }
    try {
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return !!ok;
    } catch(_){ return false; }
  }

  function download(text, name, mime){
    try {
      const url = URL.createObjectURL(new Blob([text], { type:mime }));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch(e){ console.warn("table export download failed:", e); return false; }
  }

  /* 표를 탭 구분(TSV)으로 복사 — 엑셀·한글·구글시트에 그대로 붙는다.
     파일을 만들지 않아 수업 중 가장 빠른 길이라 CSV 저장보다 앞에 둔다. */
  async function copyTable(block, opts={}){
    if (!hasContent(block)) return warn("표가 비어 있어요.", opts);
    const text = toTsv(block);
    const ok = (typeof copyDocumentMenuText === "function")
      ? await copyDocumentMenuText(text, "표를 복사했어요. 엑셀·한글에 붙여넣어 보세요.")
      : await fallbackCopy(text);
    notifyWith(opts)(ok ? "표를 복사했어요." : "복사하지 못했어요.");
    return ok;
  }

  /* 표를 CSV 파일로 저장. doc 을 넘기지 않으므로(=null) 메모·블록 문서의
     저장 상태(savedText·dirty)는 이 저장에 영향을 받지 않는다. */
  async function saveCsv(block, opts={}){
    if (!hasContent(block)) return warn("내보낼 내용이 없어요.", opts);
    const name = fileName(opts.baseName || "표", "csv");
    const text = BOM + toCsv(block);
    let ok = false;
    if (typeof saveTextDoc === "function") ok = (await saveTextDoc(text, null, name)) === true;
    else ok = download(text, name, CSV_MIME);
    notifyWith(opts)(ok ? "CSV로 내보냈어요." : "CSV로 내보내지 못했어요.");
    return ok;
  }

  /* 표의 복사본을 새 탭의 표 편집기(xlsx)로 연다.
     복사본이라 편집기에서 고친 값은 메모·문서로 돌아오지 않는다(버튼 설명에 명시). */
  async function openInEditor(block, opts={}){
    const rows = rowsOf(block);
    if (!rows.length || !hasContent(block)) return warn("표가 비어 있어요.", opts);
    if (typeof handleFiles !== "function") return warn("표 편집기를 열 수 없어요.", opts);
    if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("xlsx");
    if (typeof XLSX === "undefined") return warn("Excel 라이브러리를 불러오지 못했어요.", opts);
    const name = fileName(opts.baseName || "표", "xlsx");
    try {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
      const out = XLSX.write(wb, { type:"array", bookType:"xlsx" });
      const doc = opts.doc || null;
      await handleFiles([new File([out], name, { type:XLSX_MIME })], {
        isScratch:true,                                    // 아직 디스크에 없는 새 파일 → 첫 저장 때 이름·위치를 받는다
        workspacePath:siblingWorkspacePath(doc, name),
        parentId:(doc && doc.parentId) || null,
        fsDirHandle:(doc && doc.fsDirHandle) || null       // 원본과 같은 폴더에 저장되도록 폴더 문맥만 물려준다
      });
    } catch(e){
      console.error(e);
      return warn("표 편집기로 열지 못했어요.", opts);
    }
    notifyWith(opts)("표 편집기 탭에 복사본을 열었어요.");
    return true;
  }

  return { rowsOf, hasContent, toCsv, toTsv, suggestBase, fileName, siblingWorkspacePath, copyTable, saveCsv, openInEditor };
})();

if (typeof module !== "undefined" && module.exports){
  module.exports = MNTableExport;
}
