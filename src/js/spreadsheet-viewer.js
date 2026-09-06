"use strict";

/* 한컴 한셀(HCell) 등 비표준 생성기는 sharedStrings/styles 에 mc:AlternateContent 로
   한컴 전용 확장(hs:)을 끼워넣는데, SheetJS 가 이를 만나면 데이터 시트를 통째로 비워버린다.
   → AlternateContent 를 표준 호환 버전(mc:Fallback)만 남기고 한컴 확장(mc:Choice)은 제거한다.
     (블록을 통째로 지우지 않으므로 스타일 인덱스와 글자 서식이 보존된다.) */
function sanitizeHancomSpreadsheet(bytes){
  if (typeof JSZip === "undefined") return bytes;
  const unwrapAltContent = (xml) =>
    xml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, (block) => {
      const fb = block.match(/<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/);
      return fb ? fb[1] : "";                       // Fallback 없으면 블록 제거
    });
  try {
    const zip = new JSZip(bytes);
    let changed = false;
    ["xl/sharedStrings.xml", "xl/styles.xml"].forEach((path) => {
      const entry = zip.file(path);
      if (!entry) return;
      const xml = entry.asText();
      const fixed = unwrapAltContent(xml);
      if (fixed !== xml){ zip.file(path, fixed); changed = true; }
    });
    if (!changed) return bytes;
    return zip.generate({ type: "uint8array", compression: "STORE" });  // 재압축 생략(속도)
  } catch(e){
    console.warn("xlsx sanitize skipped:", e);
    return bytes;
  }
}

/* 일부 OOXML 생성기는 SpreadsheetML 요소를 <x:workbook>, <x:worksheet>처럼 접두사로 쓴다.
   XML 규격에는 맞지만 ExcelJS는 이 형식을 읽지 못하므로, 실패한 경우에만 기본 네임스페이스
   형태로 좁게 정규화한 뒤 다시 연다. 시트 그림도 ExcelJS 모델을 통해 읽으므로 같은 보정이 필요하다. */
function spreadsheetNormalizeXlsxNamespaces(bytes, ZipCtor){
  const Ctor = ZipCtor || (typeof JSZip !== "undefined" ? JSZip : null);
  if (!Ctor) return bytes;
  const spreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  try {
    const zip = new Ctor(bytes);
    let changed = false;
    Object.keys(zip.files || {}).forEach(path => {
      if (!/\.xml$/i.test(path) || /\/_rels\//i.test(path)) return;
      const entry = zip.file(path);
      if (!entry) return;
      const xml = entry.asText();
      const root = xml.match(/<([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\b[^>]*\bxmlns:\1\s*=\s*(["'])http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main\2/i);
      if (!root) return;
      const prefix = root[1];
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const namespacePattern = spreadsheetNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const declaration = new RegExp("\\s+xmlns:" + escaped + "\\s*=\\s*([\\\"'])" + namespacePattern + "\\1", "i");
      const hasDefaultNamespace = new RegExp("\\s+xmlns\\s*=\\s*([\\\"'])" + namespacePattern + "\\1", "i").test(xml);
      let fixed = xml.replace(new RegExp("(<\\/?)" + escaped + ":", "g"), "$1");
      fixed = hasDefaultNamespace
        ? fixed.replace(declaration, "")
        : fixed.replace(declaration, match => match.replace(new RegExp("xmlns:" + escaped, "i"), "xmlns"));
      if (fixed !== xml){ zip.file(path, fixed); changed = true; }
    });
    return changed ? zip.generate({ type:"uint8array", compression:"STORE" }) : bytes;
  } catch(error){
    console.warn("xlsx namespace normalization skipped:", error);
    return bytes;
  }
}

async function spreadsheetLoadExcelWorkbook(bytes, ExcelCtor, ZipCtor){
  const Excel = ExcelCtor || (typeof ExcelJS !== "undefined" ? ExcelJS : null);
  if (!Excel || !bytes) return null;
  let workbook = new Excel.Workbook();
  try {
    await workbook.xlsx.load(bytes);
    return workbook;
  } catch(originalError){
    const fixed = spreadsheetNormalizeXlsxNamespaces(bytes, ZipCtor);
    if (fixed === bytes) throw originalError;
    workbook = new Excel.Workbook();
    await workbook.xlsx.load(fixed);
    return workbook;
  }
}

/* 한셀 등이 비정상적으로 부풀려 저장한 시트 크기(!ref)를 실제 값이 있는 범위로 줄인다.
   안 그러면 sheet_to_html 이 수십만~수백만 개의 빈 셀을 그리느라 화면이 멈춘다. */
function tightenSheetRange(ws){
  if (!ws || !ws["!ref"]) return;
  let maxR = -1, maxC = -1;
  for (const k in ws){
    if (k.charCodeAt(0) === 33) continue;                       // "!" 로 시작하는 메타 키 제외
    const c = ws[k];
    if (c == null || ((c.v === undefined || c.v === "") && !c.f)) continue; // 값/수식이 있는 셀만 집계
    const a = XLSX.utils.decode_cell(k);
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  if (maxR < 0){ ws["!ref"] = "A1"; return; }
  const declared = XLSX.utils.decode_range(ws["!ref"]);
  if (maxR < declared.e.r || maxC < declared.e.c){             // 줄어들 때만 갱신
    ws["!ref"] = XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r:maxR, c:maxC } });
    if (Array.isArray(ws["!merges"]))
      ws["!merges"] = ws["!merges"].filter(m => m.s.r <= maxR && m.s.c <= maxC);
  }
}

const SPREADSHEET_IMAGE_MIMES = {
  png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp",
  bmp:"image/bmp", ico:"image/x-icon", tif:"image/tiff", tiff:"image/tiff"
};

function spreadsheetImageMime(extension){
  return SPREADSHEET_IMAGE_MIMES[String(extension || "").replace(/^\./, "").toLowerCase()] || "application/octet-stream";
}

function spreadsheetDecodeCellAddress(address){
  const match = String(address || "").toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { r:Number(match[2]) - 1, c:col - 1 };
}

function spreadsheetXmlDecode(value){
  return String(value == null ? "" : value)
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function spreadsheetXmlAttr(tag, name){
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag || "").match(new RegExp("(?:^|\\s)" + escaped + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
  return match ? spreadsheetXmlDecode(match[2]) : "";
}

function spreadsheetXmlTags(xml, name){
  const re = new RegExp("<(?:[A-Za-z_][\\w.-]*:)?" + name + "\\b[^>]*\\/?>", "gi");
  return String(xml || "").match(re) || [];
}

function spreadsheetXmlBlocks(xml, name){
  const re = new RegExp("<((?:[A-Za-z_][\\w.-]*:)?" + name + ")\\b([^>]*)>([\\s\\S]*?)<\\/\\1\\s*>", "gi");
  const blocks = [];
  let match;
  while ((match = re.exec(String(xml || "")))) blocks.push({ tag:"<" + match[1] + match[2] + ">", inner:match[3] });
  return blocks;
}

function spreadsheetPackagePath(basePart, target){
  const raw = String(target || "").replace(/\\/g, "/");
  if (!raw) return "";
  const pieces = (raw[0] === "/" ? raw.slice(1) : String(basePart || "").replace(/\/[^/]*$/, "/") + raw).split("/");
  const out = [];
  pieces.forEach(piece => {
    if (!piece || piece === ".") return;
    if (piece === "..") out.pop(); else out.push(piece);
  });
  return out.join("/");
}

function spreadsheetPackageRelsPath(partPath){
  const path = String(partPath || "").replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  return path.slice(0, slash + 1) + "_rels/" + path.slice(slash + 1) + ".rels";
}

function spreadsheetZipText(zip, path){
  try { const entry = zip && zip.file(path); return entry ? entry.asText() : ""; }
  catch(_){ return ""; }
}

function spreadsheetRelationshipMap(zip, partPath){
  const xml = spreadsheetZipText(zip, spreadsheetPackageRelsPath(partPath));
  const map = new Map();
  spreadsheetXmlTags(xml, "Relationship").forEach(tag => {
    const id = spreadsheetXmlAttr(tag, "Id");
    if (!id) return;
    map.set(id, {
      target:spreadsheetPackagePath(partPath, spreadsheetXmlAttr(tag, "Target")),
      type:spreadsheetXmlAttr(tag, "Type"), external:/^external$/i.test(spreadsheetXmlAttr(tag, "TargetMode"))
    });
  });
  return map;
}

function spreadsheetFindPackagePart(zip, folder, rootName){
  const prefix = String(folder || "").replace(/\\/g, "/").replace(/\/?$/, "/");
  const root = new RegExp("<\\s*(?:[A-Za-z_][\\w.-]*:)?" + rootName + "\\b", "i");
  for (const path of Object.keys(zip && zip.files || {})){
    if (!path.startsWith(prefix) || !/\.xml$/i.test(path) || /\/_rels\//i.test(path)) continue;
    const text = spreadsheetZipText(zip, path);
    if (root.test(text)) return { path, text };
  }
  return null;
}

function spreadsheetPackageSheetParts(zip){
  const workbookPath = "xl/workbook.xml";
  const workbookXml = spreadsheetZipText(zip, workbookPath);
  const rels = spreadsheetRelationshipMap(zip, workbookPath);
  const result = [];
  spreadsheetXmlTags(workbookXml, "sheet").forEach(tag => {
    const id = spreadsheetXmlAttr(tag, "r:id") || spreadsheetXmlAttr(tag, "id");
    const rel = rels.get(id);
    if (rel && rel.target) result.push({ name:spreadsheetXmlAttr(tag, "name"), path:rel.target });
  });
  return result;
}

/* Excel 365의 '셀에 배치' 그림은 drawing 이 아니라 Rich Value 메타데이터로 저장된다.
   SheetJS/ExcelJS가 셀 값으로 노출하지 않으므로 OOXML 관계만 좁게 읽어 원본 바이트와 셀 주소를 연결한다. */
function spreadsheetPackageImageInfo(bytes, ZipCtor){
  const Empty = () => ({ sheets:new Map(), hasRichImages:false, hasDrawingParts:false, parseError:false });
  const Ctor = ZipCtor || (typeof JSZip !== "undefined" ? JSZip : null);
  if (!Ctor) return Empty();
  let zip;
  try { zip = new Ctor(bytes); } catch(_){ const out = Empty(); out.parseError = true; return out; }
  const paths = Object.keys(zip.files || {});
  const result = Empty();
  result.hasDrawingParts = paths.some(path => /^xl\/drawings\/drawing\d+\.xml$/i.test(path));
  const metadataXml = spreadsheetZipText(zip, "xl/metadata.xml");
  const structuresPart = spreadsheetFindPackagePart(zip, "xl/richData", "rvStructures");
  const dataPart = spreadsheetFindPackagePart(zip, "xl/richData", "rvData");
  const relListPart = spreadsheetFindPackagePart(zip, "xl/richData", "richValueRels");
  if (!metadataXml || !structuresPart || !dataPart || !relListPart) return result;

  const structures = spreadsheetXmlBlocks(structuresPart.text, "s").map(block => ({
    type:spreadsheetXmlAttr(block.tag, "t"),
    keys:spreadsheetXmlTags(block.inner, "k").map(tag => spreadsheetXmlAttr(tag, "n"))
  }));
  if (!structures.some(structure => /^_localimage$/i.test(structure.type))){
    result.hasRichImages = structures.some(structure => /^_(?:localimage|webimage)$/i.test(structure.type));
    return result;
  }
  result.hasRichImages = true;

  const richValues = spreadsheetXmlBlocks(dataPart.text, "rv").map(block => ({
    structure:Number(spreadsheetXmlAttr(block.tag, "s") || 0),
    values:spreadsheetXmlBlocks(block.inner, "v").map(value => spreadsheetXmlDecode(String(value.inner).replace(/<[^>]*>/g, "")))
  }));
  const valueMetadataBlock = spreadsheetXmlBlocks(metadataXml, "valueMetadata")[0];
  const metadataValues = valueMetadataBlock ? spreadsheetXmlBlocks(valueMetadataBlock.inner, "bk").map(block => {
    const rc = spreadsheetXmlTags(block.inner, "rc")[0] || "";
    return Number(spreadsheetXmlAttr(rc, "v"));
  }) : [];
  const richRelIds = spreadsheetXmlTags(relListPart.text, "rel").map(tag => spreadsheetXmlAttr(tag, "r:id") || spreadsheetXmlAttr(tag, "id"));
  const relTargets = spreadsheetRelationshipMap(zip, relListPart.path);

  spreadsheetPackageSheetParts(zip).forEach(sheet => {
    const sheetXml = spreadsheetZipText(zip, sheet.path);
    const images = [];
    spreadsheetXmlTags(sheetXml, "c").forEach(cellTag => {
      const vm = Number(spreadsheetXmlAttr(cellTag, "vm"));
      if (!(vm > 0)) return;
      const richIndex = metadataValues[vm - 1];
      const rich = richValues[richIndex];
      const structure = rich && structures[rich.structure];
      if (!rich || !structure || !/^_localimage$/i.test(structure.type)) return;
      const relKey = structure.keys.findIndex(key => /^_rvrel:localimageidentifier$/i.test(key));
      if (relKey < 0) return;
      const relationId = richRelIds[Number(rich.values[relKey])];
      const relation = relTargets.get(relationId);
      const entry = relation && !relation.external && zip.file(relation.target);
      if (!entry) return;
      const address = spreadsheetXmlAttr(cellTag, "r");
      const decoded = spreadsheetDecodeCellAddress(address);
      if (!decoded) return;
      const textKey = structure.keys.findIndex(key => /^text$/i.test(key));
      const extension = String(relation.target || "").match(/\.([^.\/]+)$/);
      let imageBytes;
      try { imageBytes = entry.asUint8Array(); } catch(_){ return; }
      images.push({
        kind:"cell", row:decoded.r, col:decoded.c, address,
        bytes:imageBytes, mime:spreadsheetImageMime(extension && extension[1]),
        alt:textKey >= 0 ? rich.values[textKey] || "셀 이미지" : "셀 이미지"
      });
    });
    if (images.length) result.sheets.set(sheet.name, images);
  });
  return result;
}

function spreadsheetImageFormulaInfo(formula){
  const source = String(formula == null ? "" : formula).trim().replace(/^=/, "");
  const match = source.match(/^(?:_xlfn\.)?IMAGE\s*\(([\s\S]*)\)$/i);
  if (!match) return null;
  const args = [];
  let current = "", quoted = false;
  for (let i = 0; i < match[1].length; i++){
    const ch = match[1][i];
    if (ch === '"'){
      if (quoted && match[1][i + 1] === '"'){ current += '"'; i++; continue; }
      quoted = !quoted; continue;
    }
    if (ch === "," && !quoted){ args.push(current.trim()); current = ""; } else current += ch;
  }
  args.push(current.trim());
  return {
    kind:"formula", source:args[0] || "", alt:args[1] || "웹 이미지",
    sizing:args[2] === "" || args[2] == null ? 0 : Number(args[2]),
    height:Number(args[3]) || 0, width:Number(args[4]) || 0
  };
}

function spreadsheetFormulaImages(workbook){
  const sheets = new Map();
  if (!workbook || !workbook.SheetNames) return sheets;
  workbook.SheetNames.forEach(name => {
    const ws = workbook.Sheets[name], images = [];
    for (const address in (ws || {})){
      if (address[0] === "!") continue;
      const cell = ws[address], info = spreadsheetImageFormulaInfo(cell && cell.f);
      if (!info) continue;
      const decoded = XLSX.utils.decode_cell(address);
      images.push({ ...info, row:decoded.r, col:decoded.c, address });
    }
    if (images.length) sheets.set(name, images);
  });
  return sheets;
}

function spreadsheetFloatingImageDescriptors(workbook, sheetName){
  const sheet = workbook && typeof workbook.getWorksheet === "function" ? workbook.getWorksheet(sheetName) : null;
  const images = sheet && typeof sheet.getImages === "function" ? sheet.getImages() : [];
  return (Array.isArray(images) ? images : []).map(item => {
    const media = workbook && typeof workbook.getImage === "function" ? workbook.getImage(Number(item.imageId)) : null;
    if (!media || !media.buffer) return null;
    const anchor = point => {
      if (!point) return null;
      const nativeRow = Number(point.nativeRow), nativeCol = Number(point.nativeCol);
      const nativeRowOff = Number(point.nativeRowOff), nativeColOff = Number(point.nativeColOff);
      return {
        // ExcelJS의 row/col 환산값은 좁은 열에서 오프셋을 크게 부풀릴 수 있다.
        // OOXML 원본 칸과 EMU 오프셋을 우선해 Excel과 같은 위치에 놓는다.
        row:Number.isFinite(nativeRow) ? nativeRow : Number(point.row) || 0,
        col:Number.isFinite(nativeCol) ? nativeCol : Number(point.col) || 0,
        rowOffsetPx:Number.isFinite(nativeRowOff) ? nativeRowOff / 9525 : null,
        colOffsetPx:Number.isFinite(nativeColOff) ? nativeColOff / 9525 : null
      };
    };
    return {
      kind:"floating", bytes:media.buffer, mime:spreadsheetImageMime(media.extension), alt:String(media.name || "시트 그림"),
      tl:anchor(item.range && item.range.tl), br:anchor(item.range && item.range.br),
      ext:item.range && item.range.ext ? { width:Number(item.range.ext.width) || 0, height:Number(item.range.ext.height) || 0 } : null
    };
  }).filter(Boolean);
}

async function spreadsheetIsolateWorksheetBytes(bytes, sheetName, ExcelCtor){
  const Excel = ExcelCtor || (typeof ExcelJS !== "undefined" ? ExcelJS : null);
  if (!Excel || !bytes) return null;
  const workbook = await spreadsheetLoadExcelWorkbook(bytes, Excel);
  for (const worksheet of [...workbook.worksheets]){
    if (worksheet.name !== sheetName) workbook.removeWorksheet(worksheet.id);
  }
  if (!workbook.getWorksheet(sheetName)) return null;
  const X=typeof XLSX!=="undefined"?XLSX:require("../../vendor/xlsx.full.min.js");
  const original=X.read(bytes,{type:"array",sheetRows:1});
  const names=(original.Workbook?.Names || []).filter(n=>n.Sheet==null || original.SheetNames[n.Sheet]===sheetName).map(n=>n.Sheet==null?n:{...n,Sheet:0});
  const out=spreadsheetTools.writeDefinedNames(await workbook.xlsx.writeBuffer(),names);
  const settings=spreadsheetTools.readSettings(bytes);
  return spreadsheetTools.writeSettings(out,{[sheetName]:settings[sheetName] || {}});
}

function spreadsheetExtendSheetRangeForImages(ws, images){
  if (!ws || !images || !images.length || typeof XLSX === "undefined") return;
  let range;
  try { range = XLSX.utils.decode_range(ws["!ref"] || "A1"); } catch(_){ range = { s:{ r:0, c:0 }, e:{ r:0, c:0 } }; }
  images.forEach(image => {
    const row = image.kind === "floating" ? Math.ceil((image.br && image.br.row) || (image.tl && image.tl.row) || 0) : image.row;
    const col = image.kind === "floating" ? Math.ceil((image.br && image.br.col) || (image.tl && image.tl.col) || 0) : image.col;
    range.e.r = Math.max(range.e.r, Number(row) || 0);
    range.e.c = Math.max(range.e.c, Number(col) || 0);
  });
  ws["!ref"] = XLSX.utils.encode_range(range);
}

// 텍스트 인코딩 자동 판별(코드페이지 없는 파일용): UTF-16 BOM → 해당 인코딩, 아니면 "엄격 UTF-8"을
// 먼저 시도(BOM 자동 제거)하고, 유효한 UTF-8이 아니면 CP949(EUC-KR)로 디코드한다.
// 한국어 텍스트(csv·txt·md·코드 등)는 대부분 UTF-8 또는 CP949 이므로 이 둘을 우선한다.
function smartDecodeText(bytes){
  const info = detectTextEncoding(bytes);
  if (info && info.encoding){
    try { return new TextDecoder(info.encoding).decode(bytes); } catch(_){}
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// Ctrl+방향키 데이터 경계 점프(엑셀 동작). empty(r,c) 접근자와 격자 크기를 받아 목적지 좌표를 돌려준다.
//  · 현재·다음 셀 모두 값이 있으면 → 이어진 데이터 블록의 끝까지
//  · 다음 셀이 비었으면(또는 현재가 빈 셀) → 그 방향의 다음 데이터 셀까지(없으면 시트 끝)
function spreadsheetJumpToDataEdge(empty, rowCount, maxCols, row, col, dr, dc){
  const inB = (r, c) => r >= 0 && r < rowCount && c >= 0 && c < maxCols;
  let r = row, c = col;
  const nr = r + dr, nc = c + dc;
  if (!inB(nr, nc)) return { row: r, col: c };
  if (!empty(r, c) && !empty(nr, nc)){
    while (inB(r + dr, c + dc) && !empty(r + dr, c + dc)){ r += dr; c += dc; }
  } else {
    r = nr; c = nc;
    while (inB(r, c) && empty(r, c)){ r += dr; c += dc; }
    if (!inB(r, c)){
      r = Math.max(0, Math.min(rowCount - 1, r));
      c = Math.max(0, Math.min(maxCols - 1, c));
    }
  }
  return { row: r, col: c };
}

function spreadsheetModelCellEmpty(cell){
  if (!cell) return true;
  if (cell.f != null && cell.f !== "") return false;
  return cell.v === "" || cell.v === null || cell.v === undefined;
}

/* 표 선택 셈은 DB 클라이언트 결과 표와 함께 쓰므로 grid-selection.js 로 옮겼다.
   이 파일 안의 이름(spreadsheetSelection*)은 그대로 두어 부르는 자리를 건드리지 않는다. */
const {
  gridSelectionDragHitPoint: spreadsheetSelectionDragHitPoint,
  gridSelectionRangeKeys: spreadsheetSelectionRangeKeys,
  gridSelectionRangeCovered: spreadsheetSelectionRangeCovered,
  gridSelectionCombineKeys: spreadsheetSelectionCombineKeys,
  gridSelectionBoundsFromKeys: spreadsheetSelectionBoundsFromKeys,
  gridClipboardTable: parseClipboardTable
} = typeof MNGridSelection !== "undefined"
  ? MNGridSelection
  : require("./grid-selection.js");

async function copySpreadsheetText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch(e){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch(_){}
    ta.remove();
    return ok;
  }
}

// 표 내보내기 공용: 바이트/문자열을 파일로 저장.
function downloadSpreadsheetFile(data, name, mime){
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
  MNDownload.saveBlob(blob, name);
}
function sheetBaseName(name){ return String(name || "sheet").replace(/\.[^.]+$/, "") || "sheet"; }
function sanitizeFilePart(s){ return String(s || "").replace(/[\\/:*?"<>|]/g, "").trim() || "sheet"; }
function spreadsheetConvertedDocOptions(ownerDoc, name, aoa, hasHeader){
  const toXlsxPath = (value) => value ? String(value).replace(/\.csv$/i, ".xlsx") : null;
  return {
    isScratch:true,
    convertedFromCsv:true,
    spreadsheetAoa:aoa,
    spreadsheetHasHeader:hasHeader,
    parentId:ownerDoc && ownerDoc.parentId || null,
    workspacePath:toXlsxPath(ownerDoc && ownerDoc.workspacePath) || name,
    relPath:toXlsxPath(ownerDoc && ownerDoc.relPath),
    // CSV 파일 핸들은 절대 넘기지 않는다. 부모 폴더 핸들만 전달해 같은 폴더에 새 XLSX를 만든다.
    fsHandle:null,
    fsDirHandle:ownerDoc && ownerDoc.fsDirHandle || null,
    originalSaveMode:false
  };
}
function spreadsheetDirectSaveKind(doc){
  if (!doc) return "";
  if (doc.fsHandle) return "existing";
  // 복원된 원본 문서는 파일 핸들이 없어도 폴더 문맥으로 다시 연결해야 한다.
  // 이 갈래를 건너뛰면 '원본 저장' 표시와 달리 SaveRoot에 사본이 생긴다.
  if (doc.originalSaveMode) return doc.isScratch ? "create" : "existing";
  if (doc.convertedFromCsv) return "create";
  // 메모·블록 문서의 표에서 만든 XLSX처럼, 저장할 디렉터리 문맥을 받은 새 표는 그 폴더에 만든다.
  if (doc.isScratch && doc.fsDirHandle && typeof doc.fsDirHandle.getFileHandle === "function") return "create";
  return "";
}

// 새 빈 표(스프레드시트) 만들기 — 유효한 빈 XLSX(12행×6열)를 생성해 열고, 바로 편집 모드로 진입(isScratch).
let _sheetScratchCount = 0;
const SPREADSHEET_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function spreadsheetScratchFileName(number=1){
  return number > 1 ? ("새 표 " + number + ".xlsx") : "새 표.xlsx";
}
// 빈 XLSX 바이트 만들기 — XLSX 라이브러리를 지연 로드한 뒤 호출한다. 실패하면 null.
async function spreadsheetScratchBytes(){
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("xlsx");   // 표를 만들 때 처음 로드
  if (typeof XLSX === "undefined"){ toast("Excel 라이브러리를 불러오지 못했어요.", 2400); return null; }
  const rows = 12, cols = 6;
  const aoa = Array.from({ length: rows }, () => new Array(cols).fill(""));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!ref"] = "A1:" + spreadsheetColumnName(cols - 1) + rows;   // 빈 셀이라도 격자 크기를 고정
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}
async function newSpreadsheetScratch(){
  const out = await spreadsheetScratchBytes();
  if (!out) return;
  _sheetScratchCount++;
  const name = spreadsheetScratchFileName(_sheetScratchCount);
  const file = new File([out], name, { type: SPREADSHEET_MIME });
  if (typeof handleFiles === "function") handleFiles([file], { isScratch: true });
  if (typeof toast === "function") toast("새 빈 표를 만들었어요. 셀을 더블클릭해 입력하세요.", 3200);
}
// 폴더 우클릭에서 만든 빈 표 — 폴더 문맥을 이어받아 첫 저장이 그 폴더로 떨어진다.
async function newSpreadsheetScratchInFolder(folder){
  if (typeof createScratchInFolder !== "function") return false;
  const out = await spreadsheetScratchBytes();
  if (!out) return false;
  return createScratchInFolder(folder, spreadsheetScratchFileName, () => out,
    SPREADSHEET_MIME, "새 빈 표를");
}

function enhanceSpreadsheetSelection(sheet, label, opts={}){
  const table = sheet && sheet.querySelector("table");
  if (!table || table.dataset.selectReady === "1") return;
  if (sheet._spreadsheetCleanup) sheet._spreadsheetCleanup();
  table.dataset.selectReady = "1";
  sheet.classList.add("selectable-sheet");
  sheet.tabIndex = 0;

  const originalRows = Array.from(table.rows).filter(row => !row.classList.contains("xlsx-virtual-spacer"));
  if (!originalRows.length) return;
  // colLabels: 열 머리글 텍스트를 A/B/C 대신 실제 컬럼명으로(예: CSV 첫 줄). rowStart: 행 번호 시작 오프셋(페이지네이션용).
  const colLabels = Array.isArray(opts.colLabels) ? opts.colLabels : null;
  const rowStart = Number(opts.rowStart) || 0;
  let maxCols = 0;
  originalRows.forEach(row => { maxCols = Math.max(maxCols, row.cells.length); });
  if (colLabels) maxCols = Math.max(maxCols, colLabels.length);
  if (!maxCols) return;

  const thead = table.tHead || table.createTHead();
  const colRow = document.createElement("tr");
  colRow.className = "sheet-col-row";
  const corner = document.createElement("th"); corner.className = "sheet-corner"; corner.textContent = "";
  colRow.appendChild(corner);
  for (let c = 0; c < maxCols; c++){
    const th = document.createElement("th");
    th.className = "sheet-col-head";
    const named = colLabels && colLabels[c] != null && String(colLabels[c]).trim() !== "";
    const label = named ? String(colLabels[c]) : spreadsheetColumnName(c);
    th.textContent = label;
    th.dataset.col = String(c);
    th.title = named ? (label + " 열 선택") : (label + "열 선택");
    if (colLabels) th.classList.add("sheet-col-head-named");
    colRow.appendChild(th);
  }
  thead.insertBefore(colRow, thead.firstChild);

  const rows = Array.from(table.rows).filter(row =>
    !row.classList.contains("sheet-col-row") && !row.classList.contains("xlsx-virtual-spacer"));
  rows.forEach((row, r) => {
    const cells = Array.from(row.cells);
    cells.forEach((cell, c) => {
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.tabIndex = -1;
    });
    const th = document.createElement("th");
    th.className = "sheet-row-head";
    const rowNo = Array.isArray(opts.rowLabels) && opts.rowLabels[r] != null ? Number(opts.rowLabels[r]) + 1 : rowStart + r + 1;
    th.textContent = String(rowNo);
    th.dataset.row = String(r);
    th.title = rowNo + "행 선택";
    row.insertBefore(th, row.firstChild);
  });

  const bar = sheet.previousElementSibling && sheet.previousElementSibling.classList.contains("sheet-selectbar")
    ? sheet.previousElementSibling
    : document.createElement("div");
  if (!bar.isConnected) sheet.parentNode.insertBefore(bar, sheet);
  bar.className = "sheet-selectbar";
  bar.innerHTML = "";
  const info = document.createElement("span"); info.className = "sheet-select-info"; info.textContent = (label || "표") + " · 셀·행·열 선택";
  const search = document.createElement("input");
  search.className = "sheet-search";
  search.type = "search";
  search.placeholder = "표에서 찾기";
  search.setAttribute("aria-label", "표에서 찾기");
  const findPrev = document.createElement("button"); findPrev.type = "button"; findPrev.textContent = "이전"; findPrev.disabled = true;
  const findNext = document.createElement("button"); findNext.type = "button"; findNext.textContent = "다음"; findNext.disabled = true;
  const findStatus = document.createElement("span"); findStatus.className = "sheet-find-status"; findStatus.textContent = "";
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "복사"; copy.disabled = true;
  const chart = document.createElement("button"); chart.type = "button"; chart.textContent = "📊 차트"; chart.disabled = true; chart.title = "선택한 범위로 차트 만들기 (막대·꺾은선·원·산점도)";
  const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "선택 해제"; clear.disabled = true;
  const stat = document.createElement("span"); stat.className = "sheet-stat"; stat.textContent = "";   // 선택 영역 합계·평균·개수
  // 찾기·복사/해제를 그룹으로 묶어, 폭이 넘쳐 줄바꿈될 때 버튼 하나만 떨어지지 않고 그룹째 깔끔히 내려가게 한다.
  const findGroup = document.createElement("span"); findGroup.className = "sheet-bar-group";
  findGroup.append(search, findPrev, findNext, findStatus);
  const actGroup = document.createElement("span"); actGroup.className = "sheet-bar-group";
  actGroup.append(copy, chart, clear);
  bar.append(info, findGroup, actGroup, stat);
  if (opts.extra) bar.prepend(opts.extra);   // CSV 페이지 네비 등 외부 컨트롤을 같은 바 앞쪽에 합친다(바 재생성 시 매번 다시 끼움)
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(bar);

  const rowCount = rows.length;
  let selection = null;
  let selectedKeys = new Set();
  let anchor = null;
  let dragTarget = null;
  let isDragging = false;
  let focusCell = null;   // 키보드 이동의 현재 끝점(방향키가 움직이는 셀)
  // 선택·통계 계산 중 querySelector를 수천 번 반복하지 않도록 현재 표의 셀을 한 번만 색인한다.
  const cachedDataCells = Array.from(table.querySelectorAll("td[data-row],th[data-row]:not(.sheet-row-head):not(.sheet-col-head):not(.sheet-corner)"));
  const cellGrid = Array.from({ length:rowCount }, () => Array(maxCols).fill(null));
  cachedDataCells.forEach(cell => {
    const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
    if (cellGrid[r] && c >= 0 && c < maxCols) cellGrid[r][c] = cell;
  });
  const rowHeads = Array.from(table.querySelectorAll(".sheet-row-head"));
  const colHeads = Array.from(table.querySelectorAll(".sheet-col-head"));
  const dataCells = () => cachedDataCells;
  const cellAt = (r, c) => (cellGrid[r] && cellGrid[r][c]) || null;
  const textAt = (r, c) => {
    const cell = cellAt(r, c);
    return cell ? cell.textContent : "";
  };
  const normalizeRange = (a, b) => ({
    row1: Math.max(0, Math.min(a.row, b.row)),
    row2: Math.min(rowCount - 1, Math.max(a.row, b.row)),
    col1: Math.max(0, Math.min(a.col, b.col)),
    col2: Math.min(maxCols - 1, Math.max(a.col, b.col))
  });
  const targetFromElement = (element) => {
    if (!element || !element.closest) return null;
    const col = element.closest(".sheet-col-head");
    if (col && sheet.contains(col)) return { kind: "col", row: 0, col: Number(col.dataset.col) };
    const row = element.closest(".sheet-row-head");
    if (row && sheet.contains(row)) return { kind: "row", row: Number(row.dataset.row), col: 0 };
    const cell = element.closest("[data-row][data-col]");
    if (cell && sheet.contains(cell) && !cell.classList.contains("sheet-row-head")){
      return { kind: "cell", row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    }
    return null;
  };
  const targetFromEvent = (e) => targetFromElement(e && e.target);
  const selectionFromTargets = (start, end) => {
    if (!start || !end) return null;
    if (start.kind === "row" || end.kind === "row"){
      const a = { row: start.row, col: 0 }, b = { row: end.row, col: maxCols - 1 };
      return { kind: "row", ...normalizeRange(a, b) };
    }
    if (start.kind === "col" || end.kind === "col"){
      const a = { row: 0, col: start.col }, b = { row: rowCount - 1, col: end.col };
      return { kind: "col", ...normalizeRange(a, b) };
    }
    return { kind: "cell", ...normalizeRange(start, end) };
  };
  const rangeLabel = (sel) => {
    if (!sel) return "";
    const first = spreadsheetColumnName(sel.col1) + (sel.row1 + 1);
    const last = spreadsheetColumnName(sel.col2) + (sel.row2 + 1);
    if (sel.kind === "row"){
      return sel.row1 === sel.row2 ? (sel.row1 + 1) + "행 선택" : (sel.row1 + 1) + "-" + (sel.row2 + 1) + "행 선택";
    }
    if (sel.kind === "col"){
      return sel.col1 === sel.col2 ? spreadsheetColumnName(sel.col1) + "열 선택" : spreadsheetColumnName(sel.col1) + ":" + spreadsheetColumnName(sel.col2) + "열 선택";
    }
    if (sel.row1 === sel.row2 && sel.col1 === sel.col2) return first + " 셀 선택";
    return first + ":" + last + " 범위 선택";
  };
  const selectionText = () => {
    const bounds = spreadsheetSelectionBoundsFromKeys(selectedKeys, maxCols);
    if (!bounds) return "";
    if (!bounds.contiguous) return null;
    const lines = [];
    for (let r = bounds.row1; r <= bounds.row2; r++){
      const cells = [];
      for (let c = bounds.col1; c <= bounds.col2; c++) cells.push(textAt(r, c));
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  };
  // 셀 표시 텍스트를 숫자로(천단위 콤마·통화·%·회계식 음수 (123) 허용). 숫자가 아니면 null.
  const parseCellNumber = (s) => {
    let t = String(s == null ? "" : s).trim();
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1).trim(); }
    t = t.replace(/[,\s₩$€£¥%]/g, "");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    const n = parseFloat(t);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  };
  const fmtStat = (n) => {
    if (!isFinite(n)) return "-";
    return (Math.round(n * 1e10) / 1e10).toLocaleString(undefined, { maximumFractionDigits: 6 });
  };
  // 엑셀 하단처럼 선택 영역의 합계·평균·최소·최대·숫자개수·선택칸수를 셀렉트바에 표시.
  const updateStat = () => {
    if (!selectedKeys.size){ stat.textContent = ""; return; }
    let count = 0, nums = 0, sum = 0, min = Infinity, max = -Infinity;
    selectedKeys.forEach(key => {
      const r = Math.floor(key / maxCols), c = key % maxCols;
      const raw = textAt(r, c);
      if (String(raw == null ? "" : raw).trim() !== "") count++;
      const n = parseCellNumber(raw);
      if (n != null){ nums++; sum += n; if (n < min) min = n; if (n > max) max = n; }
    });
    if (count < 2){ stat.textContent = ""; return; }           // 단일 셀은 값이 보이므로 생략
    const parts = [];
    if (nums >= 1){
      parts.push("합계 " + fmtStat(sum), "평균 " + fmtStat(sum / nums), "최소 " + fmtStat(min), "최대 " + fmtStat(max), "숫자 " + nums);
    }
    parts.push("선택 " + count + "칸");
    stat.textContent = parts.join(" · ");
  };
  const MASK_TOP = 1, MASK_RIGHT = 2, MASK_BOTTOM = 4, MASK_LEFT = 8;
  let markedCells = new Map();
  let markedRowHeads = new Set(), markedColHeads = new Set(), markedAnchor = null;
  let selectionStatPending = false;
  const setCellMark = (cell, mask) => {
    cell.classList.toggle("sheet-selected", mask !== null);
    cell.classList.toggle("sheet-range-top", mask !== null && !!(mask & MASK_TOP));
    cell.classList.toggle("sheet-range-right", mask !== null && !!(mask & MASK_RIGHT));
    cell.classList.toggle("sheet-range-bottom", mask !== null && !!(mask & MASK_BOTTOM));
    cell.classList.toggle("sheet-range-left", mask !== null && !!(mask & MASK_LEFT));
  };
  const syncHeadMarks = (current, next) => {
    current.forEach(head => { if (!next.has(head)) head.classList.remove("sheet-active-head"); });
    next.forEach(head => { if (!current.has(head)) head.classList.add("sheet-active-head"); });
    return next;
  };
  const clearMarks = () => {
    markedCells.forEach((_, cell) => setCellMark(cell, null));
    markedCells = new Map();
    markedRowHeads.forEach(head => head.classList.remove("sheet-active-head"));
    markedColHeads.forEach(head => head.classList.remove("sheet-active-head"));
    markedRowHeads = new Set(); markedColHeads = new Set();
    if (markedAnchor) markedAnchor.classList.remove("sheet-anchor");
    markedAnchor = null;
  };
  const flushSelectionStat = () => {
    selectionStatPending = false;
    updateStat();
  };
  const applySelection = (next, options={}) => {
    if (!next){
      selection = null;
      selectedKeys = new Set();
      clearMarks();
      sheet.dataset.selectionContiguous = "0";
      sheet.dataset.selectionCount = "0";
      info.textContent = (label || "표") + " · 셀·행·열 선택";
      copy.disabled = true; clear.disabled = true; chart.disabled = true;
      if (options.deferStat) selectionStatPending = true; else flushSelectionStat();
      if (typeof opts.onSelectionChange === "function") opts.onSelectionChange(null);
      return;
    }
    const mode = options.mode || "replace";
    const baseKeys = options.baseKeys || selectedKeys;
    selectedKeys = spreadsheetSelectionCombineKeys(baseKeys, next, mode, maxCols);
    selection = selectedKeys.size ? next : null;
    if (!selectedKeys.size){
      applySelection(null, options);
      return;
    }
    const bounds = spreadsheetSelectionBoundsFromKeys(selectedKeys, maxCols);
    const nextCells = new Map();
    const selectedRows = new Set(), selectedCols = new Set();
    selectedKeys.forEach(key => {
      const r = Math.floor(key / maxCols), c = key % maxCols;
      const cell = cellAt(r, c);
      if (!cell) return;
      let mask = 0;
      if (r === 0 || !selectedKeys.has((r - 1) * maxCols + c)) mask |= MASK_TOP;
      if (c === maxCols - 1 || !selectedKeys.has(r * maxCols + c + 1)) mask |= MASK_RIGHT;
      if (r === rowCount - 1 || !selectedKeys.has((r + 1) * maxCols + c)) mask |= MASK_BOTTOM;
      if (c === 0 || !selectedKeys.has(r * maxCols + c - 1)) mask |= MASK_LEFT;
      nextCells.set(cell, mask);
      selectedRows.add(r); selectedCols.add(c);
    });
    markedCells.forEach((mask, cell) => {
      const nextMask = nextCells.get(cell);
      if (nextMask === undefined) setCellMark(cell, null);
      else if (nextMask !== mask) setCellMark(cell, nextMask);
    });
    nextCells.forEach((mask, cell) => {
      if (!markedCells.has(cell)) setCellMark(cell, mask);
    });
    markedCells = nextCells;
    const nextRows = new Set(), nextCols = new Set();
    rowHeads.forEach(head => {
      const r = Number(head.dataset.row);
      if (selectedRows.has(r)) nextRows.add(head);
    });
    colHeads.forEach(head => {
      const c = Number(head.dataset.col);
      if (selectedCols.has(c)) nextCols.add(head);
    });
    markedRowHeads = syncHeadMarks(markedRowHeads, nextRows);
    markedColHeads = syncHeadMarks(markedColHeads, nextCols);
    // 기준(활성) 셀을 흰 배경 + 굵은 테두리로 구분 — 여러 칸을 선택해도 시작점이 한눈에 보이게.
    const nextAnchor = anchor && anchor.kind === "cell" ? cellAt(anchor.row, anchor.col) : null;
    if (markedAnchor && markedAnchor !== nextAnchor) markedAnchor.classList.remove("sheet-anchor");
    markedAnchor = nextAnchor && nextAnchor.classList.contains("sheet-selected") ? nextAnchor : null;
    if (markedAnchor) markedAnchor.classList.add("sheet-anchor");
    sheet.dataset.selectionContiguous = bounds.contiguous ? "1" : "0";
    sheet.dataset.selectionCount = String(bounds.count);
    if (bounds.contiguous){
      const kind = bounds.col1 === 0 && bounds.col2 === maxCols - 1
        ? "row"
        : (bounds.row1 === 0 && bounds.row2 === rowCount - 1 ? "col" : "cell");
      info.textContent = rangeLabel({ kind, ...bounds });
    } else {
      info.textContent = "비연속 선택 · " + bounds.count + "칸";
    }
    copy.disabled = !bounds.contiguous;
    clear.disabled = false;
    chart.disabled = !bounds.contiguous;
    if (options.deferStat) selectionStatPending = true; else flushSelectionStat();
    if (typeof opts.onSelectionChange === "function"){
      opts.onSelectionChange({ kind:bounds.contiguous ? "range" : "multi", ...bounds });
    }
  };
  // 편집기 우클릭 메뉴가 클릭한 셀·행·열을 현재 선택으로 맞출 수 있게 최소 API만 노출한다.
  sheet._selectSpreadsheetElement = (element) => {
    const target = targetFromElement(element);
    if (!target) return false;
    anchor = target;
    focusCell = target.kind === "cell" ? target : null;
    applySelection(selectionFromTargets(target, target));
    return true;
  };
  let findMatches = [];
  let findIndex = -1;
  const updateFindStatus = () => {
    findPrev.disabled = findNext.disabled = !findMatches.length;
    findStatus.textContent = search.value.trim() ? (findMatches.length ? (findIndex + 1) + "/" + findMatches.length : "0/0") : "";
  };
  const focusFoundCell = (match) => {
    if (!match) return;
    anchor = { kind: "cell", row: match.row, col: match.col };
    applySelection(selectionFromTargets(anchor, anchor));
    const cell = cellAt(match.row, match.col);
    if (cell) cell.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  };
  let contentFlashTimer = 0;
  sheet._focusContentCell = (row, col) => {
    const cell = row < 0                                    // row<0 → 컬럼명 머리글(CSV 첫 줄이 헤더로 올라간 경우)
      ? colRow.querySelector(`.sheet-col-head[data-col="${col}"]`)
      : cellAt(row, col);
    if (!cell) return false;
    clearTimeout(contentFlashTimer);
    sheet.querySelectorAll(".content-search-cell").forEach(el => el.classList.remove("content-search-cell"));
    try { sheet.focus({ preventScroll:true }); } catch(_) { sheet.focus(); }
    cell.scrollIntoView({ block:"center", inline:"center", behavior:"smooth" });
    cell.classList.add("content-search-cell");
    contentFlashTimer = setTimeout(() => cell.classList.remove("content-search-cell"), 2400);
    return true;
  };
  const runFind = (dir=1, quiet=false) => {
    const q = search.value.trim().toLowerCase();
    findMatches = q
      ? dataCells().map(cell => ({ cell, row: Number(cell.dataset.row), col: Number(cell.dataset.col), text: cell.textContent || "" }))
        .filter(item => item.text.toLowerCase().includes(q))
      : [];
    if (!findMatches.length){
      findIndex = -1;
      updateFindStatus();
      if (q && !quiet) toast("찾는 내용이 없어요.", 1200);
      return;
    }
    if (findIndex < 0) findIndex = dir < 0 ? findMatches.length - 1 : 0;
    else findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
    updateFindStatus();
    focusFoundCell(findMatches[findIndex]);
  };

  let dragPointerId = null, dragFrame = 0, dragPoint = null, lastDragKey = "";
  let dragBaseKeys = null, dragSelectionMode = "replace";
  const dragKey = (target) => target ? [target.kind, target.row, target.col].join(":") : "";
  const runDragFrame = (allowRepeat=true) => {
    dragFrame = 0;
    if (!isDragging || !dragPoint || !dragTarget) return;
    const rect = sheet.getBoundingClientRect();
    const edge = 34;
    const axisSpeed = (position, start, end) => {
      if (position < start + edge) return -Math.min(24, Math.max(3, Math.ceil((start + edge - position) / 3)));
      if (position > end - edge) return Math.min(24, Math.max(3, Math.ceil((position - (end - edge)) / 3)));
      return 0;
    };
    // 행 선택은 세로, 열 선택은 가로만 자동 스크롤한다. sticky 헤더에서 반대 축까지
    // 스크롤되면 포인터 아래 행·열이 불필요하게 흔들린다.
    const dx = dragTarget.kind === "row" ? 0 : axisSpeed(dragPoint.x, rect.left, rect.right);
    const dy = dragTarget.kind === "col" ? 0 : axisSpeed(dragPoint.y, rect.top, rect.bottom);
    const beforeLeft = sheet.scrollLeft, beforeTop = sheet.scrollTop;
    if (dx) sheet.scrollLeft += dx;
    if (dy) sheet.scrollTop += dy;
    const scrolled = beforeLeft !== sheet.scrollLeft || beforeTop !== sheet.scrollTop;

    const cornerRect = corner.getBoundingClientRect();
    const colRect = colRow.getBoundingClientRect();
    const hit = spreadsheetSelectionDragHitPoint(dragTarget.kind, dragPoint, rect, cornerRect, colRect);
    const target = targetFromElement(document.elementFromPoint(hit.x, hit.y));
    if (target && target.kind === dragTarget.kind){
      const key = dragKey(target);
      if (key !== lastDragKey){
        lastDragKey = key;
        focusCell = target;
        applySelection(selectionFromTargets(dragTarget, target), {
          deferStat:true,
          baseKeys:dragBaseKeys,
          mode:dragSelectionMode
        });
      }
    }
    if (allowRepeat && scrolled && isDragging) dragFrame = requestAnimationFrame(() => runDragFrame(true));
  };
  const queueDragFrame = (e) => {
    if (!isDragging || (dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    dragPoint = { x:e.clientX, y:e.clientY };
    if (!dragFrame) dragFrame = requestAnimationFrame(() => runDragFrame(true));
  };
  const handlePointerDown = (e) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (e.target && e.target.closest && e.target.closest('[contenteditable="true"]')) return;   // 편집 중 셀은 캐럿 배치 허용
    const target = targetFromEvent(e);
    if (!target) return;
    if (e.pointerType === "touch") e.preventDefault();
    sheet.focus({ preventScroll: true });
    const start = e.shiftKey && anchor && anchor.kind === target.kind ? anchor : target;
    const next = selectionFromTargets(start, target);
    const additive = e.ctrlKey || e.metaKey;
    dragBaseKeys = additive ? new Set(selectedKeys) : new Set();
    dragSelectionMode = additive && spreadsheetSelectionRangeCovered(dragBaseKeys, next, maxCols)
      ? "subtract"
      : (additive ? "add" : "replace");
    dragTarget = start;
    anchor = start;
    focusCell = target;
    isDragging = true;
    dragPointerId = e.pointerId;
    dragPoint = { x:e.clientX, y:e.clientY };
    lastDragKey = dragKey(target);
    try { sheet.setPointerCapture(e.pointerId); } catch(_){}
    applySelection(next, {
      deferStat:true,
      baseKeys:dragBaseKeys,
      mode:dragSelectionMode
    });
  };
  const stopDragging = (e) => {
    if (!isDragging || (e && dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    if (dragFrame){
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
      runDragFrame(false);
    }
    try {
      if (dragPointerId !== null && sheet.hasPointerCapture(dragPointerId)) sheet.releasePointerCapture(dragPointerId);
    } catch(_){}
    isDragging = false; dragTarget = null; dragPointerId = null; dragPoint = null; lastDragKey = "";
    dragBaseKeys = null; dragSelectionMode = "replace";
    if (selectionStatPending) flushSelectionStat();
  };
  sheet.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", queueDragFrame, { passive:true });
  window.addEventListener("pointerup", stopDragging);
  window.addEventListener("pointercancel", stopDragging);
  copy.addEventListener("click", async () => {
    const text = selectionText();
    if (text == null){ toast("복사하려면 하나의 연속 범위만 선택하세요.", 2000); return; }
    if (!text) return;
    const ok = await copySpreadsheetText(text);
    toast(ok ? "선택한 표 내용을 복사했어요." : "복사하지 못했어요.", 1800);
  });
  chart.addEventListener("click", () => {
    const bounds = spreadsheetSelectionBoundsFromKeys(selectedKeys, maxCols);
    if (!bounds || !bounds.contiguous){ return; }
    if (typeof window.openSpreadsheetChart !== "function"){ toast("차트 기능을 불러오지 못했어요.", 2200, { type: "error" }); return; }
    const matrix = [];
    for (let r = bounds.row1; r <= bounds.row2; r++){
      const line = [];
      for (let c = bounds.col1; c <= bounds.col2; c++) line.push(textAt(r, c));
      matrix.push(line);
    }
    // CSV처럼 열 이름(헤더)이 표 밖에 따로 있으면 계열 이름으로 쓰도록 맨 앞에 붙인다.
    if (colLabels){
      const header = [];
      for (let c = bounds.col1; c <= bounds.col2; c++){
        header.push(colLabels[c] != null && String(colLabels[c]).trim() !== "" ? String(colLabels[c]) : "");
      }
      if (header.some(h => h !== "")) matrix.unshift(header);
    }
    window.openSpreadsheetChart({ matrix, label: (label || "표") });
  });
  clear.addEventListener("click", () => { anchor = null; applySelection(null); });
  search.addEventListener("input", () => { findIndex = -1; runFind(1, true); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){ e.preventDefault(); runFind(e.shiftKey ? -1 : 1); }
    e.stopPropagation();
  });
  findPrev.addEventListener("click", () => runFind(-1));
  findNext.addEventListener("click", () => runFind(1));
  // 키보드 이동 도우미 ──────────────────────────────────────────────
  const clampRow = (r) => Math.max(0, Math.min(rowCount - 1, r));
  const clampCol = (c) => Math.max(0, Math.min(maxCols - 1, c));
  const activeCell = () => {
    if (focusCell && focusCell.kind === "cell") return { row: focusCell.row, col: focusCell.col };
    if (anchor && anchor.kind === "cell") return { row: anchor.row, col: anchor.col };
    return { row: 0, col: 0 };
  };
  // 현재 보이는 높이 기준 한 페이지 행 수(PageUp/PageDown용)
  const pageRows = () => {
    const sample = cellAt(activeCell().row, 0) || cellAt(0, 0);
    const rh = (sample && sample.offsetHeight) || 24;
    return Math.max(1, Math.floor((sheet.clientHeight || 400) / rh) - 1);
  };
  const jumpToDataEdge = (row, col, dr, dc) =>
    spreadsheetJumpToDataEdge((r, c) => {
      const cell = cellAt(r, c);
      if (typeof opts.isCellEmpty === "function") return !!opts.isCellEmpty(cell, r, c);
      return String(textAt(r, c) || "") === "";
    }, rowCount, maxCols, row, col, dr, dc);
  // extend=false 면 단일 셀 선택(anchor 재설정), true(Shift) 면 anchor 고정 후 범위 확장.
  const moveActive = (row, col, extend) => {
    let r=clampRow(row), c=clampCol(col);
    const cur=activeCell(),dr=Math.sign(row-cur.row),dc=Math.sign(col-cur.col);
    for(let n=0;n<rowCount+maxCols;n++){
      const candidate=cellAt(r,c);
      if(candidate && !candidate.hidden && !candidate.parentElement.hidden)break;
      if(candidate && candidate.parentElement.hidden && dr && r+dr>=0 && r+dr<rowCount)r+=dr;
      else if(dc && c+dc>=0 && c+dc<maxCols)c+=dc;
      else return;
    }
    focusCell = { kind: "cell", row: r, col: c };
    if (!extend || !anchor || anchor.kind !== "cell") anchor = { kind: "cell", row: r, col: c };
    applySelection(selectionFromTargets(anchor, focusCell));
    const cell = cellAt(r, c);
    if (cell) cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
  const handleSheetKeydown = async (e) => {
    const target = e.target;
    if (target && target.closest && target.closest("input,textarea,[contenteditable='true']")) return;   // 편집 중 셀·입력창은 건드리지 않음
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod && !e.altKey && String(key).toLowerCase() === "c"){   // 선택 영역 복사
      if (opts.editable) return;   // 편집 모드는 전용 핸들러가 서식 포함 복사를 수행 — 이중 클립보드 쓰기(경합) 방지
      if (!selection) return;
      e.preventDefault();
      const text = selectionText();
      if (text == null){ toast("복사하려면 하나의 연속 범위만 선택하세요.", 2000); return; }
      await copySpreadsheetText(text);
      return;
    }
    if (mod && !e.altKey && String(key).toLowerCase() === "a"){   // 전체 선택
      e.preventDefault();
      anchor = { kind: "cell", row: 0, col: 0 };
      focusCell = { kind: "cell", row: rowCount - 1, col: maxCols - 1 };
      applySelection(selectionFromTargets(anchor, focusCell));
      return;
    }
    if (e.altKey || !NAV_KEYS.includes(key)) return;
    e.preventDefault();
    if (!selection){ moveActive(0, 0, false); return; }   // 선택이 없으면 첫 입력은 A1 로 진입
    const cur = activeCell();
    const ext = e.shiftKey;
    const jump = (dr, dc) => { const p = jumpToDataEdge(cur.row, cur.col, dr, dc); moveActive(p.row, p.col, ext); };
    switch (key){
      case "ArrowUp":    if (mod) jump(-1, 0); else moveActive(cur.row - 1, cur.col, ext); break;   // Ctrl: 데이터 경계로
      case "ArrowDown":  if (mod) jump(1, 0); else moveActive(cur.row + 1, cur.col, ext); break;
      case "ArrowLeft":  if (mod) jump(0, -1); else moveActive(cur.row, cur.col - 1, ext); break;
      case "ArrowRight": if (mod) jump(0, 1); else moveActive(cur.row, cur.col + 1, ext); break;
      case "Home":       moveActive(mod ? 0 : cur.row, 0, ext); break;                            // Ctrl+Home: A1
      case "End":        moveActive(mod ? rowCount - 1 : cur.row, maxCols - 1, ext); break;       // Ctrl+End: 마지막 셀
      case "PageUp":     moveActive(cur.row - pageRows(), cur.col, ext); break;
      case "PageDown":   moveActive(cur.row + pageRows(), cur.col, ext); break;
    }
  };
  sheet.addEventListener("keydown", handleSheetKeydown);
  // 더블클릭(보기 모드): 셀 값 복사. 드래그 선택이 sheet.setPointerCapture 를 걸면 브라우저가
  // click/dblclick 을 캡처 대상(sheet)으로 재타깃해 셀 리스너에는 이벤트가 안 닿는다.
  // 그래서 sheet 에 달고, 재타깃된 경우엔 좌표(elementFromPoint)로 실제 셀을 찾는다.
  const cellFromDblClick = (e) => {
    let cell = e.target && e.target.closest ? e.target.closest("[data-row][data-col]") : null;
    if (!cell){
      const el = document.elementFromPoint(e.clientX, e.clientY);
      cell = el && el.closest ? el.closest("[data-row][data-col]") : null;
    }
    return cell && sheet.contains(cell) ? cell : null;
  };
  const handleCopyDblClick = async (e) => {
    const cell = cellFromDblClick(e);
    if (!cell) return;
    await copySpreadsheetText(cell.textContent || "");
    toast("셀 값을 복사했어요.", 1200);
  };
  if (!opts.editable) sheet.addEventListener("dblclick", handleCopyDblClick);   // 편집 모드에선 더블클릭이 '셀 편집'
  setupSheetResize(sheet, table, colRow, rows, label);
  // 첫 행(머리글) 고정을 위해 열 머리글 줄 높이를 CSS 변수로 노출 → .xlsx-edit-header 를 그 아래에 sticky 로 붙인다.
  try { const hh = Math.round(colRow.getBoundingClientRect().height) || 30; sheet.style.setProperty("--sheet-head-h", hh + "px"); } catch(_){}
  sheet._spreadsheetCleanup = () => {
    sheet.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("pointermove", queueDragFrame);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
    sheet.removeEventListener("keydown", handleSheetKeydown);
    if (dragFrame) cancelAnimationFrame(dragFrame);
    clearTimeout(contentFlashTimer);
    sheet.removeEventListener("dblclick", handleCopyDblClick);
    delete sheet._focusContentCell;
    delete sheet._selectSpreadsheetElement;
    delete sheet.dataset.selectionContiguous;
    delete sheet.dataset.selectionCount;
    delete sheet._spreadsheetCleanup;
  };
  applySelection(null);
}

// 열 폭·행 높이를 화면에서 드래그로 조절(보기 전용 — 파일에는 저장하지 않음).
// 조절값은 sheet 요소에 시트 이름별로 보관해, 편집·필터·정렬·페이지 이동으로 표가 다시 그려져도 유지한다.
// 열 머리글 오른쪽 끝·행 머리글 아래쪽 끝의 얇은 손잡이를 끌고, 더블클릭하면 자동 크기(측정값/기본)로 되돌린다.
function setupSheetResize(sheet, table, colRow, rows, label){
  if (!colRow) return;
  const key = label || "sheet";
  if (!sheet.__sheetSizes) sheet.__sheetSizes = {};
  const sizes = sheet.__sheetSizes[key] || (sheet.__sheetSizes[key] = { col:{}, row:{} });
  const MIN_W = 32, MIN_H = 22;

  const colHeads = Array.from(colRow.querySelectorAll(".sheet-col-head"));
  const corner = colRow.querySelector(".sheet-corner");
  if (!colHeads.length) return;

  // 자동 레이아웃 상태에서 현재 렌더된 폭을 먼저 측정 → 고정 레이아웃으로 바꿔도 반사(리플로우)가 없다.
  const rowHeadW = sheet.closest(".xlsx-workspace") ? 46 : Math.max(MIN_W, Math.round((corner && corner.getBoundingClientRect().width) || 46));
  const workspace = !!sheet.closest(".xlsx-workspace");
  const measured = colHeads.map(th => workspace ? 80 : Math.max(MIN_W, Math.round(th.getBoundingClientRect().width) || 80));

  const colgroup = document.createElement("colgroup");
  const headCol = document.createElement("col");
  headCol.style.width = rowHeadW + "px";
  colgroup.appendChild(headCol);
  const cols = colHeads.map((th, c) => {
    const col = document.createElement("col");
    col.style.width = (sizes.col[c] != null ? sizes.col[c] : measured[c]) + "px";
    colgroup.appendChild(col);
    return col;
  });
  table.insertBefore(colgroup, table.firstChild);
  table.classList.add("sheet-sized");                        // table-layout:fixed + 셀 말줄임(CSS)
  const applyTableWidth = () => {
    const total = rowHeadW + cols.reduce((sum, col) => sum + (parseFloat(col.style.width) || 0), 0);
    table.style.width = total + "px";
  };
  applyTableWidth();
  rows.forEach((tr, r) => { if (sizes.row[r] != null) tr.style.height = sizes.row[r] + "px"; });

  const addGrip = (parent, cls) => { const g = document.createElement("div"); g.className = cls; parent.appendChild(g); return g; };
  const wireDrag = (grip, onStart, onMove) => {
    grip.addEventListener("mousedown", (e) => e.stopPropagation());   // 행/열 선택(mousedown)과 충돌 방지
    let drag = null;
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch(_){}
      drag = onStart(e); grip.classList.add("dragging");
    });
    grip.addEventListener("pointermove", (e) => { if (drag) onMove(e, drag); });
    const end = (e) => { if (!drag) return; try { grip.releasePointerCapture(e.pointerId); } catch(_){} drag = null; grip.classList.remove("dragging"); };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };

  colHeads.forEach((th, c) => {
    const grip = addGrip(th, "sheet-col-resizer");
    grip.title = "끌어서 열 폭 조절 · 더블클릭 자동 맞춤";
    grip.addEventListener("dblclick", (e) => { e.stopPropagation(); delete sizes.col[c]; cols[c].style.width = measured[c] + "px"; applyTableWidth(); });
    wireDrag(grip,
      (e) => ({ px:e.clientX, w:parseFloat(cols[c].style.width) || measured[c] }),
      (e, drag) => {
        const w = Math.max(MIN_W, Math.round(drag.w + (e.clientX - drag.px)));
        cols[c].style.width = w + "px"; sizes.col[c] = w; applyTableWidth();
      });
  });

  rows.forEach((tr, r) => {
    const th = tr.querySelector(".sheet-row-head"); if (!th) return;
    // 파일 저장용으로 화면 행 index 가 아니라 실제 모델 행(data-mrow)에 높이를 기록한다(필터·정렬과 무관).
    const dataCell = tr.querySelector("td[data-mrow]");
    const mrow = dataCell ? Number(dataCell.dataset.mrow) : null;
    const grip = addGrip(th, "sheet-row-resizer");
    grip.title = "끌어서 행 높이 조절 · 더블클릭 자동 맞춤";
    grip.addEventListener("dblclick", (e) => {
      e.stopPropagation(); delete sizes.row[r]; tr.style.height = "";
      if (mrow != null && sizes.rowModel) delete sizes.rowModel[mrow];
    });
    wireDrag(grip,
      (e) => ({ py:e.clientY, h:tr.getBoundingClientRect().height }),
      (e, drag) => {
        const h = Math.max(MIN_H, Math.round(drag.h + (e.clientY - drag.py)));
        tr.style.height = h + "px"; sizes.row[r] = h;
        if (mrow != null){ (sizes.rowModel || (sizes.rowModel = {}))[mrow] = h; }
      });
  });
}

// 화면 픽셀 → 엑셀 단위 변환(열 폭=문자 수, 행 높이=포인트)
function pxToExcelColWidth(px){ return Math.max(1, Math.round(((Number(px) || 0) - 5) / 7 * 100) / 100); }
function pxToExcelRowHeight(px){ return Math.max(6, Math.round((Number(px) || 0) * 0.75 * 100) / 100); }
function excelColWidthToPx(width){ return Math.max(32, Math.round((Number(width) || 0) * 7 + 5)); }
function excelRowHeightToPx(height){ return Math.max(22, Math.round((Number(height) || 0) / 0.75)); }

// ExcelJS가 읽은 원본 열 폭·행 높이·자동 줄바꿈을 화면 단위로 정규화한다.
// 일반 삽입 그림(oneCellAnchor)은 픽셀 크기를 그대로 갖기 때문에, 이 레이아웃이 먼저 적용돼야
// 각 그림이 Excel에서처럼 자기 행과 열에 맞춰 보이고 다음 행의 그림과 겹치지 않는다.
function spreadsheetWorksheetDisplayLayout(workbook, sheetName){
  const worksheet = workbook && typeof workbook.getWorksheet === "function" ? workbook.getWorksheet(sheetName) : null;
  const layout = { columns:{}, rows:{}, wrapCells:[] };
  if (!worksheet) return layout;
  (worksheet.columns || []).forEach((column, index) => {
    if (column && Number(column.width) > 0) layout.columns[index] = excelColWidthToPx(column.width);
  });
  if (typeof worksheet.eachRow === "function") worksheet.eachRow({ includeEmpty:true }, (row, rowNumber) => {
    if (row && Number(row.height) > 0) layout.rows[rowNumber - 1] = excelRowHeightToPx(row.height);
    if (!row || typeof row.eachCell !== "function") return;
    row.eachCell({ includeEmpty:false }, (cell, colNumber) => {
      if (cell && cell.alignment && cell.alignment.wrapText) layout.wrapCells.push({ row:rowNumber - 1, col:colNumber - 1 });
    });
  });
  return layout;
}

// CSV 첫 줄이 머리글(컬럼명)인지 실제 데이터인지 추정한다.
// 숫자 위주 열인데 첫 줄만 텍스트면 머리글, 첫 줄도 숫자면 데이터. 애매하면 기존 동작대로 머리글로 본다.
function spreadsheetGuessHeader(rows){
  if (!Array.isArray(rows) || rows.length < 2) return true;
  const head = rows[0] || [];
  const cols = head.length;
  if (!cols) return true;
  const sampleN = Math.min(rows.length, 50);
  const isBlank = (v) => String(v == null ? "" : v).trim() === "";
  const isNum = (v) => { const s = String(v == null ? "" : v).trim().replace(/,/g, ""); return s !== "" && isFinite(Number(s)); };
  let voteHeader = 0, voteData = 0, blanksInHead = 0;
  for (let c = 0; c < cols; c++){
    if (isBlank(head[c])) blanksInHead++;
    let num = 0, nonBlank = 0;
    for (let r = 1; r < sampleN; r++){ const v = rows[r] && rows[r][c]; if (isBlank(v)) continue; nonBlank++; if (isNum(v)) num++; }
    if (!nonBlank) continue;
    if (num / nonBlank >= 0.8){                        // 숫자 위주 열
      if (isNum(head[c])) voteData += 1;               // 첫 줄도 숫자 → 데이터
      else voteHeader += 1;                            // 첫 줄만 텍스트 → 전형적 머리글
    } else if (!isBlank(head[c]) && !isNum(head[c])){  // 텍스트 열 + 첫 줄도 텍스트
      voteHeader += 0.3;                               // 약한 머리글 신호
    }
  }
  const vals = head.map(v => String(v == null ? "" : v).trim());
  if (blanksInHead === 0 && new Set(vals).size === vals.length) voteHeader += 0.5;   // 머리글은 보통 값이 고유
  if (blanksInHead > 0) voteData += 1;                 // 첫 줄에 빈 칸이 있으면 머리글로 보기 어렵다
  return voteHeader >= voteData;                       // 동점이면 머리글(기존 기본과 일치)
}

// CSV→XLSX 변환 직전 '첫 줄을 머리글로 쓸까요?'를 한 번 묻는다. 추정 결과를 기본(추천)으로 표시.
// 반환: true(머리글) / false(데이터) / null(취소)
function promptCsvHeaderChoice(firstRow, guessHasHeader){
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "csv-header-ask";
    const sample = (firstRow || []).slice(0, 8).map(v => String(v == null ? "" : v)).join("  ·  ") || "(빈 줄)";
    overlay.innerHTML =
      '<div class="csv-header-card" role="dialog" aria-modal="true">' +
      '<strong>첫 줄을 머리글로 쓸까요?</strong>' +
      '<div class="csv-header-sample">첫 줄: ' + escapeChartText(sample) + '</div>' +
      '<div class="csv-header-hint">' + (guessHasHeader ? "컬럼명처럼 보여요." : "실제 데이터처럼 보여요.") + ' 원하는 쪽을 고르세요.</div>' +
      '<div class="csv-header-actions">' +
        '<button data-h="1" class="' + (guessHasHeader ? "primary" : "") + '">머리글로 사용' + (guessHasHeader ? " (추천)" : "") + '</button>' +
        '<button data-h="0" class="' + (guessHasHeader ? "" : "primary") + '">데이터로 사용' + (guessHasHeader ? "" : " (추천)") + '</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    const done = (val) => { overlay.remove(); document.removeEventListener("keydown", onKey, true); resolve(val); };
    const onKey = (e) => {
      if (e.key === "Escape"){ e.preventDefault(); done(null); }
      else if (e.key === "Enter"){ e.preventDefault(); done(guessHasHeader); }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector('[data-h="1"]').onclick = () => done(true);
    overlay.querySelector('[data-h="0"]').onclick = () => done(false);
    const rec = overlay.querySelector(".csv-header-actions .primary") || overlay.querySelector(".csv-header-actions button");
    if (rec) rec.focus();
  });
}

function renderCsvPreview(text, host, filename, ownerDoc){
  if (ownerDoc){ ownerDoc.contentSearchFocus = null; ownerDoc.sheetRows = null; }
  const rowStarts = indexCsvRows(text);
  if (!rowStarts.length){ host.textContent = "CSV 파일이 비어 있습니다."; return; }
  const recordAt = (index) => text.slice(rowStarts[index], index + 1 < rowStarts.length ? rowStarts[index + 1] : text.length);
  const delimiter = detectCsvDelimiter(recordAt(0));
  const firstRow = parseCsvRecord(recordAt(0), delimiter);
  // 첫 줄이 머리글(컬럼명)인지 실제 데이터인지 추정 → 미리보기와 XLSX 변환이 같은 판정을 쓴다.
  const sampleRows = [];
  for (let i = 0; i < Math.min(rowStarts.length, 50); i++) sampleRows.push(i === 0 ? firstRow : parseCsvRecord(recordAt(i), delimiter));
  const hasHeader = spreadsheetGuessHeader(sampleRows);
  const headerOffset = hasHeader ? 1 : 0;
  const header = hasHeader ? firstRow : null;             // 열 머리글 텍스트(머리글일 때만; 아니면 A/B/C)
  // 한 페이지 셀 수를 ~8000으로 묶는다. 컬럼이 아주 많은 표(수천 열)에서 50행 강제로 수십만 셀을 만들어 멈추던 문제 방지.
  const pageSize = Math.max(2, Math.min(500, Math.floor(8000 / Math.max(1, firstRow.length))));
  const dataRows = Math.max(0, rowStarts.length - headerOffset);
  const pages = Math.max(1, Math.ceil(dataRows / pageSize));
  let page = 0;

  // 페이지 네비 + XLSX 변환·편집을 별도 줄로 두지 않고, 선택 바(enhance) 앞쪽에 합쳐 한 줄로 보여준다.
  const pagenav = document.createElement("span"); pagenav.className = "csv-pagenav";
  const prev = document.createElement("button"); prev.textContent = "◀ 이전";
  const status = document.createElement("span"); status.className = "csv-pagestatus";
  const next = document.createElement("button"); next.textContent = "다음 ▶";
  pagenav.append(prev, status, next);
  // CSV → XLSX 변환 후 새 편집 탭으로 바로 열기
  if (typeof XLSX !== "undefined"){
    const toXlsx = document.createElement("button"); toXlsx.textContent = "XLSX로 변환·편집";
    toXlsx.title = "이 CSV 전체를 XLSX로 변환해 새 편집 탭에서 열기";
    toXlsx.addEventListener("click", async () => {
      if (rowStarts.length > 300000){ toast("행이 너무 많아 변환할 수 없어요(30만 행 초과).", 2600); return; }
      toXlsx.disabled = true;
      try {
        const aoa = [];
        for (let i = 0; i < rowStarts.length; i++) aoa.push(parseCsvRecord(recordAt(i), delimiter));
        // 변환 직전 '첫 줄을 머리글로?'를 한 번 확인(추정 결과를 추천으로). 취소면 변환 중단.
        const useHeader = await promptCsvHeaderChoice(aoa[0], hasHeader);
        if (useHeader == null) return;
        const nb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
        const out = XLSX.write(nb, { type: "array", bookType: "xlsx" });
        const name = sheetBaseName(filename) + ".xlsx";
        const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (typeof handleFiles === "function"){
          const openOptions = spreadsheetConvertedDocOptions(ownerDoc, name, aoa, useHeader);
          await handleFiles([new File([out], name, { type:mime })], openOptions);
          toast(useHeader ? "XLSX로 변환해 편집 탭을 열었어요(첫 줄=머리글)." : "XLSX로 변환해 편집 탭을 열었어요(첫 줄=데이터).", 2400);
        } else {
          downloadSpreadsheetFile(out, name, mime);
          toast("XLSX로 변환해 저장했어요.", 1800, { type: "success" });
        }
      } catch(e){ console.error(e); toast("변환하지 못했어요.", 2200); }
      finally { toXlsx.disabled = false; }
    });
    pagenav.append(toXlsx);
  }
  if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(pagenav);
  if (pages <= 1){ prev.hidden = true; next.hidden = true; }   // 한 페이지면 이동 버튼 숨김(상태·저장은 유지)
  const sheet = document.createElement("div"); sheet.className = "xlsx-sheet csv-sheet";
  host.append(sheet);                                          // 선택 바는 enhance 가 sheet 앞에 만들어 끼운다

  const appendRow = (body, cells) => {
    const tr = document.createElement("tr");
    cells.forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); });
    body.appendChild(tr);
  };
  const showPage = (nextPage) => {
    page = Math.max(0, Math.min(pages - 1, nextPage));
    const table = document.createElement("table"), body = document.createElement("tbody");
    const start = headerOffset + page * pageSize;          // 머리글이 있으면 데이터는 1행부터, 없으면 0행부터
    const end = Math.min(rowStarts.length, start + pageSize);
    for (let i = start; i < end; i++) appendRow(body, parseCsvRecord(recordAt(i), delimiter));
    table.appendChild(body); sheet.replaceChildren(table); sheet.scrollTop = 0; sheet.scrollLeft = 0;
    // 머리글이면 첫 줄을 열 머리글로(colLabels), 아니면 A/B/C. 왼쪽 행 번호는 페이지에 맞춰 이어지게(rowStart).
    enhanceSpreadsheetSelection(sheet, "CSV", { extra: pagenav, colLabels: header, rowStart: page * pageSize });
    const firstNo = page * pageSize + 1, lastNo = page * pageSize + (end - start);
    status.textContent = dataRows
      ? `${firstNo.toLocaleString()}-${lastNo.toLocaleString()} / 총 ${dataRows.toLocaleString()}행`
      : (hasHeader ? "데이터 없음(머리글만)" : "데이터 없음");
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
  };
  // 형식 변환 창이 이 CSV 를 통째로 가져갈 수 있게 하는 통로(xlsx 뷰어의 sheetRows 와 같은 규약).
  // 아주 큰 파일은 변환 창에 올리는 것 자체가 무거우므로 넘기지 않는다 — 창은 빈 채로 열린다.
  const CSV_CONVERT_MAX_ROWS = 20000;
  if (ownerDoc) ownerDoc.sheetRows = () => {
    if (rowStarts.length > CSV_CONVERT_MAX_ROWS) return null;
    const out = [];
    for (let i = 0; i < rowStarts.length; i++) out.push(parseCsvRecord(recordAt(i), delimiter));
    return out;
  };
  if (ownerDoc){
    ownerDoc.contentSearchFocus = (query) => {
      const needle = String(query || "").toLocaleLowerCase();
      if (!needle) return false;
      let found = null;
      for (let row = 0; row < rowStarts.length && !found; row++){
        const cells = parseCsvRecord(recordAt(row), delimiter);
        for (let col = 0; col < cells.length; col++){
          if (String(cells[col] || "").toLocaleLowerCase().includes(needle)){
            found = { row, col };
            break;
          }
        }
      }
      if (!found) return false;
      const dataIndex = found.row - headerOffset;              // 머리글이 있으면 0행은 머리글(-1), 없으면 0행도 데이터
      const targetPage = dataIndex < 0 ? 0 : Math.floor(dataIndex / pageSize);
      const visibleRow = dataIndex < 0 ? -1 : (dataIndex % pageSize);
      showPage(targetPage);
      requestAnimationFrame(() => {
        if (typeof sheet._focusContentCell === "function") sheet._focusContentCell(visibleRow, found.col);
      });
      return true;
    };
  }
  prev.onclick = () => showPage(page - 1);
  next.onclick = () => showPage(page + 1);
  showPage(0);
}

// ExcelJS 셀 값/스타일 스냅샷은 Date·수식 결과·리치텍스트 같은 중첩 값을 포함한다.
// JSON 왕복은 Date와 undefined를 잃으므로 XLSX 편집 모델 전용 복제기를 사용한다.
function cloneSpreadsheetValue(value){
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneSpreadsheetValue);
  if (value && typeof value === "object"){
    const out = {};
    Object.keys(value).forEach(key => { out[key] = cloneSpreadsheetValue(value[key]); });
    return out;
  }
  return value;
}

function spreadsheetCellValueSnapshot(cell){
  const value = cell && cell.value;
  // 공유 수식은 원본 master 주소에 종속되므로 독립 수식으로 풀어 두어 행 이동 후에도 수식 자체가 남게 한다.
  if (value && typeof value === "object" && value.sharedFormula !== undefined){
    return { formula: cell.formula, result: cloneSpreadsheetValue(value.result) };
  }
  return cloneSpreadsheetValue(value);
}

function decodeSpreadsheetMerge(range){
  const match = String(range || "").match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i);
  if (!match) return null;
  const col = (letters) => {
    let value = 0;
    for (const ch of letters.toUpperCase()) value = value * 26 + ch.charCodeAt(0) - 64;
    return value - 1;
  };
  return { s:{ c:col(match[1]), r:Number(match[2]) - 1 }, e:{ c:col(match[3]), r:Number(match[4]) - 1 } };
}

function encodeSpreadsheetCell(row, col){
  let letters = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters + String(row + 1);
}

function adjustSpreadsheetMergesAfterRowDelete(merges, deletedRows){
  const deleted = [...new Set((deletedRows || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!deleted.length) return (merges || []).slice();
  const removedBefore = (row) => {
    let count = 0;
    while (count < deleted.length && deleted[count] < row) count++;
    return count;
  };
  const deletedSet = new Set(deleted);
  const result = [];
  (merges || []).forEach(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range){ result.push(text); return; }
    let first = -1, last = -1;
    for (let row = range.s.r; row <= range.e.r; row++){
      if (deletedSet.has(row)) continue;
      const shifted = row - removedBefore(row);
      if (first < 0) first = shifted;
      last = shifted;
    }
    if (first < 0) return;
    if (first === last && range.s.c === range.e.c) return;
    result.push(encodeSpreadsheetCell(first, range.s.c) + ":" + encodeSpreadsheetCell(last, range.e.c));
  });
  return result;
}

function adjustSpreadsheetMergesAfterRowInsert(merges, row, count=1){
  const amount = Math.max(1, Number(count) || 1);
  return (merges || []).map(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range) return text;
    if (row <= range.s.r){ range.s.r += amount; range.e.r += amount; }
    else if (row <= range.e.r) range.e.r += amount;
    return encodeSpreadsheetCell(range.s.r, range.s.c) + ":" + encodeSpreadsheetCell(range.e.r, range.e.c);
  });
}

function adjustSpreadsheetMergesAfterColumnInsert(merges, col, count=1){
  const amount = Math.max(1, Number(count) || 1);
  return (merges || []).map(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range) return text;
    if (col <= range.s.c){ range.s.c += amount; range.e.c += amount; }
    else if (col <= range.e.c) range.e.c += amount;
    return encodeSpreadsheetCell(range.s.r, range.s.c) + ":" + encodeSpreadsheetCell(range.e.r, range.e.c);
  });
}

function adjustSpreadsheetMergesAfterColumnDelete(merges, deletedCols){
  const deleted = [...new Set((deletedCols || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!deleted.length) return (merges || []).slice();
  const removedBefore = (col) => {
    let count = 0;
    while (count < deleted.length && deleted[count] < col) count++;
    return count;
  };
  const deletedSet = new Set(deleted);
  const result = [];
  (merges || []).forEach(text => {
    const range = decodeSpreadsheetMerge(text);
    if (!range){ result.push(text); return; }
    let first = -1, last = -1;
    for (let col = range.s.c; col <= range.e.c; col++){
      if (deletedSet.has(col)) continue;
      const shifted = col - removedBefore(col);
      if (first < 0) first = shifted;
      last = shifted;
    }
    if (first < 0) return;
    if (first === last && range.s.r === range.e.r) return;
    result.push(encodeSpreadsheetCell(range.s.r, first) + ":" + encodeSpreadsheetCell(range.e.r, last));
  });
  return result;
}

// 두 셀 범위({s:{r,c},e:{r,c}})가 겹치는지 판정(병합 해제·중복 병합 제거에 사용)
function spreadsheetRangesOverlap(a, b){
  if (!a || !b) return false;
  return a.s.r <= b.e.r && a.e.r >= b.s.r && a.s.c <= b.e.c && a.e.c >= b.s.c;
}

// 클립보드 텍스트(엑셀/구글시트 복사본) 파싱은 grid-selection.js 의 gridClipboardTable 이다.
// DB 클라이언트 결과 표도 같은 파서로 붙여넣으므로 규칙을 한 곳에만 둔다(위쪽에서 이름만 받아 왔다).

/* ===================== 간단 수식 엔진 =====================
   지원: 사칙연산·괄호·거듭제곱(^)·백분율(%)·문자연결(&)·비교(=,<>,<,>,<=,>=),
         셀/범위 참조(A1, A1:B3), 핵심 함수(SUM/AVERAGE/MIN/MAX/COUNT/IF/ROUND …).
   단일 시트 기준. 오류는 {__err:"#..."} 로 전파, 값은 number|string|boolean.
   resolver(colIndex, rowIndex) → 그 셀의 스칼라 값(다른 수식 셀이면 그 결과)을 돌려주는 함수. */
const {
  spreadsheetColumnName, FORMULA_ERR, isFormulaError, spreadsheetDateSerial, spreadsheetDateToSerial, spreadsheetSerialToParts, spreadsheetFormatByPattern, formulaColumnIndex, parseA1Ref, tokenizeFormula, parseFormula, formulaToNumber, formulaToString, formulaToBool, evaluateAst, evaluateFormula, remapFormulaRefs, spreadsheetFormulaSheetName, spreadsheetFormulaSheetToken, remapMovedFormulaRefs, remapFormulaSheetName, SPREADSHEET_FILL_CYCLES, spreadsheetTextSeries, SPREADSHEET_FN_HELP, formulaTypingContext, spreadsheetAutoFormulaJobs
} = typeof MNSpreadsheetFormula !== "undefined"
  ? MNSpreadsheetFormula
  : require("./spreadsheet-formula.js");

const spreadsheetFormulaFunctions = typeof MNSpreadsheetFormula !== "undefined" ? MNSpreadsheetFormula : require("./spreadsheet-formula.js");
const spreadsheetTools = typeof MNSpreadsheetTools !== "undefined" ? MNSpreadsheetTools : require("./spreadsheet-tools.js");
const SPREADSHEET_CHART_COLORS = ["#4f46e5","#10b981","#f59e0b","#ef4444","#0ea5e9","#8b5cf6","#ec4899","#14b8a6","#f97316","#64748b"];
function escapeChartText(s){ return String(s == null ? "" : s).replace(/[<>&]/g, ch => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[ch])); }
function buildSpreadsheetChartSvg(type, labels, values, opts){
  opts = opts || {};
  const W = opts.width || 640, H = opts.height || 380;
  const n = values.length;
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString();
  const axisColor = "#94a3b8", gridColor = "#e2e8f0", textColor = "#334155";
  if (type === "pie"){
    const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    const cx = W * 0.36, cy = H / 2, R = Math.min(W * 0.30, H * 0.40);
    let ang = -Math.PI / 2, parts = "";
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total, a2 = ang + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
      const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      const col = SPREADSHEET_CHART_COLORS[i % SPREADSHEET_CHART_COLORS.length];
      parts += n === 1
        ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${col}"/>`
        : `<path d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${col}"/>`;
      ang = a2;
    });
    let legend = "";
    labels.forEach((lab, i) => {
      const ly = 40 + i * 22; const col = SPREADSHEET_CHART_COLORS[i % SPREADSHEET_CHART_COLORS.length];
      const pct = Math.round(Math.max(0, values[i]) / total * 100);
      legend += `<rect x="${W * 0.66}" y="${ly - 10}" width="12" height="12" rx="2" fill="${col}"/>` +
        `<text x="${W * 0.66 + 18}" y="${ly}" font-size="12" fill="${textColor}">${escapeChartText(lab)} · ${pct}%</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts}${legend}</svg>`;
  }
  // 막대/선 공통: 좌표축 + 눈금
  const padL = 52, padR = 18, padT = 24, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(0, ...values), minV = Math.min(0, ...values);
  const span = (maxV - minV) || 1;
  const y = (v) => padT + plotH * (1 - (v - minV) / span);
  const isLine = type === "line";
  // 선: 양 끝까지 채움 / 막대: 구간 중앙(마지막 막대·라벨이 잘리지 않게)
  const x = (i) => isLine ? padL + (n <= 1 ? plotW / 2 : plotW * i / (n - 1))
                          : padL + plotW * (i + 0.5) / n;
  let grid = "", ticks = 5;
  for (let t = 0; t <= ticks; t++){
    const v = minV + span * t / ticks, yy = y(v);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="${gridColor}"/>` +
      `<text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${textColor}">${fmt(v)}</text>`;
  }
  let body = "", xlabels = "";
  const labelStep = Math.ceil(n / 12);
  for (let i = 0; i < n; i++){
    if (i % labelStep === 0)
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - padB + 16}" font-size="11" text-anchor="middle" fill="${textColor}">${escapeChartText(labels[i])}</text>`;
  }
  if (type === "line"){
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    body += `<polyline points="${pts}" fill="none" stroke="${SPREADSHEET_CHART_COLORS[0]}" stroke-width="2.5"/>`;
    values.forEach((v, i) => { body += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${SPREADSHEET_CHART_COLORS[0]}"/>`; });
  } else {
    const bw = Math.max(4, (n <= 1 ? plotW * 0.4 : plotW / n * 0.66));
    values.forEach((v, i) => {
      const bx = x(i) - bw / 2, top = Math.min(y(v), y(0)), h = Math.abs(y(v) - y(0));
      body += `<rect x="${bx.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${SPREADSHEET_CHART_COLORS[i % SPREADSHEET_CHART_COLORS.length]}"/>`;
    });
  }
  const zeroY = y(0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    grid +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${axisColor}"/>` +
    `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="${axisColor}"/>` +
    body + xlabels + `</svg>`;
}

function spreadsheetVirtualWindow(totalRows, scrollTop, viewportHeight, rowHeight=29, overscan=14){
  const total = Math.max(0, Number(totalRows) || 0);
  const height = Math.max(1, Number(rowHeight) || 29);
  const extra = Math.max(0, Number(overscan) || 0);
  const count = Math.min(total, Math.max(20, Math.ceil((Number(viewportHeight) || 500) / height) + extra * 2));
  const start = Math.max(0, Math.min(Math.max(0, total - count), Math.floor((Number(scrollTop) || 0) / height) - extra));
  return {
    start,
    count,
    topHeight:start * height,
    bottomHeight:Math.max(0, (total - start - count) * height)
  };
}

// 화면용 빈 셀은 데이터 범위에서 제외한다. 입력·수식·서식이 생기면 실제 셀로 취급한다.
function spreadsheetWorkspaceBounds(model){
  let rows = 1, cols = 1;
  (model || []).forEach((row, r) => (row || []).forEach((cell, c) => {
    if (!cell) return;
    if (cell.workspaceBlank && (cell.v == null || cell.v === "") && cell.xv == null
      && !cell.f && !cell.nf && !cell.dv && !Object.keys(cell.style || {}).length) return;
    rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1);
  }));
  return { rows, cols };
}

function spreadsheetDataModel(model){
  const { rows, cols } = spreadsheetWorkspaceBounds(model);
  return (model || []).slice(0, rows).map(row => row.slice(0, cols));
}

function spreadsheetEnsureWorkspace(model, viewportWidth=0){
  if (!model || !model.length) return false;
  const bounds = spreadsheetWorkspaceBounds(model);
  const oldRows = model.length, oldCols = model[0].length;
  // 큰 파일에 빈 칸을 곱해서 붙이지 않도록 한 번에 추가하는 셀 수를 제한한다.
  const budget = 12000;
  const wantCols = Math.min(16384, Math.max(26, Math.ceil(viewportWidth / 80) + 4, bounds.cols + 8));
  const cols = oldCols + Math.max(0, Math.min(wantCols - oldCols, Math.floor(budget / oldRows)));
  const remaining = budget - (cols - oldCols) * oldRows;
  const wantRows = Math.min(1048576, Math.max(40, bounds.rows + 16));
  const rows = oldRows + Math.max(0, Math.min(wantRows - oldRows, Math.floor(remaining / Math.max(1, cols))));
  if (rows === oldRows && cols === oldCols) return false;
  const blank = () => ({ v:"", xv:null, nf:null, style:{}, f:null, workspaceBlank:true });
  // 행 배열 교체로 CSV의 copy-on-write 되돌리기 기록도 보존한다.
  if (cols > oldCols) model.forEach((row, r) => {
    model[r] = row.concat(Array.from({ length:cols - row.length }, blank));
  });
  while (model.length < rows) model.push(Array.from({ length:cols }, blank));
  return true;
}

function writeStructuredSpreadsheetModel(ws, model, merges){
  model = spreadsheetDataModel(model);
  ws.eachRow({includeEmpty:true},(row,r)=>row.eachCell({includeEmpty:false},(cell,c)=>{
    if(r<=model.length && c>(model[r-1]?.length || 0)){cell.value=null;cell.style={};spreadsheetTools.writeValidation(ws,cell,{});}
  }));
  const existingMerges = (ws && ws.model && Array.isArray(ws.model.merges)) ? ws.model.merges.slice() : [];
  existingMerges.forEach(range => { try { ws.unMergeCells(range); } catch(_){} });
  if (ws.rowCount > model.length) ws.spliceRows(model.length + 1, ws.rowCount - model.length);
  for (let r = 0; r < model.length; r++){
    for (let c = 0; c < model[r].length; c++){
      const snapshot = model[r][c];
      const cell = ws.getCell(r + 1, c + 1);
      spreadsheetTools.writeValidation(ws, cell, snapshot);
      if (snapshot.f){                                   // 수식 셀: 수식 + 마지막 계산 결과를 함께 저장
        const result = (snapshot.v === "" || snapshot.v == null) ? null : cloneSpreadsheetValue(snapshot.v);
        cell.value = snapshot.unsupportedFormula && snapshot.xv && typeof snapshot.xv === "object"
          ? { formula:spreadsheetFormulaFunctions.excelFormula(snapshot.f), result:cloneSpreadsheetValue(snapshot.xv.result) }
          : { formula:spreadsheetFormulaFunctions.excelFormula(snapshot.f), result:typeof result === "string" && /^#(REF!|DIV\/0!|NAME\?|VALUE!|NUM!|N\/A|NULL!|CALC!|CYCLE!|ERROR!)/.test(result) ? {error:result} : result };
        cell.style = cloneSpreadsheetValue(snapshot.style || {});
        continue;
      }
      const value = snapshot.xv !== undefined ? snapshot.xv : snapshot.v;
      cell.value = (value === "" ? null : cloneSpreadsheetValue(value));
      // 빈 스타일도 명시적으로 써야 정렬 전 위치의 서식이 새 셀에 잔류하지 않는다.
      cell.style = cloneSpreadsheetValue(snapshot.style || {});

    }
  }
  (merges || []).forEach(range => { try { ws.mergeCells(range); } catch(_){} });
}

async function renderXlsx(file, host, doc){
  if (doc && /\.xlsx$/i.test(String(file && file.name || doc.name || ""))) doc.saveCapability = "spreadsheet";
  if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("xlsx");   // 엑셀 뷰어는 표를 열 때 처음 로드
  if (typeof XLSX === "undefined"){ toast("Excel 뷰어 로드 실패"); return; }
  const csvFastAoa = doc && Array.isArray(doc.spreadsheetAoa) ? doc.spreadsheetAoa : null;
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (looksEncryptedOffice(bytes)){
    const dec = await promptAndDecrypt(bytes, "xlsx");
    if (!dec) throw new Error("cancelled");             // 취소/실패 → 드롭존
    bytes = dec;
  }
  if (/\.csv$/i.test(file.name)){
    renderCsvPreview(smartDecodeText(bytes), host, file.name, doc);
    return;
  }
  host.classList.add("xlsx-workspace");
  let wb;
  if (csvFastAoa){
    const rows = Math.max(1, csvFastAoa.length);
    const cols = Math.max(1, csvFastAoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0));
    // 변환 직후에는 이미 CSV 행 배열이 있으므로 같은 XLSX를 SheetJS로 다시 풀지 않는다.
    wb = { SheetNames:["Sheet1"], Sheets:{ Sheet1:{ "!ref":"A1:" + spreadsheetColumnName(cols - 1) + rows } } };
  } else {
    try { wb = XLSX.read(bytes, { type: "array" }); } catch(e){ wb = null; }
  }
  // 한컴 한셀 등에서 일부 시트가 비어버리거나(또는 파싱 실패) 하면 정화 후 재시도
  if (!csvFastAoa && (!wb || wb.SheetNames.some(n => !wb.Sheets[n]))){
    // 한컴 파일을 만난 이 경로에서만 JSZip 이 필요하다(보통 표는 여기까지 오지 않는다).
    if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("jszip");
    const fixed = sanitizeHancomSpreadsheet(bytes);
    if (fixed !== bytes){
      try { wb = XLSX.read(fixed, { type: "array" }); } catch(e){ /* 원본 결과 유지 */ }
    }
  }
  if (!wb || !wb.SheetNames.length){ host.textContent = "시트가 없습니다."; return; }
  if (!csvFastAoa) wb.SheetNames.forEach(n => tightenSheetRange(wb.Sheets[n]));   // 부풀려진 시트 크기 보정(속도)
  let packageImageInfo = { sheets:new Map(), hasRichImages:false, hasDrawingParts:false, parseError:false };
  if (!csvFastAoa){
    if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("jszip");
    packageImageInfo = spreadsheetPackageImageInfo(bytes);
  }
  const formulaImageSheets = spreadsheetFormulaImages(wb);
  // ExcelJS가 아직 보존하지 못하는 Rich Value/IMAGE 수식을 편집 저장하면 셀 그림이 사라질 수 있다.
  // 이런 파일은 원본 바이트 다운로드와 읽기 전용 표시만 허용한다.
  const imageProtectedWorkbook = !!packageImageInfo.hasRichImages || formulaImageSheets.size > 0;
  const tabs = document.createElement("div"); tabs.className = "xlsx-tabs";
  const sheet = document.createElement("div"); sheet.className = "xlsx-sheet";

  // ===== 내보내기: 현재 시트를 CSV/XLSX 로, 또는 전체 통합문서를 XLSX 로 다운로드 =====
  let currentSheet = wb.SheetNames[0];
  let base = sheetBaseName(file.name);   // 첫 저장에서 이름을 바꾸면 내보내기 파일 이름도 따라간다
  const exp = document.createElement("div"); exp.className = "xlsx-export";
  const expLabel = document.createElement("span"); expLabel.className = "xlsx-export-label"; expLabel.textContent = "내보내기:";
  const mkExp = (text, title, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.title = title;
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try { await fn(); } catch(e){ console.error(e); toast("내보내지 못했어요.", 2200); }
      finally { b.disabled = false; }
    });
    return b;
  };
  // 편집 모델이 있으면 그 값(수식 계산 결과 포함)으로 내보내기용 시트를 만든다.
  // CSV 변환본은 SheetJS wb 가 껍데기(스텁)라 편집 모델이 유일한 데이터 원본이다.
  const exportSheetOf = (name) => {
    const model = exModels[name];
    if (!model) return wb.Sheets[name];
    try { maybeRecalc(name); } catch(_){}
    const aoa = spreadsheetDataModel(model).map(row => row.map(cell => {
      const val = cell ? cell.v : null;
      if (val == null || val === "") return null;
      if (typeof val === "object" && !(val instanceof Date)) return dispCell(cell);   // 리치텍스트 등은 표시 문자열로
      return val;
    }));
    return XLSX.utils.aoa_to_sheet(aoa);
  };
  const csvBtn = mkExp("현재 시트 CSV", "현재 시트를 CSV 파일로 저장(Excel 호환 UTF-8)", () => {
    const csv = "﻿" + XLSX.utils.sheet_to_csv(exportSheetOf(currentSheet));   // BOM: Excel 한글 깨짐 방지
    downloadSpreadsheetFile(csv, base + "_" + sanitizeFilePart(currentSheet) + ".csv", "text/csv;charset=utf-8");
    toast("현재 시트를 CSV로 저장했어요.", 1800, { type: "success" });
  });
  const sheetXlsxBtn = mkExp("현재 시트 XLSX", "현재 시트만 새 XLSX 파일로 저장(그림·서식 보존)", async () => {
    if (imageProtectedWorkbook){
      toast("셀 이미지가 있는 파일은 손실 방지를 위해 '전체 XLSX'로 원본을 저장해 주세요.", 3600, { type:"warning" });
      return;
    }
    const out = await exportCurrentSheetExBytes(currentSheet);
    if (!out) throw new Error("xlsx-sheet-export");
    downloadSpreadsheetFile(out, base + "_" + sanitizeFilePart(currentSheet) + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    toast("현재 시트를 XLSX로 저장했어요.", 1800, { type: "success" });
  });
  // 내보내기 버튼은 별도 래퍼로 묶어, 편집 모드에서만 이 래퍼를 숨긴다(모드 토글은 항상 보이게).
  const expBtns = document.createElement("div"); expBtns.className = "xlsx-export-btns";
  const printBtn = mkExp("인쇄·PDF", "현재 시트를 프린터로 인쇄하거나 PDF로 저장", () => printCurrentSheet());
  expBtns.append(expLabel, csvBtn, sheetXlsxBtn, printBtn);
  if (wb.SheetNames.length > 1 || imageProtectedWorkbook){
    expBtns.append(mkExp(wb.SheetNames.length > 1 ? "전체 XLSX" : "원본 XLSX",
      "모든 시트와 그림을 보존해 XLSX 파일로 저장", async () => {
      // 수정하지 않은 원본은 재직렬화하지 않아 최신 셀 이미지와 알 수 없는 OOXML 확장까지 그대로 보존한다.
      const out = (!anyDirty && !csvFastAoa) ? bytes : await exportExBytes();
      if (!out) throw new Error("xlsx-workbook-export");
      downloadSpreadsheetFile(out, base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast(wb.SheetNames.length > 1 ? "전체 시트를 XLSX로 저장했어요." : "원본 XLSX를 저장했어요.", 1800, { type: "success" });
    }));
  }

  // ===== 편집·정렬·필터 모드 (ExcelJS 백엔드 — 셀 서식·색·글꼴·번호서식·병합·수식 보존) =====
  // 보기 모드는 SheetJS(sheet_to_html) 유지. 편집은 원본 바이트를 ExcelJS 로 읽어 '편집한 셀만' 되돌려 써서
  // 손대지 않은 셀의 서식·수식·병합을 그대로 보존한다. 정렬/행·열 구조 변경이 일어난 시트만 전체 재작성.
  let editMode = !!(doc && doc.isScratch) && !imageProtectedWorkbook;
  let viewOptions = null;
  const editTitle = document.createElement("strong"); editTitle.className = "xlsx-edit-title"; editTitle.textContent = "편집 도구";
  const editToggle = document.createElement("button"); editToggle.type = "button"; editToggle.className = "xlsx-editmode-btn";
  editToggle.title = "셀 편집·정렬·필터 모드 (저장 시 서식 보존)";
  const syncEditToggle = () => {
    editToggle.textContent = imageProtectedWorkbook ? "셀 이미지 · 읽기 전용" : (editMode ? "읽기 전용" : "표 편집·정렬");
    editToggle.title = imageProtectedWorkbook ? "셀 이미지를 손실 없이 보존하기 위해 이 파일은 읽기 전용으로 엽니다."
      : (editMode ? "편집을 마치고 읽기 전용으로 전환" : "셀 편집·정렬·필터 모드로 전환");
    editToggle.classList.toggle("active", editMode);
    editTitle.hidden = !editMode;
    if (viewOptions) viewOptions.hidden = !editMode;
    exp.classList.toggle("editing", editMode);
  };
  if (imageProtectedWorkbook){
    editToggle.disabled = true;
  }
  syncEditToggle();
  editToggle.addEventListener("click", () => { editMode = !editMode; syncEditToggle(); rerender(); });
  exp.append(editTitle, editToggle, expBtns);

  const editBar = document.createElement("div"); editBar.className = "xlsx-editbar"; editBar.hidden = true;
  // 수식 입력줄(활성 셀 참조 + 값/수식 편집) — 편집 모드에서만 표시
  const formulaBar = document.createElement("div"); formulaBar.className = "xlsx-formulabar"; formulaBar.hidden = true;
  const fbRef = document.createElement("span"); fbRef.className = "xlsx-fb-ref"; fbRef.textContent = "";
  const fbInput = document.createElement("input"); fbInput.type = "text"; fbInput.className = "xlsx-fb-input";
  fbInput.placeholder = "값 또는 =수식 (예: =SUM(A1:A3))"; fbInput.disabled = true;
    const compatNotice=document.createElement("span");compatNotice.className="xlsx-fb-compat";compatNotice.hidden=true;
    formulaBar.append(fbRef, fbInput,compatNotice);
  // 수식 입력줄도 편집기와 같은 우클릭 메뉴 — 셀에 들어갈 ※ ○ ① 을 여기서 넣을 수 있다.
  if (typeof attachTextCaseContextMenu === "function") attachTextCaseContextMenu(fbInput);
  let fbCell = null;
  host.appendChild(tabs); host.appendChild(exp); host.appendChild(editBar); host.appendChild(formulaBar); host.appendChild(sheet);

  // ----- ExcelJS 워크북 로드(최초 편집 진입 시 1회, 원본 바이트에서) -----
  let exWb = null, exLoadPromise = null;
  const ensureExWb = async () => {
    if (exWb) return exWb;
    if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("exceljs");   // 편집 모드에 들어갈 때 처음 로드
    if (typeof ExcelJS === "undefined") return null;
    if (!exLoadPromise){
      exLoadPromise = (async () => {
        return spreadsheetLoadExcelWorkbook(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ExcelJS);
      })();
    }
    try { exWb = await exLoadPromise; } catch(e){ console.error(e); exWb = null; exLoadPromise = null; }
    return exWb;
  };
  const floatingImageSheets = new Map();
  const sourceLayoutSheets = new Map();
  let spreadsheetMediaPrepared = false;
  const ensureSpreadsheetMedia = async () => {
    if (spreadsheetMediaPrepared) return;
    spreadsheetMediaPrepared = true;
    if (!csvFastAoa && /\.xlsx$/i.test(file.name)){
      const workbook = await ensureExWb();
      if (workbook){
        wb.SheetNames.forEach(name => {
          sourceLayoutSheets.set(name, spreadsheetWorksheetDisplayLayout(workbook, name));
          const images = spreadsheetFloatingImageDescriptors(workbook, name);
          if (images.length) floatingImageSheets.set(name, images);
        });
      }
    }
    wb.SheetNames.forEach(name => {
      const images = [
        ...(packageImageInfo.sheets.get(name) || []),
        ...(formulaImageSheets.get(name) || []),
        ...(floatingImageSheets.get(name) || [])
      ];
      spreadsheetExtendSheetRangeForImages(wb.Sheets[name], images);
    });
  };

  // ----- 셀 값/표시 헬퍼 -----
  const exRaw = (cell) => {
    let v = cell && cell.value;
    if (v === null || v === undefined) return "";
    if (typeof v === "object"){
      if (v instanceof Date) return v;
      if (v.formula !== undefined || v.sharedFormula !== undefined) return (v.result !== undefined && v.result !== null) ? v.result : "";
      if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("");
      if (v.text !== undefined) return v.text;          // 하이퍼링크
      if (v.error !== undefined) return v.error;
      return "";
    }
    return v;
  };
  const dateToSerial = (d) => 25569 + (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000;
  const dispCell = (s) => {
    const v = s.v;
    if (v === "" || v === null || v === undefined) return "";
    if (v instanceof Date){
      if (s.nf){ try { return XLSX.SSF.format(s.nf, dateToSerial(v)); } catch(_){} }
      return v.toISOString().slice(0, 10);
    }
    if (typeof v === "number" && s.nf){ try { return XLSX.SSF.format(s.nf, v); } catch(_){ return String(v); } }
    return String(v);
  };
  const rawText = (s) => (s.v instanceof Date) ? dispCell(s) : (s.v === "" || s.v == null ? "" : String(s.v));
  const coerce = (text, numberFormat) => spreadsheetTools.inputValue(text, numberFormat);


  // ----- 시트별 편집 모델: [[ {v, nf, style} ]] + 변경 추적 -----
  const savedSheetSettings=spreadsheetTools.readSettings(bytes);
  const worksheetViews = {};
  const exModels = {};            // name -> model(2D snapshots)
  const exMerges = {};            // name -> 원본 병합 ["A1:B2", ...]
  const editedCells = {};         // name -> Map("r,c" -> value)  (구조변경 전 값 편집만)
  const styledCells = {};         // name -> Map("r,c" -> true)   (구조변경 전 서식 편집만)
  const structChanged = new Set();// 구조(정렬·행/열) 바뀐 시트 → 저장 시 전체 재작성
  const sheetsWithFormula = new Set();  // 수식이 하나라도 있는 시트 → 편집 시 재계산 대상

  /* 형식 변환 창(MNDataConvert)이 지금 보고 있는 시트를 그대로 가져갈 수 있게 하는 통로.
     화면에 보이는 글자(dispCell)를 넘겨, 사용자가 보는 값과 변환 결과가 어긋나지 않게 한다.
     수식은 계산된 결과가, 날짜·서식 있는 숫자는 표시 문자열이 나간다(=CSV 로 내보낼 때와 같은 규칙). */
  if (doc) doc.sheetRows = () => {
    const model = exModels[currentSheet];
    if (!model) return null;
    return spreadsheetDataModel(model).map(row => {
      const cells = row || [];
      const out = [];
      for (let c = 0; c < cells.length; c++) out.push(cells[c] ? dispCell(cells[c]) : "");
      return out;
    });
  };
  let csvFastModelPromise = null;
  let anyDirty = false;
  let spreadsheetRecoveryTimer = 0;
  let spreadsheetDirtyKnown = false;
  const syncSpreadsheetDirtyState = (reschedule=false) => {
    if (!anyDirty) return;
    if (!spreadsheetDirtyKnown){
      spreadsheetDirtyKnown = true;
      if (doc && typeof markDocumentDirty === "function") markDocumentDirty(doc);
    } else if (!reschedule) return;
    clearTimeout(spreadsheetRecoveryTimer);
    // 셀을 연속 입력할 때마다 XLSX 전체를 만들지 않도록 짧게 모아 작업공간에 저장한다.
    spreadsheetRecoveryTimer = setTimeout(async () => {
      if (!anyDirty || !doc || !doc.hasUnsavedEdits || typeof saveDocumentRecoverySnapshot !== "function") return;
      try {
        const bytes = await exportExBytes();
        if (bytes) await saveDocumentRecoverySnapshot(doc, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      } catch(error){ console.warn("spreadsheet recovery snapshot skipped:", error); }
    }, 1400);
  };
  const spreadsheetDirtyWatch = setInterval(syncSpreadsheetDirtyState, 250);
  const markSpreadsheetSaved = async (bytes) => {
    anyDirty = false;
    spreadsheetDirtyKnown = false;
    clearTimeout(spreadsheetRecoveryTimer);
    if (doc && typeof markDocumentSavedSnapshot === "function"){
      await markDocumentSavedSnapshot(doc, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    if (doc && doc.isScratch) doc._named = true;
  };
  if (doc){
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => { clearTimeout(spreadsheetRecoveryTimer); clearInterval(spreadsheetDirtyWatch); });
  }
  const blankCell = () => ({ v: "", xv: null, nf: null, style: {}, f: null });
  const cellFormula = (cell) => {                        // 수식 셀이면 '=' 없는 수식 문자열, 아니면 null
    const val = cell && cell.value;
    if (val && typeof val === "object" && (val.formula !== undefined || val.sharedFormula !== undefined)){
      const f = cell.formula || val.formula;
      return f ? String(f) : null;
    }
    return null;
  };
  const buildExModel = (ws, name) => {
    let rowN = Math.max(1, ws.rowCount || 1), colN = Math.max(1, ws.columnCount || 1);
    if (doc && doc.isScratch){ rowN = Math.max(rowN, 12); colN = Math.max(colN, 6); }   // 새 빈 표는 넉넉한 격자
    const model = [];
    for (let r = 1; r <= rowN; r++){
      const row = [];
      for (let c = 1; c <= colN; c++){
        const cell = ws.getCell(r, c);
        let style = {}; try { style = cloneSpreadsheetValue(cell.style || {}); } catch(_){ style = {}; }
        const f = cellFormula(cell);
        if (f && name) sheetsWithFormula.add(name);
        // 원본 파일의 인라인 목록 유효성("값1,값2,…") 을 읽어 편집 중에도 드롭다운으로 쓴다.
        let dv = null;
        try {
          const v = cell.dataValidation;
          if (v && v.type === "list" && Array.isArray(v.formulae) && v.formulae.length){
            const m = String(v.formulae[0] || "").match(/^"([\s\S]*)"$/);
            if (m){ const vals = m[1].split(",").map(s => s.trim()).filter(s => s !== ""); if (vals.length) dv = { type:"list", values: vals }; }
          }
        } catch(_){}
        const cellObj = { v: exRaw(cell), xv: spreadsheetCellValueSnapshot(cell), nf: cell.numFmt || null, style, f };
        cellObj.validation = cloneSpreadsheetValue(cell.dataValidation || null);
        if (dv) cellObj.dv = dv;
        row.push(cellObj);
      }
      model.push(row);
    }
    return model;
  };
  const buildCsvFastModel = async () => {
    const rowN = Math.max(1, csvFastAoa.length);
    const colN = Math.max(1, csvFastAoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0));
    const model = [];
    for (let r = 0; r < rowN; r++){
      const source = csvFastAoa[r] || [];
      const row = new Array(colN);
      for (let c = 0; c < colN; c++){
        const value = source[c] == null ? "" : source[c];
        row[c] = { v:value, xv:value === "" ? null : value, nf:null, style:{}, f:null };
      }
      model.push(row);
      if (r > 0 && r % 400 === 0){
        sheet.textContent = "CSV 편집 데이터를 준비하는 중… " + Math.min(r, rowN).toLocaleString() + " / " + rowN.toLocaleString() + "행";
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    // 셀 스냅샷으로 옮긴 뒤 원본 CSV 배열 참조를 비워 메모리 이중 점유를 피한다.
    csvFastAoa.length = 0;
    if (doc) doc.spreadsheetAoa = null;
    return model;
  };
  const exModelFor = async (name) => {
    if (exModels[name]) return exModels[name];
    if (csvFastAoa){
      exMerges[name] = [];
      editedCells[name] = new Map();
      styledCells[name] = new Map();
      if (!csvFastModelPromise) csvFastModelPromise = buildCsvFastModel();
      exModels[name] = await csvFastModelPromise;
      return exModels[name];
    }
    const w = await ensureExWb();
    if (!w) return null;
    // 이름이 바뀐 시트는 원본 파일 속 이름으로 찾는다(모델을 만들기 전에 이름만 바꾼 경우)
    const ws = w.getWorksheet(sheetOrigNames.get(name) || name) || w.getWorksheet(name) || w.worksheets[0];
    exMerges[name] = (ws && ws.model && Array.isArray(ws.model.merges)) ? ws.model.merges.slice() : [];
    editedCells[name] = new Map();
    styledCells[name] = new Map();
    exModels[name] = ws ? buildExModel(ws, name) : [[blankCell()]];
    if (!Object.prototype.hasOwnProperty.call(condRulesBySheet, name))
      condRulesBySheet[name] = ws ? spreadsheetTools.readConditionalRules(ws).map(rule => ({...rule,id:condRuleSeq++})) : [];
    if (ws){
      sourceLayoutSheets.set(name, spreadsheetWorksheetDisplayLayout(w, ws.name));
      if (!worksheetViews[name]){
        const frozen=(ws.views || []).find(v=>v.state==="frozen");
        const hiddenRows=[],hiddenCols=[];
        ws.eachRow({includeEmpty:true},(row,n)=>{if(row.hidden)hiddenRows.push(n-1);});
        (ws.columns || []).forEach((col,n)=>{if(col.hidden)hiddenCols.push(n);});
        worksheetViews[name]={header:initHeaderFrozen,freezeRows:frozen?Number(frozen.ySplit)||0:0,freezeCols:frozen?Number(frozen.xSplit)||0:0,
          hiddenRows,hiddenCols,tables:ws.getTables().map(item=>{
            const t=item.table;return {name:t.name,range:decodeSpreadsheetMerge(t.tableRef || t.ref),columns:(t.columns || []).map(c=>c.name),
              headerRow:t.headerRow,totalsRow:t.totalsRow,style:cloneSpreadsheetValue(t.style),nativeColumns:cloneSpreadsheetValue(t.columns)};
          }).filter(t=>t.range),printArea:ws.pageSetup && ws.pageSetup.printArea || "",orientation:ws.pageSetup && ws.pageSetup.orientation || "portrait"};
      }
    }
    const saved=Object.prototype.hasOwnProperty.call(savedSheetSettings,name)?savedSheetSettings[name]:null;
    if(saved && saved.view && typeof saved.view==="object"){
      const native=worksheetViews[name] || {};
      const preserved={tables:native.tables || [],freezeRows:native.freezeRows || 0,freezeCols:native.freezeCols || 0,
        hiddenRows:native.hiddenRows || [],hiddenCols:native.hiddenCols || []};
      Object.assign(worksheetViews[name] || (worksheetViews[name]={}),cloneSpreadsheetValue(saved.view),preserved);
      delete savedSheetSettings[name];
    }
    if(saved && saved.filters && typeof saved.filters==="object")
      colFiltersBySheet[name]=Object.fromEntries(Object.entries(saved.filters).filter(([,v])=>Array.isArray(v)).map(([c,v])=>[c,new Set(v)]));
    if(saved && saved.filters && saved.view && Array.isArray(saved.view.hiddenRows))
      worksheetViews[name].hiddenRows=cloneSpreadsheetValue(saved.view.hiddenRows);
    if (sheetsWithFormula.size) recalcAll();   // 로드 직후 결과를 한 번 새로 계산(시트 간 참조 포함)
    return exModels[name];
  };
  const markEdit = (name, r, c, val) => {
    anyDirty = true;
    if (!structChanged.has(name)) editedCells[name].set(r + "," + c, val);   // 타깃 저장용 기록
  };

  // ----- 수식 재계산 -----
  const astCache = new Map();
  /* 시트별 표(테이블) 목록. getAst 가 표 참조([@열] 같은 것)를 펼칠 때마다 필요하다.
     예전에는 부를 때마다 새로 만들었고, 그것도 astCache 를 보기 '전에' 만들어서 캐시가 맞는
     경우에도 이 비용은 매번 냈다. recalcAll 은 수식 셀 하나마다 getAst 를 부르므로 수식이
     1만 개면 이 객체를 1만 번 만든다(시트 수만큼의 배열·객체 할당 × 1만).
     recalcAll 은 도는 동안 await 가 없어 worksheetViews 가 바뀔 수 없다. 그래서 재계산 한 번에
     한 번만 만들어 쓰고 끝나면 버린다. 그 밖에서는 예전처럼 그때그때 만들므로, 표가 바뀔 때
     무효화를 어디선가 빠뜨려 낡은 표로 계산하는 일이 생기지 않는다(무효화 지점이 없다). */
  const sheetTablesSnapshot = () => Object.fromEntries(Object.entries(worksheetViews).map(([name,v])=>[name,v.tables || []]));
  let recalcTables = null;
  const getAst = (f,home=currentSheet,row=0,col=null) => {
    const tables=recalcTables || sheetTablesSnapshot();
    f=spreadsheetTools.expandReferences(f,home,row,tables,[],col);
    if (astCache.has(f)) return astCache.get(f);
    let ast = null; try { ast = parseFormula(f); } catch(_){ ast = null; }
    astCache.set(f, ast);
    return ast;
  };
  // 워크북 전체 수식 재계산(시트 간 참조 지원 · 메모이즈 · 순환참조 감지).
  // 각 수식 셀의 v 를 결과로 갱신하고, { 시트이름: [{r,c}] } 를 반환.
  const findModelSheet = (nm) => {
    if (exModels[nm]) return nm;
    const lower = String(nm).toLowerCase();
    return Object.keys(exModels).find(k => k.toLowerCase() === lower)
      || (wb.SheetNames || []).find(k => k.toLowerCase() === lower) || nm;
  };
  const lookupFormulaName = (name,home=currentSheet,row=0,col=0) => {
    const names=wb.Workbook?.Names || [],key=String(name).toUpperCase();
    const definition=names.find(n=>String(n.Name).toUpperCase()===key && n.Sheet!=null && wb.SheetNames[n.Sheet]===home)
      || names.find(n=>String(n.Name).toUpperCase()===key && n.Sheet==null);
    return definition?getAst(String(definition.Ref).replace(/^=/,""),home,row,col):null;
  };
  const formulaSupported = (ast,home=currentSheet,row=0,col=0) => spreadsheetFormulaFunctions.formulaIsSupported(ast,name=>lookupFormulaName(name,home,row,col));
  const recalcAll = () => {
    if (!sheetsWithFormula.size) return {};
    const cache = new Map(), computing = new Set();
    const resolve = (c, r, sheetName, home) => {
      const nm = findModelSheet(sheetName || home);
      const model = exModels[nm];
      if (!model) return (wb.SheetNames || []).some(s => s.toLowerCase() === String(nm).toLowerCase()) ? "" : FORMULA_ERR("#REF!");
      if (r < 0 || c < 0 || r >= model.length || !model[r] || c >= model[r].length) return "";
      const key = nm + "\u0001" + r + "," + c;
      if (cache.has(key)) return cache.get(key);
      const s = model[r][c];
      if (!s.f){ let v = s.v; if (v instanceof Date) v = spreadsheetDateSerial(v); else if (v == null) v = ""; cache.set(key, v); return v; }
      if (computing.has(key)){ const e = FORMULA_ERR("#CYCLE!"); cache.set(key, e); return e; }
      computing.add(key);
      const ast = getAst(s.f,nm,r,c);
      s.unsupportedFormula = !formulaSupported(ast,nm,r,c);
      if (s.unsupportedFormula){
        const raw = s.xv && typeof s.xv === "object" ? s.xv.result : undefined;
        const cached = raw && raw.error ? FORMULA_ERR(raw.error) : raw;
        computing.delete(key);
        const preserved = cached == null ? FORMULA_ERR("#NAME?") : cached;
        cache.set(key, preserved);
        return preserved;
      }
      let res = FORMULA_ERR("#NAME?");
      if (ast){
        const resolver = (cc,rr,sh) => resolve(cc,rr,sh,nm);
        resolver.resolveName = key => lookupFormulaName(key,nm,r,c);
        resolver.bounds = sh => spreadsheetWorkspaceBounds(exModels[findModelSheet(sh || nm)] || []);
        resolver.isSubtotal = (cc,rr,sh) => {
          const f = exModels[findModelSheet(sh || nm)]?.[rr]?.[cc]?.f;
          return f && /^SUBTOTAL\s*\(/i.test(f);
        };
        resolver.excludeRow = (rr,sh,manual) => {
          const home=findModelSheet(sh || nm), cellRow=exModels[home]?.[rr];
          if(!cellRow) return false;
          const view=worksheetViews[home] || {};
          if(manual && (view.hiddenRows || []).includes(rr)) return true;
          if(rr===0) return false;
          if(home===currentSheet && editState.filter.trim() && !cellRow.some(cell=>dispCell(cell).toLowerCase().includes(editState.filter.trim().toLowerCase())))return true;
          const filters=colFiltersBySheet[home] || {};
          return Object.keys(filters).some(c=>!filters[c].has(dispCell(cellRow[Number(c)] || {})));
        };
        try { res=evaluateAst(ast,resolver); } catch(_){ res=FORMULA_ERR("#ERROR!"); }
      }
      if (Array.isArray(res)) res = res.length ? res[0] : "";
      computing.delete(key);
      cache.set(key, res);
      return res;
    };
    const updatedBySheet = {};
    // 이 한 번의 재계산 동안 표 목록을 고정한다. 중간에 await 가 없어 바뀔 수 없고,
    // 도중에 오류가 나도 반드시 놓아 준다(놓지 않으면 다음 계산이 낡은 표를 쓴다).
    recalcTables = sheetTablesSnapshot();
    try {
      Object.keys(exModels).forEach(nm => {
        if (!sheetsWithFormula.has(nm)) return;
        const model = exModels[nm]; const upd = [];
        for (let r = 0; r < model.length; r++){
          if (!model[r]) continue;
          for (let c = 0; c < model[r].length; c++){
            const s = model[r][c]; if (!s.f) continue;
            const res = resolve(c, r, nm, nm);
            s.v = isFormulaError(res) ? res.__err : (typeof res === "boolean" ? (res ? "TRUE" : "FALSE") : res);
            upd.push({ r, c });
          }
        }
        updatedBySheet[nm] = upd;
      });
    } finally { recalcTables = null; }
    return updatedBySheet;
  };
  const maybeRecalc = () => { syncTableHeaders();recalcAll(); };
  // 시트 간 참조 해석을 위해 모든 시트 모델을 미리 만든다(다중 시트 워크북 첫 편집 시 1회).
  let allSheetsBuilt = false;
  const ensureAllModelsBuilt = async () => {
    if (csvFastAoa || allSheetsBuilt) return;
    for (const nm of (wb.SheetNames || [])){ if (!exModels[nm]) await exModelFor(nm); }
    allSheetsBuilt = true;
  };
  // 행/열 삽입·삭제·정렬 시 모든 수식 셀의 참조를 transform 으로 이동시킨다(수식이 있는 시트에서만).
  const remapWorkbookStructure = (name, change) => {
    Object.keys(exModels).forEach(home => {
      let changed = false;
      const mapped = exModels[home].map(row => row.map(cell => {
        let next=cell;
        if(cell.f){
          const f=spreadsheetTools.remapStructure(cell.f,home,name,change);
          if(f!==cell.f)next={...next,f};
        }
        if(cell.validation?.formulae){
          const formulae=cell.validation.formulae.map(value=>typeof value==="string"?spreadsheetTools.remapStructure(value,home,name,change):value);
          if(formulae.some((value,i)=>value!==cell.validation.formulae[i]))next={...next,validation:{...cell.validation,formulae}};
        }
        if(next!==cell)changed=true;
        return next;
      }));
      if (changed){
        exModels[home].splice(0, exModels[home].length, ...mapped);
        structChanged.add(home);
      }
    });
    Object.entries(condRulesBySheet).forEach(([home,rules])=>rules.forEach(rule=>{
      if(rule.native?.formulae)rule.native={...rule.native,formulae:rule.native.formulae.map(value=>typeof value==="string"?spreadsheetTools.remapStructure(value,home,name,change):value)};
    }));
    (condRulesBySheet[name] || []).forEach(rule => {
      const old = rangeA1(rule.range);
      const next = spreadsheetTools.remapStructure(old,name,name,change);
      const rg = decodeSpreadsheetMerge(next);
      if (rg) rule.range = rg; else rule.removed = true;
    });
    condRulesBySheet[name] = (condRulesBySheet[name] || []).filter(rule => !rule.removed);
    (wb.Workbook?.Names || []).forEach(n=>{n.Ref=spreadsheetTools.remapStructure(n.Ref,n.Sheet==null?name:wb.SheetNames[n.Sheet],name,change);});
    Object.values(worksheetViews).forEach(owner=>{
      if(owner.chart?.sheet===name)owner.chart.range=spreadsheetTools.remapStructure(owner.chart.range,name,name,change);
      if(owner.pivot?.source===name){
        const spec=owner.pivot,old=decodeSpreadsheetMerge(spec.range);
        const ref=spreadsheetTools.remapStructure(spec.range,name,name,change),next=decodeSpreadsheetMerge(ref);
        spec.range=ref;
        if(change.axis==="c" && old && next){
          const map=c=>{const at=old.s.c+c;if(change.deleted)return change.deleted.includes(at)?-1:at-change.deleted.filter(x=>x<at).length-next.s.c;return at+(at>=change.at?(change.count || 1):0)-next.s.c;};
          spec.groups=spec.groups.map(map);spec.values=spec.values.map(map);if(spec.column>=0)spec.column=map(spec.column);
          if([...spec.groups,...spec.values].some(i=>i<0))spec.range="#REF!";
        }
      }
    });
    const view=worksheetViews[name];
    if(view){
      const mapIndex = i => {
        if(change.deleted)return change.deleted.includes(i)?null:i-change.deleted.filter(d=>d<i).length;
        return i>=change.at?i+(change.count || 1):i;
      };
      const key=change.axis==="r"?"hiddenRows":"hiddenCols";
      view[key]=(view[key] || []).map(mapIndex).filter(i=>i!=null);
      const frozen=change.axis==="r"?"freezeRows":"freezeCols";
      if(view[frozen])view[frozen]=change.deleted?view[frozen]-change.deleted.filter(i=>i<view[frozen]).length
        :view[frozen]+(change.at<view[frozen]?(change.count || 1):0);
      if(view.printArea){
        const ref=spreadsheetTools.remapStructure(view.printArea,name,name,change);
        view.printArea=ref.includes("#REF!")?"":ref;
      }
      for(const table of view.tables || []){
        const old=table.range,ref=spreadsheetTools.remapStructure(rangeA1(old),name,name,change),next=decodeSpreadsheetMerge(ref);
        if(!next){table.deleted=true;continue;}
        if(change.axis==="c"){
          if(change.deleted){table.columns=table.columns.filter((_,i)=>!change.deleted.includes(old.s.c+i));if(table.nativeColumns)table.nativeColumns=table.nativeColumns.filter((_,i)=>!change.deleted.includes(old.s.c+i));}
          else if(change.at>old.s.c && change.at<=old.e.c){table.columns.splice(change.at-old.s.c,0,"추가열"+(change.at+1));if(table.nativeColumns)table.nativeColumns.splice(change.at-old.s.c,0,{});}
        }
        table.range=next;
      }
      view.tables=(view.tables || []).filter(t=>!t.deleted);
      view.changed=true;
    }
  };
  const remapModelFormulas = (name, transform) => {
    if (!sheetsWithFormula.has(name)) return;
    const model = exModels[name]; if (!model) return;
    const copiedRows = new Set();
    for (let r = 0; r < model.length; r++){
      if (!model[r]) continue;
      for (let c = 0; c < model[r].length; c++){
        const s = model[r][c];
        if (!s || !s.f) continue;
        const nf = remapFormulaRefs(s.f, transform);
        if (nf === s.f) continue;
        if (csvFastAoa){
          if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
          model[r][c] = { ...model[r][c], f:nf };
        } else {
          s.f = nf;
        }
      }
    }
  };
  const recalcAndRefresh = (options={}) => {
    syncTableHeaders();
    if (!sheetsWithFormula.size){
      if(chartModal && !chartModal.hidden)chartModal._draw();
      return false;
    }
    const refreshDom = !(options && options.refreshDom === false);
    sheetsWithFormula.forEach(nm => { if (exModels[nm]) structChanged.add(nm); });   // 결과가 바뀔 수 있어 전체 재작성
    anyDirty = true;
    const updated = recalcAll();
    if (refreshDom){
      const model = exModels[currentSheet];
      (updated[currentSheet] || []).forEach(({ r, c }) => {
        const td = modelCellTd(r, c);
        if (td && model && model[r] && model[r][c]){ const s = model[r][c]; td.textContent = dispCell(s); td.classList.toggle("num", typeof s.v === "number"); }
      });
      refreshCondFormat();
    }
    if(chartModal && !chartModal.hidden)chartModal._draw();
    return true;
  };

  // ----- 셀 서식(채우기·테두리) 편집 헬퍼 -----
  const argbToCss = (argb) => {
    if (!argb || typeof argb !== "string") return null;
    const h = argb.length === 8 ? argb.slice(2) : (argb.length === 6 ? argb : null);   // ExcelJS 는 AARRGGBB
    return h && /^[0-9a-fA-F]{6}$/.test(h) ? ("#" + h) : null;
  };
  const cssToArgb = (hex) => "FF" + String(hex).replace(/^#/, "").toUpperCase();
  // 모델 셀의 style(fill/border/font/alignment) → <td> 인라인 스타일로 반영(편집·보기 공통 렌더)
  const applyCellStyleToTd = (td, s) => {
    const st = (s && s.style) || {};
    const fill = (st.fill && st.fill.pattern === "solid" && st.fill.fgColor) ? argbToCss(st.fill.fgColor.argb) : null;
    // 테두리 렌더: 격자(border-collapse)와의 충돌을 피하려고 격자 위에 덧그린다.
    //  · 실선(얇게/중간/굵게) → box-shadow(--cell-border)
    //  · 점선/점선 → 배경 그라디언트 레이어 + 해당 변의 격자선을 hidden 으로 억제(격자가 점선을 덮지 않게)
    //  · 이중선 → border(3px 라 충돌에서 이김)
    const b = st.border || {};
    const shadow = [], bgLayers = [], bgPos = [], bgSize = [];
    const SIDE = {
      top:    { prop:"borderTop",    styleProp:"borderTopStyle",    dir:"to right",  pos:"left top",    size:"100% 1px", shadow:(w, c) => "inset 0 " + w + "px 0 0 " + c },
      bottom: { prop:"borderBottom", styleProp:"borderBottomStyle", dir:"to right",  pos:"left bottom", size:"100% 1px", shadow:(w, c) => "inset 0 -" + w + "px 0 0 " + c },
      left:   { prop:"borderLeft",   styleProp:"borderLeftStyle",   dir:"to bottom", pos:"left top",    size:"1px 100%", shadow:(w, c) => "inset " + w + "px 0 0 0 " + c },
      right:  { prop:"borderRight",  styleProp:"borderRightStyle",  dir:"to bottom", pos:"right top",   size:"1px 100%", shadow:(w, c) => "inset -" + w + "px 0 0 0 " + c }
    };
    ["top", "bottom", "left", "right"].forEach(name => {
      const cfg = SIDE[name], side = b[name];
      td.style[cfg.prop] = ""; td.style[cfg.styleProp] = "";   // 매 렌더마다 초기화(격자 기본값으로)
      if (!side || !side.style) return;
      const style = String(side.style);
      const color = (side.color && argbToCss(side.color.argb)) || "#475569";
      if (style === "double"){ td.style[cfg.prop] = "3px double " + color; return; }
      if (style === "dashed" || style === "mediumDashed" || style === "dotted"){
        const on = style === "dotted" ? 1 : 3, off = style === "dotted" ? 2 : 3;
        td.style[cfg.styleProp] = "hidden";                    // 격자선 억제 → 점선이 가려지지 않음
        bgLayers.push("repeating-linear-gradient(" + cfg.dir + "," + color + " 0," + color + " " + on + "px,transparent " + on + "px,transparent " + (on + off) + "px)");
        bgPos.push(cfg.pos); bgSize.push(cfg.size);
        return;
      }
      const w = style === "thick" ? 3 : (style === "medium" ? 2 : 1);
      shadow.push(cfg.shadow(w, color));
    });
    td.style.setProperty("--cell-border", shadow.length ? shadow.join(", ") : "0 0 transparent");
    // 채우기 색 + 점선 테두리 배경 레이어 합성
    td.style.backgroundColor = fill || "";
    if (bgLayers.length){
      td.style.backgroundImage = bgLayers.join(", ");
      td.style.backgroundPosition = bgPos.join(", ");
      td.style.backgroundSize = bgSize.join(", ");
      td.style.backgroundRepeat = "no-repeat";
    } else {
      td.style.backgroundImage = ""; td.style.backgroundPosition = ""; td.style.backgroundSize = ""; td.style.backgroundRepeat = "";
    }
    // 글꼴: 굵게·기울임·밑줄·글자색·크기·글꼴
    const f = st.font || {};
    td.style.fontWeight = f.bold ? "700" : "";
    td.style.fontStyle = f.italic ? "italic" : "";
    td.style.textDecoration = f.underline ? "underline" : "";
    td.style.color = (f.color && argbToCss(f.color.argb)) || "";
    td.style.fontSize = (typeof f.size === "number" && f.size > 0) ? (f.size + "pt") : "";
    td.style.fontFamily = (f.name && typeof f.name === "string") ? f.name : "";
    // 정렬: 가로·세로·자동 줄바꿈
    const a = st.alignment || {};
    const h = a.horizontal;
    td.style.textAlign = (h === "left" || h === "center" || h === "right" || h === "justify") ? h : "";
    td.style.verticalAlign = (a.vertical === "top" || a.vertical === "middle" || a.vertical === "bottom") ? a.vertical : "";
    td.style.whiteSpace = a.wrapText ? "normal" : "";
    td.classList.toggle("xlsx-wrap", !!a.wrapText);
    td.classList.toggle("xlsx-has-dv", !!(s && s.dv && s.dv.values && s.dv.values.length));   // 목록 유효성 → ▼ 표시
  };
  const markStyle = (name, r, c) => {
    anyDirty = true;
    if (!structChanged.has(name)) (styledCells[name] || (styledCells[name] = new Map())).set(r + "," + c, true);
  };
  // 현재 선택의 첫 셀 style(토글 버튼이 현재 상태를 읽어 켜기/끄기를 판단)
  const firstSelectedStyle = () => {
    const td = sheet.querySelector('td.sheet-selected[data-mrow]');
    if (!td) return null;
    const model = exModels[currentSheet];
    const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
    return (model && model[r] && model[r][c]) ? (model[r][c].style || {}) : null;
  };
  // 선택된(td.sheet-selected) 셀에 서식 변경을 적용하고 즉시 인라인 반영(선택 유지).
  // mutate(s, ctx) — ctx: { r,c, r1,r2,c1,c2 } 선택 범위 경계(바깥쪽 테두리 등에 사용)
  const applyFormatToSelection = (mutate) => {
    const model = exModels[currentSheet]; if (!model) return 0;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length){ toast("먼저 셀을 선택하세요.", 1800); return 0; }
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      if (r < r1) r1 = r; if (r > r2) r2 = r; if (c < c1) c1 = c; if (c > c2) c2 = c;
    });
    pushUndo(currentSheet);
    let n = 0;
    const copiedRows = new Set();
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      let s = model[r] && model[r][c]; if (!s) return;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        s = { ...s, style:cloneSpreadsheetValue(s.style || {}) };
        model[r][c] = s;
      }
      s.style = s.style || {};
      mutate(s, { r, c, r1, r2, c1, c2 });
      applyCellStyleToTd(td, s);
      td.textContent = dispCell(s);                    // 표시형식 변경도 즉시 반영
      td.classList.toggle("num", typeof s.v === "number");
      markStyle(currentSheet, r, c);
      n++;
    });
    return n;
  };
  const setSelectionFill = (hex) => {
    const n = applyFormatToSelection(s => {
      s.style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cssToArgb(hex) } };
    });
    if (n) toast(n + "개 셀에 채우기 적용(선택 해제 시 보임)", 1800);
  };
  // 테두리: where = all(전체) · outline(바깥쪽) · inside(내부) · inside-h(안쪽 가로) · inside-v(안쪽 세로) · top/bottom/left/right · none(지움)
  const setSelectionBorder = (hex, styleName, where) => {
    const n = applyFormatToSelection((s, ctx) => {
      const side = () => ({ style: styleName || "thin", color: { argb: cssToArgb(hex) } });
      const b = { ...(s.style.border || {}) };
      const insideH = where === "inside" || where === "inside-h";   // 안쪽 가로선(위/아래로 이웃이 더 있을 때)
      const insideV = where === "inside" || where === "inside-v";   // 안쪽 세로선(좌/우로 이웃이 더 있을 때)
      if (where === "none"){ delete b.top; delete b.bottom; delete b.left; delete b.right; }
      else if (where === "all"){ b.top = side(); b.bottom = side(); b.left = side(); b.right = side(); }
      else if (where === "outline"){
        if (ctx.r === ctx.r1) b.top = side();
        if (ctx.r === ctx.r2) b.bottom = side();
        if (ctx.c === ctx.c1) b.left = side();
        if (ctx.c === ctx.c2) b.right = side();
      }
      else if (insideH || insideV){
        // 각 내부선을 한쪽(아래·오른쪽)에서만 그림 → 양쪽 중복으로 2배 굵어 보이던 문제 해결
        if (insideH && ctx.r < ctx.r2) b.bottom = side();
        if (insideV && ctx.c < ctx.c2) b.right = side();
      }
      else if (where === "top") b.top = side();
      else if (where === "bottom") b.bottom = side();
      else if (where === "left") b.left = side();
      else if (where === "right") b.right = side();
      s.style.border = b;
    });
    if (n) toast(n + "개 셀에 테두리 적용", 1500);
  };
  const clearSelectionFormat = () => {
    const n = applyFormatToSelection(s => {
      delete s.style.fill; delete s.style.border; delete s.style.font; delete s.style.alignment;
      delete s.style.numFmt; s.nf = null;
    });
    if (n) toast(n + "개 셀의 서식 제거", 1600);
  };
  // 글꼴 — 굵게·기울임·밑줄(토글), 글자색, 크기, 글꼴
  const toggleFontProp = (prop, label) => {
    const st0 = firstSelectedStyle();
    const on = !(st0 && st0.font && st0.font[prop]);
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}) };
      if (on) s.style.font[prop] = true; else delete s.style.font[prop];
    });
    if (n) toast(n + "개 셀 " + label + (on ? " 적용" : " 해제"), 1300);
  };
  const setFontColor = (hex) => {
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}), color: { argb: cssToArgb(hex) } };
    });
    if (n) toast(n + "개 셀 글자색 적용", 1300);
  };
  const setFontSize = (pt) => {
    const size = Number(pt);
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}) };
      if (size > 0) s.style.font.size = size; else delete s.style.font.size;
    });
    if (n) toast(n + "개 셀 글자 크기 변경", 1300);
  };
  const setFontName = (name) => {
    const n = applyFormatToSelection(s => {
      s.style.font = { ...(s.style.font || {}) };
      if (name) s.style.font.name = name; else delete s.style.font.name;
    });
    if (n) toast(n + "개 셀 글꼴 변경", 1300);
  };
  // 정렬 — 가로·세로·자동 줄바꿈
  const setAlign = (horizontal) => {
    const n = applyFormatToSelection(s => {
      s.style.alignment = { ...(s.style.alignment || {}) };
      if (horizontal) s.style.alignment.horizontal = horizontal; else delete s.style.alignment.horizontal;
    });
    if (n) toast(n + "개 셀 정렬", 1100);
  };
  const setVAlign = (vertical) => {
    const n = applyFormatToSelection(s => {
      s.style.alignment = { ...(s.style.alignment || {}) };
      if (vertical) s.style.alignment.vertical = vertical; else delete s.style.alignment.vertical;
    });
    if (n) toast(n + "개 셀 세로 정렬", 1100);
  };
  const toggleWrap = () => {
    const st0 = firstSelectedStyle();
    const on = !(st0 && st0.alignment && st0.alignment.wrapText);
    const n = applyFormatToSelection(s => {
      s.style.alignment = { ...(s.style.alignment || {}) };
      if (on) s.style.alignment.wrapText = true; else delete s.style.alignment.wrapText;
    });
    if (n) toast(n + "개 셀 자동 줄바꿈 " + (on ? "켜기" : "끄기"), 1100);
  };
  // 표시형식(번호서식) — code가 빈값이면 '일반'(서식 제거)
  const setNumberFormat = (code) => {
    const n = applyFormatToSelection(s => {
      if (code){ s.style.numFmt = code; s.nf = code; }
      else { delete s.style.numFmt; s.nf = null; }
    });
    if (n) toast(n + "개 셀 표시형식 적용", 1300);
  };

  // ----- 서식 복사 붓(선택 범위 서식을 셀별로 복제 → 다른 선택에 상대 위치대로 타일링 붙이기) -----
  let copiedFormat = null;   // { rows, cols, grid: style[][] } — 바깥쪽 테두리처럼 셀마다 다른 서식도 그대로 옮긴다
  const copyCellFormat = () => {
    const model = exModels[currentSheet];
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!model || !marked.length){ toast("서식을 복사할 셀을 먼저 선택하세요.", 1900); return; }
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      if (r < r1) r1 = r; if (r > r2) r2 = r; if (c < c1) c1 = c; if (c > c2) c2 = c;
    });
    const grid = [];
    for (let r = r1; r <= r2; r++){
      const row = [];
      for (let c = c1; c <= c2; c++){
        const s = model[r] && model[r][c];
        row.push(cloneSpreadsheetValue((s && s.style) || {}));
      }
      grid.push(row);
    }
    copiedFormat = { rows: r2 - r1 + 1, cols: c2 - c1 + 1, grid };
    toast(copiedFormat.rows + "×" + copiedFormat.cols + " 서식을 복사했어요. 대상 선택 후 '서식 붙이기'.", 2400);
  };
  const pasteCellFormat = () => {
    if (!copiedFormat){ toast("먼저 '서식 복사'를 누르세요.", 1900); return; }
    const n = applyFormatToSelection((s, ctx) => {
      const src = copiedFormat.grid[(ctx.r - ctx.r1) % copiedFormat.rows][(ctx.c - ctx.c1) % copiedFormat.cols];
      s.style = cloneSpreadsheetValue(src);
      s.nf = src.numFmt || null;
    });
    if (n) toast(n + "개 셀에 서식을 붙였어요.", 1500);
  };

  // ----- 찾기·바꿈(현재 시트 · 선택이 있으면 선택 범위만, 대/소문자 무시) -----
  const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replaceAllInSheet = (findStr, replStr) => {
    if (!findStr){ toast("찾을 내용을 입력하세요.", 1600); return; }
    const model = exModels[currentSheet]; if (!model) return;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    const scope = marked.length ? new Set(marked.map(td => td.dataset.mrow + "," + td.dataset.mcol)) : null;
    const re = () => new RegExp(escapeRegExp(findStr), "gi");
    const changes = [];
    for (let r = 0; r < model.length; r++){
      for (let c = 0; c < model[r].length; c++){
        if (scope && !scope.has(r + "," + c)) continue;
        const s = model[r][c];
        if (s.f) continue;                              // 수식 셀은 결과값을 바꾸지 않는다
        if (s.v === "" || s.v == null) continue;
        const orig = (s.v instanceof Date) ? dispCell(s) : String(s.v);
        const replaced = orig.replace(re(), replStr);
        if (replaced !== orig) changes.push({ r, c, val: coerce(replaced) });
      }
    }
    if (!changes.length){ toast("바꿀 내용을 찾지 못했어요.", 1700); return; }
    pushUndo(currentSheet);
    const copiedRows = new Set();
    changes.forEach(({ r, c, val }) => {
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        model[r][c] = { ...model[r][c], v:val, xv: val === "" ? null : val, style:cloneSpreadsheetValue(model[r][c].style || {}) };
      } else {
        const s = model[r][c]; s.v = val; s.xv = val === "" ? null : val;
        if (!structChanged.has(currentSheet)) markEdit(currentSheet, r, c, val);
      }
    });
    anyDirty = true;
    const recalculated = recalcAndRefresh({ refreshDom:false });   // 새 표를 그리기 전에 한 번만 재계산
    renderEditable(currentSheet, { skipRecalc:recalculated });
    toast(changes.length + "곳을 바꿨어요" + (scope ? "(선택 범위)" : "") + ".", 1900);
  };

  // ----- 조건부 강조(선택 범위에서 조건에 맞는 셀만 채우기 색 적용 — 저장 시 고정 서식으로 남음) -----
  const highlightByCondition = (op, rawVal, hex) => {
    const model = exModels[currentSheet]; if (!model) return;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length){ toast("강조할 범위를 먼저 선택하세요.", 2000); return; }
    const num = parseFloat(String(rawVal).replace(/[,\s₩$€£¥%]/g, ""));
    const toNum = (v) => (typeof v === "number") ? v : parseFloat(String(v).replace(/[,\s₩$€£¥%]/g, ""));
    const test = (v) => {
      if (op === "contains") return String(v).toLowerCase().includes(String(rawVal).toLowerCase());
      const n = toNum(v);
      if (!isFinite(n) || !isFinite(num)) return false;
      switch (op){
        case "ge": return n >= num; case "gt": return n > num;
        case "le": return n <= num; case "lt": return n < num;
        case "eq": return n === num; case "ne": return n !== num;
      }
      return false;
    };
    const hits = marked.filter(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      const s = model[r] && model[r][c];
      return s && s.v !== "" && s.v != null && test(s.v);
    });
    if (!hits.length){ toast("조건에 맞는 셀이 없어요.", 1700); return; }
    pushUndo(currentSheet);
    const copiedRows = new Set();
    hits.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      let s = model[r][c];
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        s = { ...s, style:cloneSpreadsheetValue(s.style || {}) }; model[r][c] = s;
      }
      s.style = s.style || {};
      s.style.fill = { type:"pattern", pattern:"solid", fgColor:{ argb: cssToArgb(hex) } };
      applyCellStyleToTd(td, s);
      markStyle(currentSheet, r, c);
    });
    anyDirty = true;
    toast(hits.length + "개 셀을 강조했어요.", 1600);
  };

  // ----- 데이터 유효성(목록 드롭다운): 선택 범위 셀에 목록을 걸고, 저장 시 엑셀 네이티브 드롭다운으로 남긴다 -----
  const parseDvValues = (raw) => String(raw || "").split(",").map(s => s.trim()).filter(s => s !== "");
  const setDataValidation = (values) => {
    const model = exModels[currentSheet]; if (!model) return;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length){ toast("드롭다운을 걸 범위를 먼저 선택하세요.", 2200); return; }
    if (!values.length){ toast("목록 값을 쉼표로 구분해 입력하세요(예: 완료,진행,보류).", 3000); return; }
    if (values.some(v => v.includes('"'))){ toast('목록 값에 따옴표(")는 쓸 수 없어요.', 2600); return; }
    if (values.join(",").length > 255){ toast("목록이 너무 길어요(합계 255자 이하).", 2600); return; }
    pushUndo(currentSheet);
    const copiedRows = new Set();
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      if (!model[r] || !model[r][c]) return;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        model[r][c] = { ...model[r][c], dv:{ type:"list", values: values.slice() } };
      } else {
        model[r][c].dv = { type:"list", values: values.slice() };
      }
      td.classList.add("xlsx-has-dv");
    });
    structChanged.add(currentSheet);     // dv 를 파일에 쓰려면 전체 재작성 경로 사용
    anyDirty = true;
    toast(marked.length + "개 셀에 드롭다운을 걸었어요.", 1800);
  };
  const removeDataValidation = () => {
    const model = exModels[currentSheet]; if (!model) return;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length){ toast("유효성을 제거할 범위를 선택하세요.", 2200); return; }
    const targets = marked.filter(td => { const s = model[Number(td.dataset.mrow)] && model[Number(td.dataset.mrow)][Number(td.dataset.mcol)]; return s && (s.dv || s.validation); });
    if (!targets.length){ toast("선택 안에 드롭다운이 없어요.", 1800); return; }
    pushUndo(currentSheet);   // 변경 전 상태를 먼저 스냅샷(되돌리기 정확성)
    const copiedRows = new Set();
    targets.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        const clone = { ...model[r][c] }; delete clone.dv; model[r][c] = clone;
      } else { model[r][c]={...model[r][c]}; delete model[r][c].dv; }
      model[r][c].validation = null;
      td.classList.remove("xlsx-has-dv");
    });
    const n = targets.length;
    structChanged.add(currentSheet); anyDirty = true;
    toast(n + "개 셀의 드롭다운을 제거했어요.", 1600);
  };
  // 유효성 목록 셀을 편집할 때 뜨는 값 선택 팝업(Enter·F2·더블클릭에서 호출)
  let cellDropdown = null, cellDropdownOutside = null;
  const validationList = (rule,name=currentSheet) => {
    if(!rule || rule.type!=="list")return null;
    let ref=String((rule.formulae || [])[0] || "").replace(/^=/,"");
    const inline=/^"([\s\S]*)"$/.exec(ref);if(inline)return inline[1].split(",");
    const named=(wb.Workbook && wb.Workbook.Names || []).find(n=>String(n.Name).toLowerCase()===ref.toLowerCase());
    if(named)ref=named.Ref;
    let ast;try{ast=parseFormula(ref);}catch(_){return null;}
    if(ast.t!=="range" && ast.t!=="ref")return null;
    const model=exModels[findModelSheet(ast.sheet || name)];if(!model)return null;
    const values=[],r1=ast.r1??ast.r,r2=ast.r2??ast.r,c1=ast.c1??ast.c,c2=ast.c2??ast.c;
    for(let r=Math.min(r1,r2);r<=Math.max(r1,r2) && r<model.length;r++)
      for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++){
        if(values.length>=10000)return values;
        const v=model[r]?.[c]?.v;if(v!=="" && v!=null)values.push(v);
      }
    return values;
  };
  const validateInput = (cell,value,name=currentSheet) => {
    const rule=spreadsheetTools.validationFor(cell || {});
    return spreadsheetTools.validationError(value,rule,validationList(rule,name));
  };
  const setNativeValidation = rule => {
    const model=exModels[currentSheet],b=selectionBounds();if(!model || !b){toast("범위를 먼저 선택하세요.",1800);return;}
    pushUndo(currentSheet);
    for(let r=b.s.r;r<=b.e.r;r++){
      model[r]=model[r].slice();
      for(let c=b.s.c;c<=b.e.c;c++)model[r][c]={...model[r][c],dv:null,validation:cloneSpreadsheetValue(rule)};
    }
    structChanged.add(currentSheet);anyDirty=true;renderEditable(currentSheet);
  };
  const closeCellDropdown = () => {
    if (!cellDropdown) return;
    cellDropdown.remove(); cellDropdown = null;
    if (cellDropdownOutside){ document.removeEventListener("pointerdown", cellDropdownOutside, true); cellDropdownOutside = null; }
  };
  const openCellDropdown = (td, name, r, c, values) => {
    closeCellDropdown();
    const model = exModels[name]; if (!model || !model[r] || !model[r][c]) return;
    const cur = rawText(model[r][c]);
    const opts = ["", ...values];
    const menu = document.createElement("div"); menu.className = "xlsx-cell-dropdown"; menu.tabIndex = -1;
    opts.forEach(val => {
      const btn = document.createElement("button"); btn.type = "button";
      btn.textContent = val === "" ? "(비우기)" : val;
      if (val === cur) btn.classList.add("active");
      btn.onclick = () => {
        closeCellDropdown();
        applyCellInput(name, r, c, val);
        const cell = model[r][c];
        td.textContent = dispCell(cell);
        td.classList.toggle("num", typeof cell.v === "number");
        updateFormulaBar();
        moveEditSelection(td, 1, 0);
      };
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = td.getBoundingClientRect();
    menu.style.minWidth = rect.width + "px";
    menu.style.left = Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, rect.left)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - menu.offsetHeight - 6, rect.bottom + 2)) + "px";
    cellDropdown = menu;
    cellDropdownOutside = (e) => { if (!menu.contains(e.target)) closeCellDropdown(); };
    document.addEventListener("pointerdown", cellDropdownOutside, true);
    const items = [...menu.querySelectorAll("button")];
    let idx = Math.max(0, opts.indexOf(cur));
    const highlight = () => items.forEach((b, i) => b.classList.toggle("focus", i === idx));
    highlight(); menu.focus();
    menu.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown"){ e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); highlight(); items[idx].scrollIntoView({ block:"nearest" }); }
      else if (e.key === "ArrowUp"){ e.preventDefault(); idx = Math.max(0, idx - 1); highlight(); items[idx].scrollIntoView({ block:"nearest" }); }
      else if (e.key === "Enter"){ e.preventDefault(); items[idx].click(); }
      else if (e.key === "Escape"){ e.preventDefault(); closeCellDropdown(); try { sheet.focus({ preventScroll:true }); } catch(_){ sheet.focus(); } }
    });
  };

  // ===== 조건부 서식(라이브 규칙): 값이 바뀌면 다시 평가되는 규칙. 화면 오버레이 + 저장 시 엑셀 네이티브 CF =====
  const condRulesBySheet = {};   // 시트이름 -> [규칙]
  let condRuleSeq = 1;
  const condNum = (v) => (typeof v === "number") ? v : parseFloat(String(v == null ? "" : v).replace(/[,\s₩$€£¥%]/g, ""));
  const condRangeHas = (rg, r, c) => r >= rg.s.r && r <= rg.e.r && c >= rg.s.c && c <= rg.e.c;
  const condMatch = (op, cellVal, a, b) => {
    if (op === "contains") return String(cellVal).toLowerCase().includes(String(a).toLowerCase());
    if (op === "notcontains") return !String(cellVal).toLowerCase().includes(String(a).toLowerCase());
    const n = condNum(cellVal), x = condNum(a);
    if (op === "between"){ const y = condNum(b); return isFinite(n) && isFinite(x) && isFinite(y) && n >= Math.min(x, y) && n <= Math.max(x, y); }
    if (!isFinite(n) || !isFinite(x)) return false;
    switch (op){ case "ge": return n >= x; case "gt": return n > x; case "le": return n <= x; case "lt": return n < x; case "eq": return n === x; case "ne": return n !== x; }
    return false;
  };
  const hexToRgb = (h) => { const s = String(h).replace(/^#/, ""); return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)]; };
  const mixRgb = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  // databar·colorscale 규칙의 범위 내 숫자 최소·최대(막대 길이·색 보간 기준) — 렌더 1회당 미리 계산
  const condRangeStats = (model, rg) => {
    let min = Infinity, max = -Infinity;
    for (let r = rg.s.r; r <= rg.e.r && r < model.length; r++)
      for (let c = rg.s.c; c <= rg.e.c && model[r] && c < model[r].length; c++){
        const n = condNum(model[r][c] ? model[r][c].v : "");
        if (isFinite(n)){ if (n < min) min = n; if (n > max) max = n; }
      }
    return (min === Infinity) ? null : { min, max };
  };
  const prepCondRules = (model) => (condRulesBySheet[currentSheet] || []).map(rule => ({
    rule, stats: (rule.kind === "databar" || rule.kind === "colorscale") ? condRangeStats(model, rule.range) : null
  }));
  // 한 셀에 규칙들을 겹쳐 반영: 강조/색조는 배경색, 데이터 막대는 배경 그라디언트로.
  const applyCondOverlayToTd = (td, r, c, s, prepared) => {
    if (!prepared || !prepared.length) return;
    const val = s ? s.v : "";
    for (const { rule, stats } of prepared){
      if (!condRangeHas(rule.range, r, c)) continue;
      if (rule.kind === "highlight"){
        if (condMatch(rule.op, val, rule.value, rule.value2)){
          if (rule.fill) td.style.backgroundColor = rule.fill;
          if (rule.fontColor) td.style.color = rule.fontColor;
        }
      } else if (rule.kind === "colorscale"){
        const n = condNum(val);
        if (stats && isFinite(n)){
          const t = (stats.max === stats.min) ? 0.5 : (n - stats.min) / (stats.max - stats.min);
          const rgb = mixRgb(hexToRgb(rule.minColor), hexToRgb(rule.maxColor), Math.max(0, Math.min(1, t)));
          td.style.backgroundColor = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        }
      } else if (rule.kind === "databar"){
        const n = condNum(val);
        if (stats && isFinite(n)){
          const lo = Math.min(0, stats.min), hi = Math.max(0, stats.max);
          const pct = (hi === lo) ? 0 : Math.max(0, Math.min(100, ((n - lo) / (hi - lo)) * 100));
          td.style.backgroundImage = "linear-gradient(to right," + rule.barColor + " 0," + rule.barColor + " " + pct.toFixed(1) + "%,transparent " + pct.toFixed(1) + "%)";
          td.style.backgroundRepeat = "no-repeat";
        }
      }
    }
  };
  // 화면에 이미 그려진 셀들에 base 서식 + 조건부 서식을 다시 입힌다(값 편집 후 라이브 갱신).
  const refreshCondFormat = () => {
    const list = condRulesBySheet[currentSheet];
    if (!list || !list.length) return;   // 규칙 없으면 오버헤드 0
    const model = exModels[currentSheet]; if (!model) return;
    const prepared = prepCondRules(model);
    sheet.querySelectorAll('td[data-mrow]').forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      const s = model[r] && model[r][c]; if (!s) return;
      applyCellStyleToTd(td, s);
      if (prepared.length) applyCondOverlayToTd(td, r, c, s, prepared);
    });
  };
  const addCondRule = (rule) => {
    const b = selectionBounds();
    if (!b){ toast("규칙을 적용할 범위를 먼저 선택하세요.", 2200); return; }
    pushUndo(currentSheet);
    const full = { id: condRuleSeq++, range: { s:{ ...b.s }, e:{ ...b.e } }, ...rule };
    (condRulesBySheet[currentSheet] || (condRulesBySheet[currentSheet] = [])).push(full);
    anyDirty = true;
    renderEditable(currentSheet);
    toast("조건부 서식 규칙을 추가했어요(값이 바뀌면 자동 반영).", 2200);
  };
  const removeCondRule = (id) => {
    const list = condRulesBySheet[currentSheet]; if (!list) return;
    const i = list.findIndex(x => x.id === id);
    if (i >= 0){ pushUndo(currentSheet); list.splice(i, 1); anyDirty = true; renderEditable(currentSheet); }
  };
  const clearCondRules = () => {
    if (!(condRulesBySheet[currentSheet] || []).length){ toast("이 시트에 조건부 서식 규칙이 없어요.", 1800); return; }
    pushUndo(currentSheet);
    condRulesBySheet[currentSheet] = []; anyDirty = true; renderEditable(currentSheet);
    toast("이 시트의 조건부 서식 규칙을 모두 지웠어요.", 1800);
  };
  const rangeA1 = (rg) => encodeSpreadsheetCell(rg.s.r, rg.s.c) + ":" + encodeSpreadsheetCell(rg.e.r, rg.e.c);
  // 규칙 관리 모달: 현재 시트 규칙 목록 + 개별 삭제
  let condModal = null;
  let condModalKeydown = null;
  const closeCondModal = () => {
    if (condModal){ condModal.remove(); condModal = null; }
    if (condModalKeydown){
      document.removeEventListener("keydown", condModalKeydown, true);
      condModalKeydown = null;
    }
  };
  const CONDOP_LABEL = { ge:"≥", gt:">", le:"≤", lt:"<", eq:"=", ne:"≠", between:"사이", contains:"포함", notcontains:"미포함" };
  const openCondManager = () => {
    closeCondModal();
    const list = condRulesBySheet[currentSheet] || [];
    const modal = document.createElement("div"); modal.className = "xlsx-cond-modal";
    const rowsHtml = list.length ? list.map(rule => {
      let desc;
      if (rule.kind === "highlight") desc = (CONDOP_LABEL[rule.op] || rule.op) + " " + escapeChartText(String(rule.value == null ? "" : rule.value)) + (rule.op === "between" ? (" ~ " + escapeChartText(String(rule.value2 == null ? "" : rule.value2))) : "") + " → 채우기";
      else if (rule.kind === "databar") desc = "데이터 막대";
      else desc = rule.kind === "unsupported" ? "원본 규칙 보존 · 화면 표시 미지원" : "색조(2색)";
      const swatch = rule.kind === "highlight" ? rule.fill : (rule.kind === "databar" ? rule.barColor : rule.maxColor);
      return '<div class="xlsx-cond-item"><span class="sw" style="background:' + (swatch || "#ccc") + '"></span>' +
        '<span class="rg">' + escapeChartText(rangeA1(rule.range)) + '</span>' +
        '<span class="de">' + desc + '</span>' +
        '<button data-del="' + rule.id + '">삭제</button></div>';
    }).join("") : '<div class="xlsx-cond-empty">아직 규칙이 없어요.</div>';
    modal.innerHTML =
      '<div class="xlsx-cond-head"><strong>조건부 서식 규칙 · ' + escapeChartText(currentSheet) + '</strong><button data-a="close">✕</button></div>' +
      '<div class="xlsx-cond-list">' + rowsHtml + '</div>' +
      '<div class="xlsx-cond-foot"><button data-a="clear">전체 삭제</button><button data-a="close2">닫기</button></div>';
    document.body.appendChild(modal); condModal = modal;
    condModalKeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCondModal();
    };
    document.addEventListener("keydown", condModalKeydown, true);
    modal.querySelector('[data-a="close"]').onclick = closeCondModal;
    modal.querySelector('[data-a="close2"]').onclick = closeCondModal;
    modal.querySelector('[data-a="clear"]').onclick = () => { clearCondRules(); closeCondModal(); };
    modal.querySelectorAll("[data-del]").forEach(btn => btn.onclick = () => { removeCondRule(Number(btn.dataset.del)); openCondManager(); });
  };
  // 저장용: 시트의 라이브 규칙을 ExcelJS 네이티브 조건부 서식으로 기록
  const CONDOP_EXCEL = { ge:"greaterThanOrEqual", gt:"greaterThan", le:"lessThanOrEqual", lt:"lessThan", eq:"equal", ne:"notEqual" };
  const writeCondFormattingToWs = (ws, name) => {
    const list = condRulesBySheet[name] || [];
    if (Object.prototype.hasOwnProperty.call(condRulesBySheet,name)) ws.conditionalFormattings = [];
    list.forEach(rule => {
      const ref = rangeA1(rule.range);
      if (rule.native){ ws.addConditionalFormatting({ref,rules:[cloneSpreadsheetValue(rule.native)]}); return; }
      try {
        if (rule.kind === "highlight"){
          const argb = cssToArgb(rule.fill || "#fde68a");
          const style = { fill:{ type:"pattern", pattern:"solid", bgColor:{ argb }, fgColor:{ argb } } };
          if (rule.fontColor) style.font = { color:{ argb: cssToArgb(rule.fontColor) } };
          if (rule.op === "contains" || rule.op === "notcontains"){
            ws.addConditionalFormatting({ ref, rules:[{ type:"containsText", operator: rule.op === "contains" ? "containsText" : "notContainsText", text:String(rule.value == null ? "" : rule.value), style }] });
          } else if (rule.op === "between"){
            ws.addConditionalFormatting({ ref, rules:[{ type:"cellIs", operator:"between", formulae:[condNum(rule.value), condNum(rule.value2)], style }] });
          } else {
            ws.addConditionalFormatting({ ref, rules:[{ type:"cellIs", operator: CONDOP_EXCEL[rule.op] || "greaterThan", formulae:[condNum(rule.value)], style }] });
          }
        } else if (rule.kind === "databar"){
          ws.addConditionalFormatting({ ref, rules:[{ type:"dataBar", cfvo:[{ type:"min" }, { type:"max" }], color:{ argb: cssToArgb(rule.barColor || "#63C384") } }] });
        } else if (rule.kind === "colorscale"){
          ws.addConditionalFormatting({ ref, rules:[{ type:"colorScale", cfvo:[{ type:"min" }, { type:"max" }], color:[{ argb: cssToArgb(rule.minColor || "#FFFFFF") }, { argb: cssToArgb(rule.maxColor || "#4472C4") }] }] });
        }
      } catch(e){ console.warn("조건부 서식 저장 실패:", ref, e); }
    });
  };

  // ----- 차트: 선택 범위에서 (라벨, 값) 추출 → SVG 미리보기 모달 -----
  const extractChartData = (spec=null) => {
    const model = exModels[spec?.sheet || currentSheet]; if (!model) return null;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length && !spec) return null;
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    marked.forEach(td => { const r = +td.dataset.mrow, c = +td.dataset.mcol; r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c); });
    if(spec){
      const b=decodeSpreadsheetMerge(spec.range);if(!b)return null;
      r1=b.s.r;r2=Math.min(b.e.r,model.length-1);c1=b.s.c;c2=b.e.c;
    }
    const cellVal = (r, c) => (model[r] && model[r][c]) ? model[r][c].v : "";
    const asNum = (v) => (typeof v === "number") ? v : parseFloat(String(v == null ? "" : v).replace(/[,\s₩$€£¥%]/g, ""));
    const labels = [], values = [];
    const twoCol = (c2 - c1) >= 1;
    for (let r = r1; r <= r2; r++){
      const val = asNum(cellVal(r, twoCol ? c1 + 1 : c1));
      if (!isFinite(val)) continue;                     // 값이 숫자인 행만(머리글 행 자동 제외)
      labels.push(twoCol ? String(cellVal(r, c1)) : String(r + 1));
      values.push(val);
    }
    return values.length ? { labels, values } : null;
  };
  // 차트: 드래그로 이동·모서리로 크기 조절 가능한 떠 있는 패널(배경을 가리지 않아 표가 보임)
  let chartModal = null;
  const openChartModal = (data,spec=null) => {
    if (!chartModal){
      chartModal = document.createElement("div"); chartModal.className = "xlsx-chart-modal"; chartModal.hidden = true;
      chartModal.innerHTML =
        '<div class="xlsx-chart-head">' +
        '<strong>차트</strong>' +
        '<span class="xlsx-chart-types"><button data-t="bar">막대</button><button data-t="line">선</button><button data-t="pie">원</button></span>' +
        '<span class="xlsx-chart-actions"><button data-a="memo">📝 메모에 넣기</button><button data-a="png">PNG 저장</button><button data-a="close">닫기</button></span>' +
        '</div><div class="xlsx-chart-canvas" draggable="true" title="이미지를 메모로 드래그하거나 \'메모에 넣기\'를 누르세요"></div>';
      document.body.appendChild(chartModal);
      const head = chartModal.querySelector(".xlsx-chart-head");
      const canvas = chartModal.querySelector(".xlsx-chart-canvas");
      const chartFileName = () => sanitizeFilePart(base || "chart") + "_chart.png";
      // 현재 차트를 2배 해상도 PNG로 렌더 → 드래그용 dataURL + 버튼용 Blob 을 준비(그릴 때마다 갱신)
      chartModal._preparePng = () => {
        chartModal._pngBlob = null; chartModal._pngUrl = "";
        const svg = canvas.querySelector("svg"); if (!svg) return;
        const vb = svg.viewBox && svg.viewBox.baseVal, W = (vb && vb.width) || 640, H = (vb && vb.height) || 380;
        const xml = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas"); cv.width = Math.round(W * 2); cv.height = Math.round(H * 2);
          const ctx = cv.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          try { chartModal._pngUrl = cv.toDataURL("image/png"); } catch(_){}
          cv.toBlob((blob) => { chartModal._pngBlob = blob; }, "image/png");
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
      };
      const pngBlobNow = async () => {
        if (chartModal._pngBlob) return chartModal._pngBlob;
        if (chartModal._pngUrl){ try { return await (await fetch(chartModal._pngUrl)).blob(); } catch(_){} }
        return null;
      };
      chartModal._draw = () => {
        if(chartModal._spec)chartModal._data=extractChartData(chartModal._spec) || {labels:[],values:[]};
        const tp = chartModal._type || "bar";
        chartModal.querySelectorAll(".xlsx-chart-types button").forEach(b => b.classList.toggle("active", b.dataset.t === tp));
        const w = Math.max(320, Math.round(canvas.clientWidth)), h = Math.max(200, Math.round(canvas.clientHeight));
        canvas.innerHTML = buildSpreadsheetChartSvg(tp, chartModal._data.labels, chartModal._data.values, { width: w, height: h });
        chartModal._preparePng();
      };
      chartModal._png = async () => {
        const blob = await pngBlobNow();
        if (blob) downloadSpreadsheetFile(blob, chartFileName(), "image/png");
        else toast("차트 이미지를 만들지 못했어요.", 2000);
      };
      chartModal._toMemo = async () => {
        if (typeof window.addImagesToScratchpad !== "function"){ toast("메모 기능을 사용할 수 없어요.", 2200); return; }
        const blob = await pngBlobNow();
        if (!blob){ toast("차트 이미지를 만들지 못했어요.", 2000); return; }
        try {
          await window.addImagesToScratchpad([new File([blob], chartFileName(), { type: "image/png" })], { name: (base || "차트") + " 차트" });
          toast("차트를 메모에 넣었어요.", 1600);
        } catch(e){ console.error(e); toast("메모에 넣지 못했어요.", 2000); }
      };
      // 캔버스를 메모로 직접 드래그(미리 만든 PNG dataURL, 없으면 SVG로 폴백)
      canvas.addEventListener("dragstart", (e) => {
        const svg = canvas.querySelector("svg");
        let url = chartModal._pngUrl;
        if (!url && svg) url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
        if (!url || !e.dataTransfer) return;
        try {
          e.dataTransfer.setData("text/uri-list", url);
          e.dataTransfer.setData("text/plain", url);
          e.dataTransfer.setData("text/html", '<img src="' + url + '" alt="chart">');
          e.dataTransfer.effectAllowed = "copy";
          if (svg) e.dataTransfer.setDragImage(svg, 20, 20);
        } catch(_){}
      });
      chartModal.addEventListener("click", (e) => {
        const d = e.target.dataset || {};
        if (d.a === "close"){ chartModal.hidden = true; return; }
        if (d.t){
          if(chartModal._spec){pushUndo(currentSheet);chartModal._spec.type=d.t;anyDirty=true;}
          chartModal._type=d.t;chartModal._draw();
        }
        if (d.a === "png") chartModal._png();
        if (d.a === "memo") chartModal._toMemo();
      });
      // 헤더 드래그로 이동
      let drag = null;
      head.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        const rect = chartModal.getBoundingClientRect();
        drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        chartModal.style.left = rect.left + "px"; chartModal.style.top = rect.top + "px";
        chartModal.style.right = "auto"; chartModal.style.bottom = "auto"; chartModal.style.transform = "none";
        try { head.setPointerCapture(e.pointerId); } catch(_){}
        e.preventDefault();
      });
      head.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const nx = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
        const ny = Math.max(0, Math.min(window.innerHeight - 36, e.clientY - drag.dy));
        chartModal.style.left = nx + "px"; chartModal.style.top = ny + "px";
      });
      const endDrag = (e) => { if (drag){ try { head.releasePointerCapture(e.pointerId); } catch(_){} drag = null; } };
      head.addEventListener("pointerup", endDrag);
      head.addEventListener("pointercancel", endDrag);
      // 크기 조절(모서리 드래그) → 다시 그림
      let rafId = 0;
      if (typeof ResizeObserver === "function"){
        new ResizeObserver(() => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; if (!chartModal.hidden) chartModal._draw(); }); }).observe(canvas);
      }
      window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chartModal.hidden) chartModal.hidden = true; });
    }
    chartModal._spec=spec;
    if(spec)chartModal._type=spec.type || "bar";
    chartModal._data = data; chartModal._type = "bar";
    chartModal.hidden = false;
    requestAnimationFrame(() => chartModal._draw());
  };
  const insertChart = () => {
    const data = extractChartData();
    if (!data){ toast("차트로 만들 숫자 범위를 선택하세요(라벨 열 + 값 열).", 2600); return; }
    const b=selectionBounds();
    pushUndo(currentSheet);
    const spec={sheet:currentSheet,range:rangeA1(b),type:"bar"};
    viewFor(currentSheet).chart=spec;anyDirty=true;
    openChartModal(data,spec);
  };

  // ----- 선택 범위 → 이미지: 모델(값·서식) + 화면 셀 크기로 canvas 에 그려 PNG 생성 -----
  const SELIMG_MAX_PX = 4000;
  const captureSelectionCanvas = () => {
    const model = exModels[currentSheet]; if (!model) return null;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    let r1 = Infinity, r2 = -Infinity, c1 = Infinity, c2 = -Infinity;
    const colW = {}, rowH = {};
    marked.forEach(td => {
      const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
      r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c);
      const rect = td.getBoundingClientRect();
      if (colW[c] == null) colW[c] = Math.max(24, rect.width);
      if (rowH[r] == null) rowH[r] = Math.max(16, rect.height);
    });
    for (let c = c1; c <= c2; c++) if (!colW[c]) colW[c] = 80;
    for (let r = r1; r <= r2; r++) if (!rowH[r]) rowH[r] = 24;
    const xAt = {}, yAt = {}; let totalW = 0, totalH = 0;
    for (let c = c1; c <= c2; c++){ xAt[c] = totalW; totalW += colW[c]; }
    for (let r = r1; r <= r2; r++){ yAt[r] = totalH; totalH += rowH[r]; }
    totalW = Math.round(totalW); totalH = Math.round(totalH);
    if (totalW < 1 || totalH < 1) return null;
    let scale = 2;
    if (totalW * scale > SELIMG_MAX_PX || totalH * scale > SELIMG_MAX_PX) scale = Math.max(1, Math.min(SELIMG_MAX_PX / totalW, SELIMG_MAX_PX / totalH));
    const cv = document.createElement("canvas");
    cv.width = Math.round(totalW * scale); cv.height = Math.round(totalH * scale);
    const ctx = cv.getContext("2d"); ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, totalW, totalH);
    ctx.textBaseline = "middle";
    const stroke = (x1, y1, x2, y2, color, w, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    };
    const sideSpec = (side) => {
      const style = String(side.style), color = (side.color && argbToCss(side.color.argb)) || "#475569";
      const w = style === "thick" ? 3 : (style === "medium" || style === "double") ? 2 : 1;
      const dash = (style === "dashed" || style === "mediumDashed") ? [4, 3] : (style === "dotted") ? [1, 3] : [];
      return { color, w, dash };
    };
    // 1) 채우기 + 텍스트
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++){
      const s = model[r] && model[r][c]; if (!s) continue;
      const stl = s.style || {}, x = xAt[c], y = yAt[r], w = colW[c], h = rowH[r];
      const fill = (stl.fill && stl.fill.pattern === "solid" && stl.fill.fgColor) ? argbToCss(stl.fill.fgColor.argb) : null;
      if (fill){ ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      const text = dispCell(s);
      if (text !== "" && text != null){
        const f = stl.font || {}, a = stl.alignment || {};
        const px = (typeof f.size === "number" && f.size > 0) ? Math.round(f.size * 96 / 72) : 13;
        ctx.font = (f.italic ? "italic " : "") + (f.bold ? "700 " : "400 ") + px + "px " + (f.name ? ("'" + f.name + "',") : "") + "'Malgun Gothic',sans-serif";
        ctx.fillStyle = (f.color && argbToCss(f.color.argb)) || "#1e293b";
        const isNum = typeof s.v === "number";
        const align = (a.horizontal === "center" || a.horizontal === "right" || a.horizontal === "left") ? a.horizontal : (isNum ? "right" : "left");
        ctx.textAlign = align;
        const tx = align === "center" ? x + w / 2 : (align === "right" ? x + w - 5 : x + 5);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.fillText(String(text), tx, y + h / 2 + 0.5);
        ctx.restore();
      }
    }
    // 2) 기본 격자(연한 회색)
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++){
      const x = xAt[c], y = yAt[r], w = colW[c], h = rowH[r];
      stroke(x + 0.5, y + 0.5, x + w - 0.5, y + 0.5, "#d7dee8", 1);
      stroke(x + 0.5, y + h - 0.5, x + w - 0.5, y + h - 0.5, "#d7dee8", 1);
      stroke(x + 0.5, y + 0.5, x + 0.5, y + h - 0.5, "#d7dee8", 1);
      stroke(x + w - 0.5, y + 0.5, x + w - 0.5, y + h - 0.5, "#d7dee8", 1);
    }
    // 3) 사용자 지정 테두리(격자 위에 덧그림)
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++){
      const s = model[r] && model[r][c]; if (!s || !s.style || !s.style.border) continue;
      const b = s.style.border, x = xAt[c], y = yAt[r], w = colW[c], h = rowH[r];
      const one = (side, x1, y1, x2, y2) => { if (side && side.style){ const sp = sideSpec(side); stroke(x1, y1, x2, y2, sp.color, sp.w, sp.dash); } };
      one(b.top, x, y + 0.5, x + w, y + 0.5);
      one(b.bottom, x, y + h - 0.5, x + w, y + h - 0.5);
      one(b.left, x + 0.5, y, x + 0.5, y + h);
      one(b.right, x + w - 0.5, y, x + w - 0.5, y + h);
    }
    return cv;
  };
  const saveSelectionToMemo = () => {
    const cv = captureSelectionCanvas();
    if (!cv){ toast("이미지로 만들 셀 범위를 먼저 선택하세요.", 2400); return; }
    cv.toBlob((blob) => {
      if (!blob){ toast("이미지를 만들지 못했어요.", 2200); return; }
      const name = sanitizeFilePart(base || "표") + "_선택.png";
      if (typeof window.addImagesToScratchpad === "function"){
        Promise.resolve(window.addImagesToScratchpad([new File([blob], name, { type: "image/png" })], { name: (base || "표") + " 선택 영역" }))
          .then(() => toast("선택 영역을 이미지로 메모에 넣었어요.", 1900))
          .catch((e) => { console.error(e); downloadSpreadsheetFile(blob, name, "image/png"); toast("메모에 못 넣어 이미지로 저장했어요.", 2600); });
      } else {
        downloadSpreadsheetFile(blob, name, "image/png");
        toast("선택 영역을 이미지로 저장했어요.", 1900, { type: "success" });
      }
    }, "image/png");
  };

  // ===== 미니 피벗: 선택 범위(머리글 1행 + 데이터)를 그룹 열·값 열·집계로 요약해 새 시트로 만든다 =====
  const PIVOT_AGGS = [
    { id:"sum", label:"합계" }, { id:"count", label:"개수" }, { id:"avg", label:"평균" },
    { id:"max", label:"최대" }, { id:"min", label:"최소" }
  ];
  const pivotToNum = (raw) => (typeof raw === "number") ? raw
    : parseFloat(String(raw == null ? "" : raw).replace(/[,\s₩$€£¥%]/g, ""));
  const extractSelectionGrid = () => {
    const model = exModels[currentSheet];
    const b = selectionBounds();
    if (!model || !b) return null;
    const grid = [];
    for (let r = b.s.r; r <= b.e.r; r++){
      const row = [];
      for (let c = b.s.c; c <= b.e.c; c++){ const s = model[r] && model[r][c]; row.push(s ? s.v : ""); }
      grid.push(row);
    }
    return grid;
  };
  // 요약 결과 → 머리글·합계행 서식을 입힌 새 시트로 등록
  const registerPivotSheet = (baseName, aoa, opts={}) => {
    const name = uniqueSheetName(baseName);
    const lastRow = aoa.length - 1;
    exModels[name] = aoa.map((row, r) => row.map((val) => {
      const cell = blankCell();
      cell.v = val; cell.xv = (val === "" || val == null) ? null : val;
      cell.style = {};
      if (r === 0){
        cell.style.font = { bold:true, color:{ argb:"FFFFFFFF" } };
        cell.style.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF4472C4" } };
      } else if (opts.totalRow && r === lastRow){
        cell.style.font = { bold:true };
        cell.style.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFF2F2F2" } };
      }
      return cell;
    }));
    exMerges[name] = [];
    editedCells[name] = new Map(); styledCells[name] = new Map();
    structChanged.add(name); addedSheets.add(name);
    wb.SheetNames.push(name);
    wb.Sheets[name] = { "!ref":"A1" };
    anyDirty = true; currentSheet = name;
    rerender();
    return name;
  };
  const pivotResult = (headers,rows,spec) => {
    const result=spreadsheetTools.pivotGrid(rows,spec.groups,spec.values,spec.agg,spec.column);
    const labels=spec.groups.map(c=>headers[c]);
    const agg=(PIVOT_AGGS.find(a=>a.id===spec.agg) || {}).label || spec.agg;
    const names=result.columns.flatMap(col=>spec.values.map(c=>(spec.column>=0?String(col.label)+" · ":"")+agg+" "+headers[c]));
    return [[...labels,...names],...result.rows];
  };
  const makePivotSheet = (groups,values,agg,headers,dataRows,column=-1) => {
    const b=selectionBounds(),source=currentSheet;
    const spec={source,range:rangeA1(b),groups,values,agg,column};
    const aoa=pivotResult(headers,dataRows,spec);
    if(aoa.length<2){toast("요약할 데이터가 없습니다.",2000);return;}
    pushUndo(currentSheet);
    const name=registerPivotSheet("피벗",aoa);
    viewFor(name).pivot=spec;
  };
  const refreshPivot = () => {
    const spec=viewFor(currentSheet).pivot;
    if(!spec){toast("이 시트는 연결된 피벗 결과가 아닙니다.",2000);return;}
    const source=exModels[spec.source],b=decodeSpreadsheetMerge(spec.range);
    if(!source || !b){toast("원본 시트·범위를 찾을 수 없습니다.",2400);return;}
    const grid=source.slice(b.s.r,Math.min(source.length,b.e.r+1)).map(row=>row.slice(b.s.c,b.e.c+1).map(cell=>cell.v));
    if(grid.length<2)return;
    const aoa=pivotResult(grid[0],grid.slice(1),spec);
    pushUndo(currentSheet);
    exModels[currentSheet]=aoa.map((row,r)=>row.map(v=>({...blankCell(),v,xv:v,style:r===0?{font:{bold:true}}:{}})));
    structChanged.add(currentSheet);anyDirty=true;renderEditable(currentSheet);
    toast("원본 데이터로 피벗을 새로고침했습니다.",1800);
  };

  let pivotModal = null;
  let pivotModalKeydown = null;
  const closePivotModal = () => {
    if (pivotModal){ pivotModal.remove(); pivotModal = null; }
    if (pivotModalKeydown){
      document.removeEventListener("keydown", pivotModalKeydown, true);
      pivotModalKeydown = null;
    }
  };
  const openPivotModal = () => {
    const grid = extractSelectionGrid();
    if (!grid || grid.length < 2 || !grid[0] || !grid[0].length){
      toast("머리글 1행과 데이터가 함께 들어가도록 2행 이상 선택하세요.", 3000); return;
    }
    const headers = grid[0].map((h, i) => (h == null || String(h).trim() === "") ? (spreadsheetColumnName(i) + "열") : String(h));
    const dataRows = grid.slice(1);
    closePivotModal();
    const modal = document.createElement("div");
    modal.className = "xlsx-pivot-modal";
    const colOptions = headers.map((h, i) => '<option value="' + i + '">' + escapeChartText(h) + '</option>').join("");
    const aggOptions = PIVOT_AGGS.map(a => '<option value="' + a.id + '">' + a.label + '</option>').join("");
    modal.innerHTML =
      '<div class="xlsx-pivot-head"><strong>미니 피벗 · 그룹별 요약</strong><button data-a="close" title="닫기">✕</button></div>' +
      '<div class="xlsx-pivot-controls">' +
        '<label>그룹 기준 (Ctrl로 여러 열)<select multiple size="3" data-k="group">' + colOptions + '</select></label>' +
        '<label>값 (Ctrl로 여러 열)<select multiple size="3" data-k="value">' + colOptions + '</select></label>' +
        '<label>집계<select data-k="agg">' + aggOptions + '</select></label>' +
        '<label>열 구분<select data-k="column"><option value="-1">없음</option>' + colOptions + '</select></label>' +
      '</div>' +
      '<div class="xlsx-pivot-preview"></div>' +
      '<div class="xlsx-pivot-actions"><button data-a="make" class="primary">새 시트로 만들기</button><button data-a="close2">닫기</button></div>';
    document.body.appendChild(modal);
    pivotModal = modal;
    pivotModalKeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closePivotModal();
    };
    document.addEventListener("keydown", pivotModalKeydown, true);
    const groupSel = modal.querySelector('[data-k="group"]');
    const valueSel = modal.querySelector('[data-k="value"]');
    const aggSel = modal.querySelector('[data-k="agg"]');
    const columnSel=modal.querySelector('[data-k="column"]');
    const picked=select=>[...select.selectedOptions].map(o=>Number(o.value));
    // 기본 값 열 = 숫자가 가장 많은 열(머리글 제외). 그룹은 첫 열.
    let bestCol = headers.length > 1 ? 1 : 0, bestScore = -1;
    for (let c = 0; c < headers.length; c++){
      let n = 0; dataRows.forEach(row => { if (isFinite(pivotToNum(row[c]))) n++; });
      if (n > bestScore){ bestScore = n; bestCol = c; }
    }
    groupSel.value = "0";
    valueSel.value = String((bestCol === 0 && headers.length > 1) ? 1 : bestCol);
    const preview = modal.querySelector(".xlsx-pivot-preview");
    const refresh = () => {
      const groups=picked(groupSel),values=picked(valueSel);
      if(!groups.length || !values.length){preview.textContent="그룹과 값 열을 선택하세요.";return;}
      const aoa=pivotResult(headers,dataRows,{groups,values,agg:aggSel.value,column:Number(columnSel.value)});
      preview.innerHTML="<table>"+aoa.slice(0,201).map((row,r)=>"<tr>"+row.map(v=>"<"+(r===0?"th":"td")+">"+escapeChartText(String(v??""))+"</"+(r===0?"th":"td")+">").join("")+"</tr>").join("")+"</table>";
    };
    [groupSel,valueSel,aggSel,columnSel].forEach(el=>el.addEventListener("change",refresh));
    refresh();
    modal.querySelector('[data-a="close"]').onclick = closePivotModal;
    modal.querySelector('[data-a="close2"]').onclick = closePivotModal;
    modal.querySelector('[data-a="make"]').onclick = () => {
      if(!picked(groupSel).length || !picked(valueSel).length)return;
      makePivotSheet(picked(groupSel),picked(valueSel),aggSel.value,headers,dataRows,Number(columnSel.value));
      closePivotModal();
    };
  };

  // ----- 되돌리기 / 다시실행 (시트별, 공용 history.js) -----
  // 다른 편집기와 달리 여기는 편집 "직전"에 기록한다(pushUndo 18곳). 그 자리를 그대로 두려고
  // 두 가지를 쓴다.
  //  - 리비전 번호: 스냅샷 같음 판정을 O(1) 로. 시트 전체를 비교하면 큰 표에서 느리다.
  //  - dropRedo(): 새 편집이 시작된 순간 앞쪽(redo) 갈래를 무효화. 이걸 빼면 되돌린 뒤
  //    새로 편집해도 '다시실행'이 살아 있어, 누르면 방금 한 편집을 조용히 버린다.
  // 아직 기록되지 않은 마지막 편집은 undo() 가 되돌리기 직전에 확정한다.
  const sheetRevs = {};           // name -> 편집 리비전
  let undoBtn = null, redoBtn = null;
  const cloneModel = (model) => {
    if (typeof structuredClone === "function"){ try { return structuredClone(model); } catch(_){} }
    return (model || []).map(row => row.map(s => {
      const out = {
        v: cloneSpreadsheetValue(s.v),
        xv: cloneSpreadsheetValue(s.xv),
        nf: s.nf,
        style: cloneSpreadsheetValue(s.style || {}),
        f: s.f || null
      };
      out.validation = cloneSpreadsheetValue(s.validation || null);
      if (s.dv) out.dv = cloneSpreadsheetValue(s.dv);
      if (s.workspaceBlank) out.workspaceBlank = true;
      return out;
    }));
  };
  const snapshot = (name) => ({
    rev: sheetRevs[name] || 0,
    // CSV 변환본은 수정할 행만 복사하는 copy-on-write 모델이라 최상위 행 배열만 보관해도 안전하다.
    model: csvFastAoa ? (exModels[name] || []).slice() : cloneModel(exModels[name] || []),
    edited: new Map(editedCells[name] || []),
    styled: new Map(styledCells[name] || []),
    merges: (exMerges[name] || []).slice(),
    struct: structChanged.has(name),
    conditions:cloneSpreadsheetValue(condRulesBySheet[name] || []),
    sizes:cloneSpreadsheetValue(sheet.__sheetSizes && sheet.__sheetSizes[name] || null)
  });
  const restoreSnapshot = (name, snap) => {
    sheetRevs[name] = snap.rev || 0;          // 리비전도 함께 되돌려야 "미기록 변경 있음"을 오판하지 않는다
    exModels[name] = csvFastAoa ? (snap.model || []).slice() : cloneModel(snap.model);
    editedCells[name] = new Map(snap.edited);
    styledCells[name] = new Map(snap.styled);
    exMerges[name] = (snap.merges || []).slice();
    condRulesBySheet[name] = cloneSpreadsheetValue(snap.conditions || []);
    if(exModels[name].some(row=>row.some(cell=>cell.f)))sheetsWithFormula.add(name);
    if (snap.sizes){ sheet.__sheetSizes = sheet.__sheetSizes || {}; sheet.__sheetSizes[name] = cloneSpreadsheetValue(snap.sizes); }
    if (snap.struct) structChanged.add(name); else structChanged.delete(name);
  };
  // 통합 문서 히스토리: 다른 시트의 참조 갱신도 같은 단계로 되돌린다.
  let workbookRevision = 0, workbookHistory = null;
  const captureWorkbook = () => ({
    rev:workbookRevision, active:currentSheet,
    models:Object.fromEntries(Object.keys(exModels).map(name => [name,snapshot(name)])),
    names:wb.SheetNames.slice(), sheets:{...wb.Sheets}, definitions:cloneSpreadsheetValue(wb.Workbook?.Names || []),
    original:[...sheetOrigNames], added:[...addedSheets], removed:[...removedOrigSheets],
    layouts:[...sourceLayoutSheets], views:cloneSpreadsheetValue(worksheetViews), filters:cloneSpreadsheetValue(colFiltersBySheet)
  });
  const applyWorkbook = snap => {
    workbookRevision = snap.rev;
    for (const obj of [exModels,exMerges,editedCells,styledCells,condRulesBySheet,sheetRevs,worksheetViews])
      Object.keys(obj).forEach(key => { delete obj[key]; });
    structChanged.clear(); sheetsWithFormula.clear();
    Object.entries(snap.models).forEach(([name,value]) => restoreSnapshot(name,value));
    Object.assign(worksheetViews,cloneSpreadsheetValue(snap.views || {}));
    Object.keys(colFiltersBySheet).forEach(k=>{delete colFiltersBySheet[k];});
    Object.assign(colFiltersBySheet,cloneSpreadsheetValue(snap.filters || {}));
    wb.SheetNames = snap.names.slice(); wb.Sheets = {...snap.sheets};
    wb.Workbook=wb.Workbook || {};wb.Workbook.Names=cloneSpreadsheetValue(snap.definitions || []);
    for (const [map, entries] of [[sheetOrigNames,snap.original],[sourceLayoutSheets,snap.layouts]]){ map.clear(); entries.forEach(([k,v])=>map.set(k,v)); }
    for (const [set, entries] of [[addedSheets,snap.added],[removedOrigSheets,snap.removed]]){ set.clear(); entries.forEach(v=>set.add(v)); }
    currentSheet = snap.active;
    anyDirty = true;
    rerender();
  };
  const historyFor = () => {
    if (!workbookHistory){
      workbookHistory = MNEditHistory.create({
        limit:MNEditHistory.LIMITS.sheet, capture:captureWorkbook, apply:applyWorkbook,
        isEqual:(a,b)=>a.rev===b.rev, onChange:()=>updateUndoButtons()
      });
      workbookHistory.reset();
    }
    return workbookHistory;
  };
  const canUndoSheet = () => !!workbookHistory && (workbookHistory.canUndo() || workbookHistory.current().rev !== workbookRevision);
  const canRedoSheet = () => !!workbookHistory && workbookHistory.canRedo();
  const updateUndoButtons = () => {
    if (undoBtn) undoBtn.disabled = !canUndoSheet();
    if (redoBtn) redoBtn.disabled = !canRedoSheet();
  };
  const pushUndo = name => {
    const h = historyFor(); h.commit(); h.dropRedo();
    workbookRevision++; sheetRevs[name] = (sheetRevs[name] || 0) + 1;
    updateUndoButtons();
  };
  const doUndo = () => { if (canUndoSheet()) historyFor().undo(); else toast("되돌릴 작업이 없어요.",1400); };
  const doRedo = () => { if (canRedoSheet()) historyFor().redo(); else toast("다시 실행할 작업이 없어요.",1400); };
  // 도구모음 버튼을 누르면 포커스가 표 밖으로 이동하므로, XLSX 탭 전체에서 히스토리 단축키를 받는다.
  // 단, 셀·검색창 등 텍스트 입력 중에는 브라우저 기본 undo/redo를 그대로 유지한다.
  const handleSpreadsheetHistoryKeydown = (e) => {
    if (!editMode || !doc || state !== doc || e.defaultPrevented || e.isComposing) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = String(e.key || "").toLowerCase();
    const undo = key === "z" && !e.shiftKey;
    const redo = key === "y" || (key === "z" && e.shiftKey);
    if (!undo && !redo) return;
    const target = e.target;
    if (target && target.closest && target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (document.querySelector(".modal:not([hidden]),.xlsx-function-overlay")) return;
    e.preventDefault();
    e.stopPropagation();
    if (redo) doRedo(); else doUndo();
  };
  document.addEventListener("keydown", handleSpreadsheetHistoryKeydown, true);
  if (doc){
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => document.removeEventListener("keydown", handleSpreadsheetHistoryKeydown, true));
  }
  // Del/Backspace: 선택 셀의 내용 삭제(서식은 유지 — 엑셀과 동일)
  // 서식·수식까지 함께 옮기는 내부 클립보드. 시스템 클립보드에는 표시용 TSV 를 쓰고,
  // 붙여넣을 때 클립보드 텍스트가 우리가 쓴 TSV 그대로면(=중간에 외부 복사 없음) 서식까지 복원한다.
  let richClip = null;
  const hasNonContiguousSelection = () =>
    sheet.dataset.selectionContiguous === "0" && Number(sheet.dataset.selectionCount || 0) > 0;
  const warnContiguousSelection = (action) => {
    if (!hasNonContiguousSelection()) return false;
    toast((action || "이 작업을 하려면") + " 하나의 연속 범위만 선택하세요.", 2200);
    return true;
  };

  const clearSelectionContents = () => {
    const model = exModels[currentSheet]; if (!model) return false;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return false;
    const cellAt = (td) => { const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol); return model[r] && model[r][c] ? { r, c, s:model[r][c] } : null; };
    if (!marked.some(td => { const x = cellAt(td); return x && ((x.s.v !== "" && x.s.v != null) || x.s.f); })) return false;   // 이미 다 비어있으면 무시
    pushUndo(currentSheet);
    const copiedRows = new Set();
    let hadFormula = false, n = 0;
    marked.forEach(td => {
      const x = cellAt(td); if (!x) return;
      const { r, c } = x;
      if (model[r][c].f) hadFormula = true;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        model[r][c] = { ...model[r][c], v:"", xv:null, f:null, style:cloneSpreadsheetValue(model[r][c].style || {}) };
      } else {
        const s = model[r][c]; s.v = ""; s.xv = null; s.f = null;
        if (!structChanged.has(currentSheet)) markEdit(currentSheet, r, c, "");
      }
      td.textContent = ""; td.classList.remove("num");
      n++;
    });
    anyDirty = true;
    if (hadFormula) structChanged.add(currentSheet);   // 수식 삭제는 전체 재작성으로 저장
    recalcAndRefresh(currentSheet);                     // 지운 셀에 의존하던 수식 갱신
    refreshCondFormat();                                // 지운 값 기준으로 조건부 서식 재평가
    toast(n + "개 셀 내용을 지웠어요.", 1200);
    return true;
  };

  // Ctrl+X: 선택 영역을 클립보드로 복사한 뒤 내용 삭제(서식 유지 — 엑셀 잘라내기와 동일한 체감)
  const cutSelection = async () => {
    if (warnContiguousSelection("잘라내려면")) return;
    const clip = captureRichSelection();
    if (!clip){ toast("잘라낼 셀을 먼저 선택하세요.", 1600); return; }
    clip.cut = true;                       // 잘라내기 → 붙일 때 수식 참조를 조정하지 않고 그대로 옮김(엑셀 동작)
    richClip = clip;
    await copySpreadsheetText(clip.tsv);
    clearSelectionContents();
    toast("선택 영역을 잘라냈어요(서식 포함). 붙여넣기(Ctrl+V)로 옮기세요.", 1800);
  };

  // Enter/F2 편집 시작 · Del 내용 삭제 · Ctrl+X 잘라내기 · Ctrl+S 저장
  sheet.addEventListener("keydown", (e) => {
    if (!editMode) return;
    const t = e.target;
    if (t && t.closest && t.closest('[contenteditable="true"]')) return;   // 셀 편집 중엔 네이티브 동작
    if ((e.key === "Enter" || e.key === "F2") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){
      const td = sheet.querySelector('td.sheet-anchor[data-mrow]') || sheet.querySelector('td.sheet-selected[data-mrow]');
      if (td){ e.preventDefault(); e.stopPropagation(); startCellEdit(td, currentSheet); }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey){
      if (sheet.querySelector('td.sheet-selected[data-mrow]')){   // 선택이 있으면 브라우저 뒤로가기 등 기본동작 차단
        e.preventDefault(); e.stopPropagation();
        clearSelectionContents();
      }
      return;
    }
    // 글자·숫자·기호 키 → 엑셀처럼 기존 값을 대체하며 즉시 입력 시작.
    // 한글 IME 는 keydown 이 Process(229) 로 오므로 preventDefault 없이 셀만 편집 가능으로 바꿔
    // 조합이 그 셀에서 시작되게 한다(막으면 첫 글자 조합이 끊긴다).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing){
      if (!(t && t.closest && t.closest("input,textarea,select"))){   // 필터·검색 입력창은 제외
        const ime = e.key === "Process" || e.keyCode === 229;
        const printable = typeof e.key === "string" && e.key.length === 1;
        if (ime || printable){
          const td = sheet.querySelector('td.sheet-anchor[data-mrow]') || sheet.querySelector('td.sheet-selected[data-mrow]');
          if (td){
            if (!ime) e.preventDefault();
            e.stopPropagation();
            startCellEdit(td, currentSheet, { replaceWith: ime ? "" : e.key });
            return;
          }
        }
      }
    }
    // 저장은 설정의 '현재 파일 저장'(기본 Ctrl+S) 재지정을 따른다.
    if (typeof shortcutMatches === "function" && shortcutMatches(e, "saveCurrent")){
      e.preventDefault(); e.stopPropagation(); quickSave(); return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key).toLowerCase();
    if (k === "c" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); copyRichSelection(); }
    else if (k === "x" && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); cutSelection(); }
  });

  // CSV→XLSX 변환 시 사용자가 고른 '첫 줄 머리글' 여부를 기본값으로. (없으면 기존처럼 머리글 고정)
  const initHeaderFrozen = (doc && typeof doc.spreadsheetHasHeader === "boolean") ? doc.spreadsheetHasHeader : true;
  let editState = { filter: "", headerFrozen: initHeaderFrozen, sortCol: -1, sortDir: 1 };
  viewOptions = document.createElement("label");
  viewOptions.className = "xlsx-view-options";
  viewOptions.title = "현재 시트의 보기 설정";
  const viewOptionsLabel = document.createElement("span");
  viewOptionsLabel.className = "xlsx-view-options-label";
  viewOptionsLabel.textContent = "보기 설정";
  const headerFrozenChk = document.createElement("input");
  headerFrozenChk.type = "checkbox";
  headerFrozenChk.checked = editState.headerFrozen;
  headerFrozenChk.addEventListener("change", () => {
    pushUndo(currentSheet);
    editState.headerFrozen = headerFrozenChk.checked;
    const view=viewFor(currentSheet); view.header=editState.headerFrozen; view.changed=true;
    anyDirty=true;
    renderEditable(currentSheet);
  });
  viewOptions.append(viewOptionsLabel, headerFrozenChk, document.createTextNode("첫 행은 머리글"));
  viewOptions.hidden = !editMode;
  exp.insertBefore(viewOptions, editToggle);
  const colFiltersBySheet = {};   // 시트이름 -> { 열index: Set(표시값) } — 열별 자동필터(보기 전용, 파일엔 저장 안 함)
  const viewFor = name => worksheetViews[name] || (worksheetViews[name]={header:initHeaderFrozen,freezeRows:initHeaderFrozen?1:0,freezeCols:0,hiddenRows:[],hiddenCols:[]});
  const applyWorksheetView = name => {
    const view=viewFor(name),table=sheet.querySelector("table");
    if(!table) return;
    const hiddenCols=new Set(view.hiddenCols || []),hiddenRows=new Set(view.hiddenRows || []);
    table.querySelectorAll("td[data-mrow]").forEach(cell=>{
      const r=Number(cell.dataset.mrow),c=Number(cell.dataset.mcol);
      const spec=(view.tables || []).find(t=>r>=t.range.s.r && r<=t.range.e.r && c>=t.range.s.c && c<=t.range.e.c);
      if(spec && !cell.style.backgroundColor){
        cell.style.backgroundColor=r===spec.range.s.r?"#dbeafe":(r-spec.range.s.r)%2?"var(--xlsx-frozen-bg,#fff)":"#eff6ff";
      }
    });
    table.querySelectorAll("td[data-mcol],th.sheet-col-head").forEach(cell=>{
      const c=Number(cell.dataset.mcol ?? cell.dataset.col);
      cell.hidden=hiddenCols.has(c);
    });
    const colgroup=table.querySelector("colgroup");
    if(colgroup) [...colgroup.children].forEach((col,i)=>{ if(i>0 && hiddenCols.has(i-1)) col.style.width="0px"; });
    const rows=[...table.rows].filter(tr=>tr.querySelector("td[data-mrow]"));
    rows.forEach(tr=>{
      const first=tr.querySelector("td[data-mrow]"),r=Number(first.dataset.mrow);
      tr.hidden=hiddenRows.has(r);
      const head=tr.querySelector(".sheet-row-head"); if(head)head.textContent=String(r+1);
      tr.classList.remove("xlsx-edit-header");
      if(view.header && r===0)tr.classList.add("xlsx-data-header");
    });
    const head=table.querySelector(".sheet-col-row");
    let top=head?head.getBoundingClientRect().height:30;
    const lefts=new Map(); let left=table.querySelector(".sheet-row-head")?.getBoundingClientRect().width || 42;
    table.querySelectorAll(".sheet-col-head").forEach(cell=>{
      const c=Number(cell.dataset.col);
      if(c<(view.freezeCols || 0) && !hiddenCols.has(c)){lefts.set(c,left);left+=cell.getBoundingClientRect().width;}
    });
    rows.forEach(tr=>{
      const r=Number(tr.querySelector("td[data-mrow]").dataset.mrow);
      if(tr.hidden)return;
      for(const cell of tr.cells){
        const c=Number(cell.dataset.mcol);
        const frozenRow=r<(view.freezeRows || 0),frozenCol=cell.hasAttribute("data-mcol") && lefts.has(c);
        if(frozenRow || frozenCol){
          cell.style.position="sticky";
          if(frozenRow)cell.style.top=top+"px";
          if(frozenCol)cell.style.left=lefts.get(c)+"px";
          cell.style.zIndex=frozenRow&&frozenCol?"6":frozenRow?"4":"3";
          if(!cell.style.backgroundColor)cell.style.backgroundColor="var(--xlsx-frozen-bg,#fff)";
        }
      }
      if(r<(view.freezeRows || 0))top+=tr.getBoundingClientRect().height;
    });
    table.querySelectorAll(".sheet-col-head").forEach(cell=>{
      const c=Number(cell.dataset.col);if(!lefts.has(c))return;
      cell.style.left=lefts.get(c)+"px";cell.style.zIndex="7";
    });
    const corner=table.querySelector(".sheet-corner");if(corner)corner.style.zIndex="8";
  };
  const syncTableHeaders = () => {
    for(const [name,view] of Object.entries(worksheetViews)){
      const model=exModels[name];if(!model)continue;
      for(const table of view.tables || []){
        if(table.headerRow===false)continue;
        const used=new Set(),replacements=new Map();
        const columns=table.columns.map((old,i)=>{
          const cell=model[table.range.s.r]?.[table.range.s.c+i];
          const base=String(cell?.v ?? "").trim() || "열"+(i+1);
          let value=base,n=2;while(used.has(value.toLowerCase()))value=base+n++;
          used.add(value.toLowerCase());
          if(value!==old)replacements.set(String(old).toLowerCase(),value);
          return value;
        });
        if(!replacements.size)continue;
        table.columns=columns;
        columns.forEach((value,i)=>{
          const row=model[table.range.s.r],c=table.range.s.c+i;
          if(row?.[c]){row[c]={...row[c],v:value,xv:value,f:null};}
        });
        for(const [home,rows] of Object.entries(exModels)){
          rows.forEach((row,r)=>row.forEach((cell,c)=>{
            if(!cell.f)return;
            const local=home===name && r>=table.range.s.r && r<=table.range.e.r && c>=table.range.s.c && c<=table.range.e.c;
            const next=spreadsheetTools.renameTableReferences(cell.f,table.name,replacements,local);
            if(next!==cell.f){row[c]={...cell,f:next};structChanged.add(home);}
          }));
        }
        structChanged.add(name);view.changed=true;
      }
    }
  };

  const createExcelTable = () => {
    const b=selectionBounds(),model=exModels[currentSheet];if(!b || b.e.r<=b.s.r){toast("머리글과 데이터를 함께 선택하세요.",2200);return;}
    if((exMerges[currentSheet] || []).some(ref=>spreadsheetRangesOverlap(decodeSpreadsheetMerge(ref),b))){toast("병합을 해제한 뒤 표를 만드세요.",2200);return;}
    const view=viewFor(currentSheet);view.tables=view.tables || [];
    if(view.tables.some(t=>spreadsheetRangesOverlap(t.range,b))){toast("기존 표와 겹칩니다.",2000);return;}
    const columns=model[b.s.r].slice(b.s.c,b.e.c+1).map((cell,i)=>String(cell.v || "열"+(i+1)));
    if(new Set(columns.map(s=>s.toLowerCase())).size!==columns.length){toast("머리글 이름을 서로 다르게 지정하세요.",2200);return;}
    const used=new Set(Object.values(worksheetViews).flatMap(v=>(v.tables || []).map(t=>t.name.toLowerCase())));
    let n=1;while(used.has("table"+n))n++;
    pushUndo(currentSheet);
    view.tables.push({name:"Table"+n,range:cloneSpreadsheetValue(b),columns,headerRow:true,totalsRow:false});
    columns.forEach((v,i)=>{model[b.s.r][b.s.c+i]={...model[b.s.r][b.s.c+i],v,xv:v,f:null};});
    structChanged.add(currentSheet);anyDirty=true;renderEditable(currentSheet);
    toast("Table"+n+" 표를 만들었습니다. 예: =SUM(Table"+n+"["+columns[columns.length-1]+"])",3200);
  };
  const expandTableForInput = (name,r,c) => {
    const model=exModels[name],view=viewFor(name);
    for(const table of view.tables || []){
      const b=table.range;if(table.totalsRow || r!==b.e.r+1 || c<b.s.c || c>b.e.c)continue;
      const previous=model[b.e.r];b.e.r=r;
      for(let col=b.s.c;col<=b.e.c;col++){
        const from=previous[col],target=model[r][col];
        if(col===c || !spreadsheetModelCellEmpty(target))continue;
        const next={...target,style:cloneSpreadsheetValue(from.style || {}),nf:from.nf};
        if(from.f){next.f=remapFormulaRefs(from.f,(cc,rr,abs)=>({c:cc,r:abs.rowAbs?rr:rr+1}),{includeSheetRefs:true});next.xv=null;}
        model[r][col]=next;
      }
      structChanged.add(name);
    }
  };
  sheet.addEventListener("pointerup",()=>{if(editMode)requestAnimationFrame(()=>applyWorksheetView(currentSheet));});
  const changeWorksheetView = mutate => {
    pushUndo(currentSheet); const view=viewFor(currentSheet);
    mutate(view); view.changed=true; anyDirty=true; renderEditable(currentSheet,{preserveScroll:true});
  };
  const virtualCsvEditor = !!csvFastAoa && csvFastAoa.length *
    Math.max(1, csvFastAoa.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)) > 12000;

  const shouldVirtualize = name => {
    if(virtualCsvEditor)return true;
    const model=exModels[name],view=viewFor(name),layout=sourceLayoutSheets.get(name);
    if(!model || model.length*(model[0]?.length || 0)<=12000)return false;
    if((exMerges[name] || []).length || (floatingImageSheets.get(name) || []).length || (formulaImageSheets.get(name) || []).length)return false;
    if(view.freezeRows || view.freezeCols || view.hiddenRows?.length || view.hiddenCols?.length)return false;
    if(layout && (Object.keys(layout.rows || {}).length || layout.wrapCells?.length))return false;
    return !model.some(row=>row.some(cell=>cell.style?.alignment?.wrapText || (cell.style?.font?.size || 0)>14));
  };
  const matchingModelRows = (model, editable) => {
    const head = editState.headerFrozen ? 1 : 0;
    const term = editable ? editState.filter.trim().toLowerCase() : "";
    const colFilters = editable ? colFiltersBySheet[currentSheet] : null;
    const filterCols = colFilters ? Object.keys(colFilters) : [];
    const result = [];
    for (let r = 0; r < model.length; r++){
      if (editable && r >= head){
        if (term && !model[r].some(s => dispCell(s).toLowerCase().includes(term))) continue;
        let pass = true;
        for (const ck of filterCols){
          const s = model[r][Number(ck)];
          if (!colFilters[ck].has(s ? dispCell(s) : "")){ pass = false; break; }
        }
        if (!pass) continue;
      }
      result.push(r);
    }
    return result;
  };

  // ----- 열별 자동필터(편집 모드): 열 머리글 ▼ → 값 체크박스로 행 걸러내기 -----
  let colFilterMenu = null, colFilterOutside = null, colFilterKeydown = null;
  const closeColFilterMenu = () => {
    if (colFilterMenu){ colFilterMenu.remove(); colFilterMenu = null; }
    if (colFilterOutside){ document.removeEventListener("pointerdown", colFilterOutside, true); colFilterOutside = null; }
    if (colFilterKeydown){ document.removeEventListener("keydown", colFilterKeydown, true); colFilterKeydown = null; }
  };
  const applyColFilter = (c, set) => {
    pushUndo(currentSheet);
    const view=viewFor(currentSheet);view.filterChanged=true;view.changed=true;anyDirty=true;
    const filters = colFiltersBySheet[currentSheet] || (colFiltersBySheet[currentSheet] = {});
    if (set) filters[c] = set; else delete filters[c];
    if (!Object.keys(filters).length) delete colFiltersBySheet[currentSheet];
    renderEditable(currentSheet);
  };
  const openColFilterMenu = (btn, c) => {
    closeColFilterMenu();
    const model = exModels[currentSheet]; if (!model) return;
    const head = editState.headerFrozen ? 1 : 0;
    // 고유값 수집(표시 텍스트 기준, 500개 상한) — 첫 행 머리글은 값 목록에서 제외
    const counts = new Map();
    let truncated = false;
    const dataRows = spreadsheetWorkspaceBounds(model).rows;
    for (let r = head; r < dataRows; r++){
      const s = model[r] && model[r][c];
      const key = s ? dispCell(s) : "";
      if (!counts.has(key) && counts.size >= 500)truncated=true;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const values = [...counts.keys()].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const current = (colFiltersBySheet[currentSheet] || {})[c] || null;
    const state = new Map();
    values.forEach(v => state.set(v, current ? current.has(v) : true));

    const menu = document.createElement("div");
    menu.className = "sheet-colfilter-menu";
    const title = document.createElement("div"); title.className = "sheet-colfilter-title";
    const headCell = head && model[0] && model[0][c] ? dispCell(model[0][c]) : "";
    title.textContent = (headCell ? headCell + " · " : "") + spreadsheetColumnName(c) + "열 필터";
    const search = document.createElement("input");
    search.type = "search"; search.placeholder = "값 검색"; search.className = "sheet-colfilter-search";
    search.addEventListener("keydown", (e) => e.stopPropagation());
    const listEl = document.createElement("div"); listEl.className = "sheet-colfilter-list";
    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      listEl.replaceChildren();
      values.filter(v=>!q || String(v).toLowerCase().includes(q)).slice(0,500).forEach(v => {
        const lab = document.createElement("label");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!state.get(v);
        cb.addEventListener("change", () => state.set(v, cb.checked));
        const valueText = document.createElement("span");
        valueText.className = "sheet-colfilter-value";
        valueText.textContent = (v === "" ? "(빈칸)" : v) + " · " + counts.get(v);
        valueText.title = valueText.textContent;
        lab.append(cb, valueText);
        listEl.appendChild(lab);
      });
    };
    renderList();
    search.addEventListener("input", renderList);
    const mkBtn = (text, onClick, cls) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text;
      if (cls) b.className = cls;
      b.addEventListener("click", onClick); return b;
    };
    const selRow = document.createElement("div"); selRow.className = "sheet-colfilter-selrow";
    selRow.append(
      mkBtn("모두 선택", () => { values.forEach(v => state.set(v, true)); renderList(); }),
      mkBtn("모두 해제", () => { values.forEach(v => state.set(v, false)); renderList(); })
    );
    const footer = document.createElement("div"); footer.className = "sheet-colfilter-footer";
    footer.append(
      mkBtn("적용", () => {
        const selected = values.filter(v => state.get(v));
        if (!selected.length){ toast("최소 한 값은 선택해야 해요.", 1800); return; }
        closeColFilterMenu();
        applyColFilter(c, selected.length === values.length ? null : new Set(selected));
      }, "sheet-colfilter-apply"),
      mkBtn("필터 지우기", () => { closeColFilterMenu(); applyColFilter(c, null); })
    );
    const op=document.createElement("select");op.innerHTML='<option value="ge">이상</option><option value="le">이하</option><option value="between">사이</option><option value="eq">같음</option>';
    const lo=document.createElement("input"),hi=document.createElement("input");lo.placeholder="숫자 또는 YYYY-MM-DD";hi.placeholder="최대 값 (사이 조건)";
    const condition=document.createElement("div");condition.className="sheet-filter-condition";
    condition.append(op,lo,hi,mkBtn("조건으로 선택",()=>{
      const convert=v=>{const n=coerce(v);return n instanceof Date?n.getTime():n;};
      const a=convert(lo.value),b=convert(hi.value);
      if(typeof a!=="number" || (op.value==="between" && (typeof b!=="number" || a>b))){toast("조건 값을 확인하세요.",2000);return;}
      values.forEach(v=>{const n=convert(v);state.set(v,typeof n==="number" && (op.value==="ge"?n>=a:op.value==="le"?n<=a:op.value==="eq"?n===a:n>=a&&n<=b));});
      renderList();
    }));
    menu.append(title, search, condition, selRow, listEl);
    if (truncated){
      const note = document.createElement("div"); note.className = "sheet-colfilter-note";
      note.textContent = "검색 결과 중 500개까지 표시합니다. 나머지 값의 선택 상태는 유지됩니다.";
      menu.appendChild(note);
    }
    menu.appendChild(footer);
    document.body.appendChild(menu);
    const br = btn.getBoundingClientRect(), mr = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - mr.width - 6, br.left)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - mr.height - 6, br.bottom + 4)) + "px";
    colFilterMenu = menu;
    colFilterOutside = (event) => { if (!menu.contains(event.target)) closeColFilterMenu(); };
    colFilterKeydown = (event) => { if (event.key === "Escape") closeColFilterMenu(); };
    setTimeout(() => {
      if (!colFilterMenu) return;
      document.addEventListener("pointerdown", colFilterOutside, true);
      document.addEventListener("keydown", colFilterKeydown, true);
    }, 0);
    search.focus();
  };
  const decorateFilterHeads = () => {
    const filters = colFiltersBySheet[currentSheet] || {};
    sheet.querySelectorAll(".sheet-col-head").forEach(th => {
      if (th.querySelector(".sheet-colfilter-btn")) return;
      const c = Number(th.dataset.col);
      if (!Number.isInteger(c)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      const active = !!filters[c];
      btn.className = "sheet-colfilter-btn" + (active ? " active" : "");
      btn.textContent = "▼";
      btn.title = active ? "열 필터 적용 중 — 눌러서 수정" : "열 필터(값 선택)";
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());   // 열 선택 드래그와 충돌 방지
      btn.addEventListener("click", (e) => { e.stopPropagation(); openColFilterMenu(btn, c); });
      th.appendChild(btn);
    });
  };
  // 병합 정보 → 좌상단 span 맵 + 가려지는 셀 집합. 편집 모드는 격자를 평평하게 유지(선택·편집 정확도)하되
  // 병합 위치를 점선 힌트로 표시하고, 읽기 전용 모드에서는 실제 colspan/rowspan 으로 합쳐 그린다.
  const mergeRenderInfo = () => {
    const list = exMerges[currentSheet] || [];
    const covered = new Set(), spanAt = new Map();
    list.forEach(text => {
      const rg = decodeSpreadsheetMerge(text); if (!rg) return;
      spanAt.set(rg.s.r + "," + rg.s.c, { rs: rg.e.r - rg.s.r + 1, cs: rg.e.c - rg.s.c + 1 });
      for (let r = rg.s.r; r <= rg.e.r; r++)
        for (let c = rg.s.c; c <= rg.e.c; c++)
          if (!(r === rg.s.r && c === rg.s.c)) covered.add(r + "," + c);
    });
    return { covered, spanAt };
  };
  const tableFromModel = (model, editable, options={}) => {
    const cols = model.length ? model[0].length : 1;
    const head = editState.headerFrozen ? 1 : 0;
    const rowIndexes = options.rowIndexes || matchingModelRows(model, editable);
    const { covered, spanAt } = mergeRenderInfo();
    const condPrepared = prepCondRules(model);   // 조건부 서식 규칙 + 범위 통계(렌더 1회 계산)
    const table = document.createElement("table"), body = document.createElement("tbody");
    const spacer = (height, where) => {
      if (!(height > 0)) return;
      const tr = document.createElement("tr"); tr.className = "xlsx-virtual-spacer xlsx-virtual-spacer-" + where;
      const td = document.createElement("td"); td.colSpan = cols + 1; td.style.height = height + "px";
      tr.appendChild(td); body.appendChild(tr);
    };
    spacer(options.topHeight, "top");
    for (const r of rowIndexes){
      const tr = document.createElement("tr");
      if (head && r < head) tr.className = "xlsx-edit-header";
      for (let c = 0; c < cols; c++){
        const key = r + "," + c;
        if (!editable && covered.has(key)) continue;       // 읽기 전용: 가려지는 셀은 생략(좌상단이 span)
        const s = model[r][c];
        const td = document.createElement("td");
        td.dataset.mrow = String(r); td.dataset.mcol = String(c);
        td.textContent = dispCell(s);
        if (typeof s.v === "number") td.classList.add("num");
        applyCellStyleToTd(td, s);                       // 채우기·테두리 서식 반영
        if (condPrepared.length) applyCondOverlayToTd(td, r, c, s, condPrepared);   // 조건부 서식 오버레이
        const sp = spanAt.get(key);
        if (editable){
          if (sp) td.classList.add("xlsx-merged-anchor");
          else if (covered.has(key)) td.classList.add("xlsx-merged-cover");
        } else if (sp){
          if (sp.rs > 1) td.rowSpan = sp.rs;
          if (sp.cs > 1) td.colSpan = sp.cs;
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    spacer(options.bottomHeight, "bottom");
    table.appendChild(body);
    return table;
  };
  const modelNavigationCellEmpty = (model) => (cell) => {
    if (!cell) return true;
    const r = Number(cell.dataset.mrow), c = Number(cell.dataset.mcol);
    return spreadsheetModelCellEmpty(model && model[r] && model[r][c]);
  };

  const clearVirtualEditor = () => {
    if (typeof sheet._xlsxVirtualCleanup === "function") sheet._xlsxVirtualCleanup();
    sheet.classList.remove("xlsx-virtualized");
  };
  // 더블클릭 → 셀 편집. 선택 드래그의 sheet.setPointerCapture 가 click/dblclick 을 sheet 로
  // 재타깃해 table/td 리스너에는 이벤트가 안 닿으므로, sheet 에 한 번만 달고
  // 재타깃된 경우엔 좌표(elementFromPoint)로 실제 셀을 찾는다.
  let editDblClickBound = false;
  const bindEditableTable = () => {
    if (editDblClickBound) return;
    editDblClickBound = true;
    sheet.addEventListener("dblclick", (e) => {
      if (!editMode) return;
      if (e.target && e.target.closest && e.target.closest('[contenteditable="true"]')) return;   // 이미 편집 중인 셀
      let td = e.target && e.target.closest ? e.target.closest("td[data-mcol]") : null;
      if (!td){
        const el = document.elementFromPoint(e.clientX, e.clientY);
        td = el && el.closest ? el.closest("td[data-mcol]") : null;
      }
      if (td && sheet.contains(td)) startCellEdit(td, currentSheet);
    });
  };
  const renderVirtualModel = (name, editable) => {
    const model = editable ? exModels[name] : spreadsheetDataModel(exModels[name]);
    const rowIndexes = matchingModelRows(model, editable);
    const rowHeight = 29, overscan = 14;
    let lastStart = -1, frame = 0, disposed = false;
    sheet.classList.add("xlsx-virtualized");
    const draw = (force=false) => {
      frame = 0;
      if (disposed) return;
      const windowState = spreadsheetVirtualWindow(rowIndexes.length, sheet.scrollTop, sheet.clientHeight, rowHeight, overscan);
      if (!force && windowState.start === lastStart) return;
      lastStart = windowState.start;
      const visible = rowIndexes.slice(windowState.start, windowState.start + windowState.count);
      const topBefore = sheet.scrollTop, leftBefore = sheet.scrollLeft;
      const table = tableFromModel(model, editable, {
        rowIndexes:visible, topHeight:windowState.topHeight, bottomHeight:windowState.bottomHeight
      });
      sheet.replaceChildren(table);
      enhanceSpreadsheetSelection(sheet, name, {
        editable,
        rowLabels:visible,
        onSelectionChange:editable ? onCellSelect : undefined,
        isCellEmpty:modelNavigationCellEmpty(model)
      });
      if (editable){ bindEditableTable(table, name); decorateFilterHeads(); }
      applyWorksheetView(name);
      sheet.scrollTop = topBefore; sheet.scrollLeft = leftBefore;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => draw(false));
    };
    sheet.addEventListener("scroll", onScroll);
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw(true)) : null;
    if (resize) resize.observe(sheet);
    sheet._xlsxVirtualCleanup = () => {
      disposed = true;
      sheet.removeEventListener("scroll", onScroll);
      if (resize) resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      delete sheet._xlsxVirtualCleanup;
    };
    draw(true);
  };

  // ===== 자동 채우기 핸들: 선택 우하단 사각형을 끌어 값 채우기(숫자 수열은 이어서, 그 외는 복사) =====
  const fillHandle = document.createElement("div");
  fillHandle.className = "sheet-fill-handle";
  fillHandle.title = "끌어서 자동 채우기";
  let fillState = null;
  const fillSelBounds = () => {
    if (hasNonContiguousSelection()) return null;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    const rs = marked.map(td => Number(td.dataset.mrow)), cs = marked.map(td => Number(td.dataset.mcol));
    return { r1:Math.min(...rs), r2:Math.max(...rs), c1:Math.min(...cs), c2:Math.max(...cs) };
  };
  const modelCellTd = (r, c) => sheet.querySelector('td[data-mrow="' + r + '"][data-mcol="' + c + '"]');
  function positionFillHandle(){
    if (fillState) return;                        // 드래그 중엔 위치 고정
    if (!editMode){ if (fillHandle.parentNode) fillHandle.remove(); return; }
    const b = fillSelBounds();
    const br = b && modelCellTd(b.r2, b.c2);
    if (!br){ if (fillHandle.parentNode) fillHandle.remove(); return; }
    br.appendChild(fillHandle);
  }
  // 수식 입력줄 갱신: 활성(기준) 셀의 참조와 값/수식을 표시
  const updateFormulaBar = () => {
    if (!editMode){ formulaBar.hidden = true; return; }
    formulaBar.hidden = false;
    const anchor = sheet.querySelector('td.sheet-anchor[data-mrow]') || sheet.querySelector('td.sheet-selected[data-mrow]');
    if (!anchor){ fbCell = null; fbRef.textContent = ""; fbInput.disabled = true; if (document.activeElement !== fbInput) fbInput.value = ""; return; }
    const r = Number(anchor.dataset.mrow), c = Number(anchor.dataset.mcol);
    fbCell = { r, c };
    fbRef.textContent = spreadsheetColumnName(c) + (r + 1);
    fbInput.disabled = false;
    const model = exModels[currentSheet];
    const s = model && model[r] && model[r][c];
    if (document.activeElement !== fbInput) fbInput.value = s ? ((s.f != null && s.f !== "") ? ("=" + s.f) : rawText(s)) : "";
  };
  const fbFxTarget = {
    get: () => ({ text: fbInput.value, caret: fbInput.selectionStart == null ? fbInput.value.length : fbInput.selectionStart }),
    set: (text, caret) => { fbInput.value = text; try { fbInput.setSelectionRange(caret, caret); } catch(_){} fbInput.focus(); },
    rect: () => fbInput.getBoundingClientRect()
  };
  fbInput.addEventListener("input", () => updateFxMenu(fbFxTarget));
  fbInput.addEventListener("blur", () => hideFxMenu());
  fbInput.addEventListener("keydown", (e) => {
    if (fxHandleKey(e)) return;                       // 자동완성 목록이 떠 있으면 ↑↓·Tab·Enter 는 완성에 사용
    if (e.key === "Enter"){
      e.preventDefault();
      if (fbCell) applyCellInput(currentSheet, fbCell.r, fbCell.c, fbInput.value);
      try { sheet.focus({ preventScroll:true }); } catch(_){ }
      updateFormulaBar();
    } else if (e.key === "Escape"){
      e.preventDefault(); updateFormulaBar(); try { sheet.focus(); } catch(_){ }
    }
    e.stopPropagation();
  });
  // 선택이 바뀌면 채우기 핸들 위치 + 수식 입력줄을 함께 갱신
  const onCellSelect = () => { positionFillHandle(); updateFormulaBar(); };
  const clearFillPreview = () => sheet.querySelectorAll(".sheet-fill-preview").forEach(el => el.classList.remove("sheet-fill-preview"));
  // 숫자 수열이면 마지막 간격만큼 이어서 생성, 아니면 원본 값을 순환 복사
  const fillSeries = (vals) => {
    const nums = vals.map(v => (typeof v === "number") ? v : null);
    if (nums.length && nums.every(n => n != null)){
      const base = nums[nums.length - 1];
      const step = nums.length === 1 ? 1 : (nums[nums.length - 1] - nums[nums.length - 2]);
      return (i) => base + step * (i + 1);
    }
    return (i) => vals[i % vals.length];
  };
  const applyFill = (src, t) => {
    const model = exModels[currentSheet]; if (!model) return;
    pushUndo(currentSheet);
    const copiedRows = new Set();
    // val(리터럴) 또는 f(수식, 있으면 우선) 로 대상 셀을 채운다.
    const setCell = (r, c, val, f) => {
      if (!model[r] || !model[r][c]) return;
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        const prev = model[r][c];
        model[r][c] = f
          ? { ...prev, f, style:cloneSpreadsheetValue(prev.style || {}) }
          : { ...prev, v:val, xv: val === "" ? null : val, f:null, style:cloneSpreadsheetValue(prev.style || {}) };
      } else {
        const s = model[r][c];
        if (f){ s.f = f; }
        else { s.v = val; s.xv = val === "" ? null : val; s.f = null; if (!structChanged.has(currentSheet)) markEdit(currentSheet, r, c, val); }
      }
      if (f) sheetsWithFormula.add(currentSheet);
      const td = modelCellTd(r, c);                // 수식 셀은 recalcAndRefresh가 값을 채워 갱신, 리터럴은 여기서 바로
      if (td && !f){ td.textContent = dispCell(model[r][c]); td.classList.toggle("num", typeof model[r][c].v === "number"); applyCellStyleToTd(td, model[r][c]); }
    };
    // 수식이 섞인 원본은 셀 단위로 복제(수식은 상대참조를 이동 델타만큼 조정), 순수 숫자는 등차수열 연장.
    const shiftRow = (delta) => (cc, rr, ab) => ({ c: cc, r: ab.rowAbs ? rr : rr + delta });
    const shiftCol = (delta) => (cc, rr, ab) => ({ c: ab.colAbs ? cc : cc + delta, r: rr });
    if (t.axis === "v"){
      const down = t.r2 > src.r2;
      for (let c = src.c1; c <= src.c2; c++){
        const srcCells = []; for (let r = src.r1; r <= src.r2; r++) srcCells.push(model[r][c]);
        const H = srcCells.length;
        const textGen = srcCells.every(s => !s.f && typeof s.v === "string")
          ? spreadsheetTextSeries(down ? srcCells.map(s => s.v) : srcCells.map(s => s.v).slice().reverse())
          : null;
        if (srcCells.every(s => !s.f && typeof s.v === "number")){         // 순수 숫자 → 등차 연장
          const gen = fillSeries(down ? srcCells.map(s => s.v) : srcCells.map(s => s.v).slice().reverse());
          let i = 0;
          if (down) for (let r = src.r2 + 1; r <= t.r2; r++) setCell(r, c, gen(i++), null);
          else for (let r = src.r1 - 1; r >= t.r1; r--) setCell(r, c, gen(i++), null);
        } else if (textGen){                                                // 요일·월·"1반" 등 텍스트 패턴 연장
          let i = 0;
          if (down) for (let r = src.r2 + 1; r <= t.r2; r++) setCell(r, c, textGen(i++), null);
          else for (let r = src.r1 - 1; r >= t.r1; r--) setCell(r, c, textGen(i++), null);
        } else {                                                            // 그 외 → 패턴 순환(수식은 참조 조정)
          let i = 0;
          const put = (r) => {
            const idx = i % H, sIdx = down ? idx : (H - 1 - idx);
            const s = srcCells[sIdx], srcRow = down ? (src.r1 + sIdx) : (src.r2 - sIdx);
            if (s.f) setCell(r, c, null, remapFormulaRefs(s.f, shiftRow(r - srcRow)));
            else setCell(r, c, s.v, null);
            i++;
          };
          if (down) for (let r = src.r2 + 1; r <= t.r2; r++) put(r);
          else for (let r = src.r1 - 1; r >= t.r1; r--) put(r);
        }
      }
    } else {
      const right = t.c2 > src.c2;
      for (let r = src.r1; r <= src.r2; r++){
        const srcCells = []; for (let c = src.c1; c <= src.c2; c++) srcCells.push(model[r][c]);
        const W = srcCells.length;
        const textGen = srcCells.every(s => !s.f && typeof s.v === "string")
          ? spreadsheetTextSeries(right ? srcCells.map(s => s.v) : srcCells.map(s => s.v).slice().reverse())
          : null;
        if (srcCells.every(s => !s.f && typeof s.v === "number")){
          const gen = fillSeries(right ? srcCells.map(s => s.v) : srcCells.map(s => s.v).slice().reverse());
          let i = 0;
          if (right) for (let c = src.c2 + 1; c <= t.c2; c++) setCell(r, c, gen(i++), null);
          else for (let c = src.c1 - 1; c >= t.c1; c--) setCell(r, c, gen(i++), null);
        } else if (textGen){
          let i = 0;
          if (right) for (let c = src.c2 + 1; c <= t.c2; c++) setCell(r, c, textGen(i++), null);
          else for (let c = src.c1 - 1; c >= t.c1; c--) setCell(r, c, textGen(i++), null);
        } else {
          let i = 0;
          const put = (c) => {
            const idx = i % W, sIdx = right ? idx : (W - 1 - idx);
            const s = srcCells[sIdx], srcCol = right ? (src.c1 + sIdx) : (src.c2 - sIdx);
            if (s.f) setCell(r, c, null, remapFormulaRefs(s.f, shiftCol(c - srcCol)));
            else setCell(r, c, s.v, null);
            i++;
          };
          if (right) for (let c = src.c2 + 1; c <= t.c2; c++) put(c);
          else for (let c = src.c1 - 1; c >= t.c1; c--) put(c);
        }
      }
    }
    anyDirty = true;
    recalcAndRefresh(currentSheet);              // 채운 값에 의존하는 수식 갱신
    toast("자동 채우기 완료", 1100);
  };
  fillHandle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const b = fillSelBounds(); if (!b) return;
    fillState = { src:b, target:null };
    try { fillHandle.setPointerCapture(e.pointerId); } catch(_){}
  });
  fillHandle.addEventListener("pointermove", (e) => {
    if (!fillState) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const td = el && el.closest && el.closest('td[data-mrow]');
    if (!td) return;
    const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol), b = fillState.src;
    const down = Math.max(0, r - b.r2), up = Math.max(0, b.r1 - r);
    const rightN = Math.max(0, c - b.c2), leftN = Math.max(0, b.c1 - c);
    const vert = Math.max(down, up), horiz = Math.max(rightN, leftN);
    let target = null;
    if (vert >= horiz && vert > 0) target = { r1:Math.min(b.r1, r), r2:Math.max(b.r2, r), c1:b.c1, c2:b.c2, axis:"v" };
    else if (horiz > 0) target = { r1:b.r1, r2:b.r2, c1:Math.min(b.c1, c), c2:Math.max(b.c2, c), axis:"h" };
    fillState.target = target;
    clearFillPreview();
    if (target){
      for (let rr = target.r1; rr <= target.r2; rr++)
        for (let cc = target.c1; cc <= target.c2; cc++){
          if (rr >= b.r1 && rr <= b.r2 && cc >= b.c1 && cc <= b.c2) continue;
          const cell = modelCellTd(rr, cc);
          if (cell) cell.classList.add("sheet-fill-preview");
        }
    }
  });
  const endFill = (e) => {
    if (!fillState) return;
    try { fillHandle.releasePointerCapture(e.pointerId); } catch(_){}
    const t = fillState.target, src = fillState.src;
    fillState = null;
    clearFillPreview();
    if (t && t.axis) applyFill(src, t);
    positionFillHandle();
  };
  fillHandle.addEventListener("pointerup", endFill);
  fillHandle.addEventListener("pointercancel", endFill);

  let spreadsheetImageUrls = [];
  let spreadsheetImageRenderToken = 0;
  const clearSpreadsheetImages = () => {
    spreadsheetImageRenderToken++;
    spreadsheetImageUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch(_){} });
    spreadsheetImageUrls = [];
    sheet.querySelectorAll(".xlsx-image-layer").forEach(layer => layer.remove());
  };
  if (doc){
    doc.cleanupFns.push(() => clearSpreadsheetImages());
  }
  const spreadsheetImageUrl = (image) => {
    if (!image || !image.bytes || typeof URL === "undefined" || typeof Blob === "undefined") return "";
    const url = URL.createObjectURL(new Blob([image.bytes], { type:image.mime || "application/octet-stream" }));
    spreadsheetImageUrls.push(url);
    return url;
  };
  const spreadsheetDomCell = (row, col) => {
    const modelCell = sheet.querySelector('td[data-mrow="' + row + '"][data-mcol="' + col + '"]');
    if (modelCell) return modelCell;
    const table = sheet.querySelector("table");
    if (!table) return null;
    const rows = [...table.rows].filter(tr => !tr.classList.contains("sheet-col-row") && !tr.classList.contains("xlsx-virtual-spacer"));
    const tr = rows[row];
    if (!tr) return null;
    let logicalCol = 0;
    for (const cell of [...tr.cells]){
      if (cell.classList.contains("sheet-row-head")) continue;
      const span = Math.max(1, Number(cell.colSpan) || 1);
      if (col >= logicalCol && col < logicalCol + span) return cell;
      logicalCol += span;
    }
    return null;
  };
  const primeSpreadsheetSourceLayout = (name) => {
    const layout = sourceLayoutSheets.get(name);
    if (!layout) return;
    if (!sheet.__sheetSizes) sheet.__sheetSizes = {};
    const sizes = sheet.__sheetSizes[name] || (sheet.__sheetSizes[name] = { col:{}, row:{} });
    if (!sizes.col) sizes.col = {};
    if (!sizes.row) sizes.row = {};
    Object.keys(layout.columns || {}).forEach(col => {
      if (sizes.col[col] == null) sizes.col[col] = layout.columns[col];
    });
    Object.keys(layout.rows || {}).forEach(row => {
      if (sizes.row[row] == null) sizes.row[row] = layout.rows[row];
    });
  };
  const decorateSpreadsheetSourceLayout = (name) => {
    const layout = sourceLayoutSheets.get(name);
    if (!layout) return;
    (layout.wrapCells || []).forEach(point => {
      const cell = spreadsheetDomCell(point.row, point.col);
      if (cell) cell.classList.add("xlsx-source-wrap");
    });
  };
  const spreadsheetAnchorPoint = (anchor) => {
    if (!anchor) return null;
    const row = Math.max(0, Math.floor(Number(anchor.row) || 0));
    const col = Math.max(0, Math.floor(Number(anchor.col) || 0));
    const cell = spreadsheetDomCell(row, col);
    if (!cell) return null;
    const sheetRect = sheet.getBoundingClientRect(), cellRect = cell.getBoundingClientRect();
    const colOffset = anchor.colOffsetPx != null && Number.isFinite(Number(anchor.colOffsetPx))
      ? Number(anchor.colOffsetPx) : (Number(anchor.col) - col) * cellRect.width;
    const rowOffset = anchor.rowOffsetPx != null && Number.isFinite(Number(anchor.rowOffsetPx))
      ? Number(anchor.rowOffsetPx) : (Number(anchor.row) - row) * cellRect.height;
    return {
      x:cellRect.left - sheetRect.left + sheet.scrollLeft + colOffset,
      y:cellRect.top - sheetRect.top + sheet.scrollTop + rowOffset
    };
  };
  const renderSpreadsheetImages = (name) => {
    clearSpreadsheetImages();
    const token = spreadsheetImageRenderToken;
    const occupied = new Set();
    const localImages = packageImageInfo.sheets.get(name) || [];
    localImages.forEach(image => {
      const cell = spreadsheetDomCell(image.row, image.col), url = spreadsheetImageUrl(image);
      if (!cell || !url) return;
      occupied.add(image.row + "," + image.col);
      const picture = document.createElement("img");
      picture.className = "xlsx-cell-picture"; picture.src = url; picture.alt = image.alt || "셀 이미지"; picture.draggable = false;
      picture.title = image.alt || "셀 이미지";
      picture.addEventListener("error", () => { if (token === spreadsheetImageRenderToken) picture.classList.add("is-error"); });
      cell.classList.add("xlsx-in-cell-image");
      cell.replaceChildren(picture);
    });
    (formulaImageSheets.get(name) || []).forEach(image => {
      if (occupied.has(image.row + "," + image.col)) return;
      const cell = spreadsheetDomCell(image.row, image.col);
      if (!cell) return;
      const note = document.createElement("span"); note.className = "xlsx-image-placeholder";
      const label = String(image.alt || "웹 이미지").trim() || "웹 이미지";
      note.textContent = "🖼 " + label;
      note.title = "IMAGE() 원격 그림은 오프라인·보안 정책상 자동 접속하지 않습니다. 원본: " + (image.source || "수식 참조");
      cell.classList.add("xlsx-in-cell-image", "xlsx-formula-image");
      cell.replaceChildren(note);
    });
    const floating = floatingImageSheets.get(name) || [];
    if (!floating.length) return;
    const layer = document.createElement("div"); layer.className = "xlsx-image-layer"; layer.setAttribute("aria-hidden", "true");
    sheet.appendChild(layer);
    floating.forEach(image => {
      const start = spreadsheetAnchorPoint(image.tl), end = spreadsheetAnchorPoint(image.br), url = spreadsheetImageUrl(image);
      if (!start || !url) return;
      const picture = document.createElement("img");
      picture.className = "xlsx-floating-picture"; picture.src = url; picture.alt = ""; picture.draggable = false;
      picture.style.left = Math.max(0, start.x) + "px"; picture.style.top = Math.max(0, start.y) + "px";
      picture.style.width = Math.max(1, end ? end.x - start.x : (image.ext && image.ext.width) || 96) + "px";
      picture.style.height = Math.max(1, end ? end.y - start.y : (image.ext && image.ext.height) || 72) + "px";
      picture.addEventListener("error", () => { if (token === spreadsheetImageRenderToken) picture.classList.add("is-error"); });
      layer.appendChild(picture);
    });
  };

  const renderReadonly = (name) => {
    clearSpreadsheetImages();
    formulaBar.hidden = true;
    clearVirtualEditor();
    if (exModels[name]){                          // 편집한 적 있으면 모델 값으로(편집 반영). 서식 표시는 유지, 색/병합은 보기에선 단순화.
      maybeRecalc(name);
      if (shouldVirtualize(name)){ renderVirtualModel(name, false); return; }
      sheet.replaceChildren(tableFromModel(spreadsheetDataModel(exModels[name]), false));
    } else {
      sheet.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false });
    }
    sheet.scrollTop = 0;
    primeSpreadsheetSourceLayout(name);
    enhanceSpreadsheetSelection(sheet, name, {
      isCellEmpty:exModels[name] ? modelNavigationCellEmpty(exModels[name]) : undefined
    });
    decorateSpreadsheetSourceLayout(name);
    renderSpreadsheetImages(name);
    if(exModels[name])applyWorksheetView(name);
  };

  const renderEditable = (name, options={}) => {
    clearSpreadsheetImages();
    syncSpreadsheetDirtyState(true);
    const model = exModels[name];
    if (!model){ sheet.textContent = "편집 데이터를 불러오는 중…"; return; }
    spreadsheetEnsureWorkspace(model, sheet.clientWidth);
    if (!options.skipRecalc) maybeRecalc(name);
    const unsupported = model.reduce((n,row)=>n+row.filter(cell=>cell.unsupportedFormula).length,0);
    formulaBar.title = unsupported ? unsupported + "개 수식은 원본 저장값을 표시합니다. 참조값을 바꾼 뒤에는 Excel에서 재계산하세요." : "";
    fbInput.placeholder = unsupported ? formulaBar.title : "값 또는 =수식 (예: =SUM(A1:A3))";
    compatNotice.hidden=!unsupported;compatNotice.textContent=unsupported?"원본 결과 사용: "+unsupported+"개 수식":"";compatNotice.title=formulaBar.title;
    clearVirtualEditor();
    if (shouldVirtualize(name)){
      sheet.scrollTop = options.preserveScroll?sheet.scrollTop:0;
      renderVirtualModel(name, true);
      return;
    }
    const table = tableFromModel(model, true);
    const scrollTop = sheet.scrollTop, scrollLeft = sheet.scrollLeft;
    sheet.replaceChildren(table); sheet.scrollTop = options.preserveScroll ? scrollTop : 0;
    primeSpreadsheetSourceLayout(name);
    enhanceSpreadsheetSelection(sheet, name, {
      editable:true,
      onSelectionChange:onCellSelect,
      isCellEmpty:modelNavigationCellEmpty(model)
    });
    bindEditableTable(table, name);
    decorateFilterHeads();
    updateFormulaBar();
    decorateSpreadsheetSourceLayout(name);
    renderSpreadsheetImages(name);
    applyWorksheetView(name);
    if (options.preserveScroll){ sheet.scrollTop = scrollTop; sheet.scrollLeft = scrollLeft; }
  };

  // 입력 확정과 Enter/Tab 이동이 끝난 뒤 빈 영역을 늘리고 선택·스크롤을 복원한다.
  let workspaceFrame = 0;
  const scheduleWorkspaceGrowth = () => {
    if (workspaceFrame) return;
    workspaceFrame = requestAnimationFrame(() => {
      workspaceFrame = 0;
      if (!editMode || !host.isConnected || !sheet.clientWidth || sheet.querySelector("td.editing")) return;
      if (sheet.querySelectorAll("td.sheet-selected").length > 1) return;
      const model = exModels[currentSheet];
      if (!spreadsheetEnsureWorkspace(model, sheet.clientWidth)) return;
      const anchor = sheet.querySelector("td.sheet-anchor[data-mrow]");
      const position = anchor ? { r:Number(anchor.dataset.mrow), c:Number(anchor.dataset.mcol) } : null;
      renderEditable(currentSheet, { preserveScroll:true, skipRecalc:true });
      if (position && sheet._selectSpreadsheetElement){
        const cell = modelCellTd(position.r, position.c);
        if (cell) sheet._selectSpreadsheetElement(cell);
      }
    });
  };
  let workspaceWidth = 0;
  const workspaceResize = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (sheet.clientWidth === workspaceWidth) return;
    workspaceWidth = sheet.clientWidth;
    scheduleWorkspaceGrowth();
  }) : null;
  if (workspaceResize) workspaceResize.observe(sheet);
  if (doc){
    doc.cleanupFns = doc.cleanupFns || [];
    doc.cleanupFns.push(() => {
      if (workspaceFrame) cancelAnimationFrame(workspaceFrame);
      if (workspaceResize) workspaceResize.disconnect();
    });
  }

  // 셀에 입력값(리터럴 또는 =수식)을 반영 — 셀 편집·수식 입력줄 공용. 변경되면 true.
  const applyCellInput = (name, r, c, text) => {
    const model = exModels[name]; if (!model || !model[r] || !model[r][c]) return false;
    let s = model[r][c];
    const isFormula = s.nf !== "@" && text[0] === "=" && text.length > 1;
    const newF = isFormula ? text.slice(1).trim() : null;
    const val = isFormula ? s.v : coerce(text, s.nf);                 // 수식이면 값은 재계산이 채움
    const changed = isFormula ? (newF !== s.f) : (val !== s.v || s.f != null);
    if (!changed) return false;
    const invalid=!isFormula && validateInput(s,val,name);
    if(invalid){toast(invalid,2500);return false;}
    pushUndo(name);
    if (csvFastAoa){
      model[r] = model[r].slice();
      s = { ...s, v:val, xv:isFormula ? s.xv : (val === "" ? null : val), f:newF, style:cloneSpreadsheetValue(s.style || {}) };
      model[r][c] = s;
    } else {
      s.f = newF;
      if (!isFormula){ s.v = val; s.xv = val === "" ? null : val; }
    }
    if(!isFormula && (!s.nf || s.nf==="General")){
      const nf=val instanceof Date?"yyyy-mm-dd":typeof val==="number" && String(text).trim().endsWith("%")?"0.00%":null;
      if(nf){s.nf=nf;s.style={...(s.style || {}),numFmt:nf};markStyle(name,r,c);}
    }
    expandTableForInput(name,r,c);
    if (isFormula) s.xv = {formula:newF};
    if (isFormula){ sheetsWithFormula.add(name); structChanged.add(name); anyDirty = true; }   // 수식 셀은 전체 재작성 경로로 저장
    else if (!structChanged.has(name)) markEdit(name, r, c, val);
    recalcAndRefresh();
    const td2 = modelCellTd(r, c);
    if (td2){ td2.textContent = dispCell(model[r][c]); td2.classList.toggle("num", typeof model[r][c].v === "number"); }
    refreshCondFormat();   // 값이 바뀌면 조건부 서식 라이브 갱신
    scheduleWorkspaceGrowth();
    return true;
  };


  const functionHelp = () => {
    const names=wb.Workbook?.Names || [],seen=new Set(),custom=[];
    const visible=names.filter(n=>n.Sheet!=null && wb.SheetNames[n.Sheet]===currentSheet).concat(names.filter(n=>n.Sheet==null));
    for(const item of visible){
      const details=spreadsheetFormulaFunctions.lambdaDetails(item.Ref),key=item.Name.toUpperCase();
      if(!details || seen.has(key))continue;
      seen.add(key);custom.push([item.Name,item.Name+"("+details.parameters.join(", ")+")",item.Comment || "사용자 정의 함수"]);
    }
    return [...custom,...SPREADSHEET_FN_HELP];
  };
  const changeFunctionDefinitions = next => {
    pushUndo(currentSheet);
    // 정의 삭제·변경 후 이전의 계산 결과를 최신 값으로 오인하지 않게 한다.
    for(const [home,rows] of Object.entries(exModels))rows.forEach((row,r)=>row.forEach((cell,c)=>{
      if(cell.f && formulaSupported(getAst(cell.f,home,r,c),home,r,c)){
        row[c]={...cell,xv:{formula:cell.f}};structChanged.add(home);
      }
    }));
    wb.Workbook=wb.Workbook || {};wb.Workbook.Names=next;
    astCache.clear();anyDirty=true;
    recalcAndRefresh();renderEditable(currentSheet);
  };
  let functionModal=null,functionModalKeydown=null;
  const closeFunctionManager = () => {
    if(functionModal){const focus=functionModal._returnFocus;functionModal.remove();functionModal=null;if(focus?.isConnected)focus.focus();}
    if(functionModalKeydown){document.removeEventListener("keydown",functionModalKeydown,true);functionModalKeydown=null;}
  };
  const openFunctionManager = () => {
    closeFunctionManager();
    const modal=document.createElement("div");modal.className="xlsx-function-overlay";
    modal.innerHTML='<form class="xlsx-function-dialog" role="dialog" aria-modal="true" aria-labelledby="xlsx-function-title">'+
      '<div class="xlsx-cond-head"><strong id="xlsx-function-title">내 함수 관리</strong><button type="button" data-a="close" aria-label="닫기">✕</button></div>'+
      '<p>함수를 등록하면 통합 문서에서 이름으로 호출할 수 있습니다. XLSX를 저장하면 함수도 함께 저장됩니다.</p>'+
      '<label>등록된 함수<select data-f="list" size="4" aria-label="등록된 함수"></select></label>'+
      '<button type="button" data-a="new">＋ 새 함수</button>'+
      '<label>함수 이름<input data-f="name" maxlength="255" placeholder="가중점수" autocomplete="off"></label>'+
      '<label>입력값 이름 (쉼표로 구분)<input data-f="params" placeholder="중간, 기말" autocomplete="off"></label>'+
      '<label>계산식<textarea data-f="body" rows="3" maxlength="10000" placeholder="중간*0.4+기말*0.6" spellcheck="false"></textarea></label>'+
      '<label>설명 (선택)<input data-f="comment" maxlength="255" placeholder="중간 40%, 기말 60%" autocomplete="off"></label>'+
      '<p data-f="usage" class="xlsx-function-usage"></p>'+
      '<label>시험할 수식<input data-f="test" placeholder="=가중점수(80,90)" spellcheck="false"></label>'+
      '<button type="button" data-a="test">계산해 보기</button><output data-f="result" aria-live="polite"></output>'+
      '<p data-f="error" role="alert"></p>'+
      '<div class="xlsx-cond-foot"><button type="button" data-a="delete" disabled>삭제</button><button type="submit">저장</button><button type="button" data-a="close2">닫기</button></div></form>';
    const field=key=>modal.querySelector('[data-f="'+key+'"]'),button=key=>modal.querySelector('[data-a="'+key+'"]');
    const list=field("list"),name=field("name"),params=field("params"),body=field("body"),comment=field("comment"),error=field("error");
    let selected=null,items=[];
    const usage=()=>{field("usage").textContent=name.value.trim()?"사용: ="+name.value.trim()+"("+params.value+")":"";error.textContent="";field("result").textContent="";};
    const refresh=()=>{
      list.replaceChildren();items=(wb.Workbook?.Names || []).filter(n=>spreadsheetFormulaFunctions.lambdaDetails(n.Ref));
      items.forEach((item,i)=>{
        const option=document.createElement("option");option.value=String(i);
        option.textContent=item.Name+(item.Sheet!=null?" · "+wb.SheetNames[item.Sheet]:" · 통합 문서");list.appendChild(option);
      });
      list.value=selected?String(items.indexOf(selected)):"";
      button("delete").disabled=!selected;
    };
    const edit=item=>{
      selected=item;const details=item?spreadsheetFormulaFunctions.lambdaDetails(item.Ref):null;
      name.value=item?.Name || "";name.readOnly=!!item;
      params.value=details?.parameters.join(", ") || "";body.value=details?.body || "";comment.value=item?.Comment || "";
      field("test").value="";usage();refresh();(item?body:name).focus();
    };
    const candidate=()=>{
      const result=spreadsheetTools.customFunctionDefinition(name.value,params.value,body.value,wb.Workbook?.Names || [],selected);
      if(result.error){error.textContent=result.error;return null;}
      const tables=Object.values(worksheetViews).flatMap(view=>view.tables || []);
      if(tables.some(t=>t.name.toUpperCase()===result.definition.Name.toUpperCase())){error.textContent="Excel 표 이름과 다른 함수 이름을 입력하세요.";return null;}
      return {...selected,...result.definition,...(comment.value.trim()?{Comment:comment.value.trim()}:{Comment:""})};
    };
    list.onchange=()=>edit(items[Number(list.value)] || null);
    button("new").onclick=()=>edit(null);
    [name,params,body,comment].forEach(input=>input.addEventListener("input",usage));
    modal.querySelector("form").onsubmit=event=>{
      event.preventDefault();const value=candidate();if(!value)return;
      const next=(wb.Workbook?.Names || []).filter(n=>n!==selected);next.push(value);
      changeFunctionDefinitions(next);selected=value;name.readOnly=true;refresh();
      error.textContent="";field("result").textContent="등록했습니다. "+field("usage").textContent;toast("함수를 등록했습니다. XLSX를 저장하면 파일에 보관됩니다.",2500);
    };
    button("test").onclick=()=>{
      const value=candidate();if(!value)return;
      const text=field("test").value.trim().replace(/^=/,"");if(!text){error.textContent="시험할 수식을 입력하세요. 예: =가중점수(80,90)";return;}
      const at=selectionTopLeft(),model=exModels[currentSheet];
      const resolver=(c,r,home)=>{const cell=(home?exModels[findModelSheet(home)]:model)?.[r]?.[c];return cell?.v ?? "";};
      resolver.bounds=home=>spreadsheetWorkspaceBounds(exModels[home || currentSheet] || []);
      resolver.resolveName=key=>key===value.Name.toUpperCase()?getAst(value.Ref,currentSheet,at.r,at.c):lookupFormulaName(key,currentSheet,at.r,at.c);
      let result;try{result=evaluateAst(getAst(text,currentSheet,at.r,at.c),resolver);}catch(_){result=FORMULA_ERR("#ERROR!");}
      field("result").textContent="결과: "+(isFormulaError(result)?result.__err:String(result));error.textContent="";
    };
    button("delete").onclick=async()=>{
      const target=selected;if(!target)return;
      if(!await confirmDialog("'"+target.Name+"' 함수를 삭제할까요? 사용하는 수식은 이름 오류가 될 수 있습니다.","삭제","취소"))return;
      if(!functionModal || functionModal!==modal)return;
      changeFunctionDefinitions((wb.Workbook?.Names || []).filter(n=>n!==target));edit(null);toast("함수를 삭제했습니다. 실행 취소로 되돌릴 수 있습니다.",2200);
    };
    button("close").onclick=closeFunctionManager;button("close2").onclick=closeFunctionManager;
    modal._returnFocus=document.activeElement;document.body.appendChild(modal);functionModal=modal;
    functionModalKeydown=event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();closeFunctionManager();}
      if(event.key==="Tab"){
        const inputs=[...modal.querySelectorAll("button,input,textarea,select")].filter(el=>!el.disabled);
        const first=inputs[0],last=inputs.at(-1);
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener("keydown",functionModalKeydown,true);
    edit(null);
  };
  if(doc){doc.cleanupFns=doc.cleanupFns || [];doc.cleanupFns.push(closeFunctionManager);}

  // ===== 수식 자동완성: '=SU' → 함수 후보 목록, 'SUM(' 안에서는 인자 힌트 =====
  const fxMenu = document.createElement("div"); fxMenu.className = "xlsx-fx-menu"; fxMenu.hidden = true;
  host.appendChild(fxMenu);
  let fxItems = [], fxIndex = -1, fxCtx = null, fxTarget = null;
  const hideFxMenu = () => { fxMenu.hidden = true; fxMenu.replaceChildren(); fxItems = []; fxIndex = -1; fxCtx = null; fxTarget = null; };
  const renderFxMenu = () => {
    fxMenu.replaceChildren();
    if (fxCtx && fxCtx.type === "args"){
      const fn = functionHelp().find(f => f[0].toUpperCase() === fxCtx.name);
      if (!fn){ hideFxMenu(); return; }
      const hint = document.createElement("div"); hint.className = "xlsx-fx-hint";
      const sig = document.createElement("b"); sig.textContent = fn[1];
      hint.append(sig, document.createTextNode(" — " + fn[2]));
      fxMenu.appendChild(hint);
    } else {
      fxItems.forEach((fn, i) => {
        const row = document.createElement("div");
        row.className = "xlsx-fx-item" + (i === fxIndex ? " sel" : "");
        const nm = document.createElement("b"); nm.textContent = fn[0];
        const sig = document.createElement("span"); sig.className = "xlsx-fx-sig"; sig.textContent = fn[1].slice(fn[0].length);
        const de = document.createElement("span"); de.className = "xlsx-fx-desc"; de.textContent = fn[2];
        row.append(nm, sig, de);
        // pointerdown + preventDefault: 편집 중인 셀의 blur(=확정)를 막고 완성만 넣는다
        row.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); fxIndex = i; fxAccept(); });
        fxMenu.appendChild(row);
      });
    }
    fxMenu.hidden = false;
    if (fxTarget){
      const r = fxTarget.rect();
      fxMenu.style.left = Math.max(6, Math.min(window.innerWidth - 330, r.left)) + "px";
      fxMenu.style.top = Math.min(window.innerHeight - 48, r.bottom + 2) + "px";
    }
  };
  const updateFxMenu = (target) => {
    if (!editMode){ hideFxMenu(); return; }
    const st = target.get();
    const ctx = formulaTypingContext(st.text, st.caret);
    if (!ctx){ hideFxMenu(); return; }
    fxTarget = target; fxCtx = ctx;
    if (ctx.type === "name"){
      const q = ctx.partial.toUpperCase();
      fxItems = functionHelp().filter(f => f[0].toUpperCase().startsWith(q)).slice(0, 9);
      if (!fxItems.length){ hideFxMenu(); return; }
      fxIndex = 0;
    } else {
      fxItems = []; fxIndex = -1;
    }
    renderFxMenu();
  };
  const fxAccept = () => {
    if (!fxTarget || !fxCtx || fxCtx.type !== "name" || fxIndex < 0 || !fxItems[fxIndex]) return false;
    const name = fxItems[fxIndex][0];
    const st = fxTarget.get();
    const target = fxTarget;
    target.set(st.text.slice(0, fxCtx.start) + name + "(" + st.text.slice(st.caret), fxCtx.start + name.length + 1);
    updateFxMenu(target);                     // 삽입 직후 인자 힌트로 전환
    return true;
  };
  // 자동완성이 떠 있을 때의 키 처리(↑↓ 이동 · Tab/Enter 완성 · Esc 닫기). 소비했으면 true.
  const fxHandleKey = (e) => {
    if (fxMenu.hidden) return false;
    if (fxCtx && fxCtx.type === "name" && fxItems.length){
      if (e.key === "ArrowDown" || e.key === "ArrowUp"){
        e.preventDefault(); e.stopPropagation();
        fxIndex = (fxIndex + (e.key === "ArrowDown" ? 1 : -1) + fxItems.length) % fxItems.length;
        renderFxMenu();
        return true;
      }
      if (e.key === "Tab" || e.key === "Enter"){
        e.preventDefault(); e.stopPropagation();
        fxAccept();
        return true;
      }
    }
    if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); hideFxMenu(); return true; }
    return false;
  };
  const tdFxTarget = (td) => ({
    get: () => {
      const text = td.textContent || "";
      let caret = text.length;
      const sel = window.getSelection();
      if (sel && sel.anchorNode && td.contains(sel.anchorNode) && sel.anchorNode.nodeType === 3) caret = sel.anchorOffset;
      return { text, caret };
    },
    set: (text, caret) => {
      td.textContent = text;
      const node = td.firstChild;
      if (node){
        const range = document.createRange();
        range.setStart(node, Math.min(caret, node.textContent.length));
        range.collapse(true);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }
    },
    rect: () => td.getBoundingClientRect()
  });

  // 편집 확정 후 화면(표시) 순서 기준으로 이웃 셀로 선택 이동 — 엑셀의 Enter(아래)/Tab(오른쪽) 흐름.
  // 필터·정렬로 모델 행 순서와 다를 수 있어 DOM 이웃을 따라간다. 가장자리는 제자리 유지.
  const moveEditSelection = (fromTd, dr, dc) => {
    if (!fromTd || !fromTd.isConnected) return;
    let target = null;
    if (dr){
      let tr = dr > 0 ? fromTd.parentElement.nextElementSibling : fromTd.parentElement.previousElementSibling;
      while (tr && (tr.hidden || tr.classList.contains("xlsx-virtual-spacer"))) tr = dr > 0 ? tr.nextElementSibling : tr.previousElementSibling;
      if (tr && tr.cells) target = tr.cells[fromTd.cellIndex];
    } else if (dc){
      target = dc > 0 ? fromTd.nextElementSibling : fromTd.previousElementSibling;
      while(target && target.hidden)target=dc>0?target.nextElementSibling:target.previousElementSibling;
    }
    if (!target || !target.hasAttribute || !target.hasAttribute("data-mrow")) target = fromTd;
    try { sheet.focus({ preventScroll: true }); } catch(_){ sheet.focus(); }
    if (typeof sheet._selectSpreadsheetElement === "function") sheet._selectSpreadsheetElement(target);
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const startCellEdit = (td, name, editOpts={}) => {
    const model = exModels[name]; if (!model) return;
    const r = Number(td.dataset.mrow), c = Number(td.dataset.mcol);
    let s = model[r][c];
    const nativeValues=s && !s.dv?validationList(s.validation,name):null;
    if(nativeValues && nativeValues.length){openCellDropdown(td,name,r,c,nativeValues);return;}
    if (s && s.dv && s.dv.type === "list" && s.dv.values && s.dv.values.length){
      openCellDropdown(td, name, r, c, s.dv.values);   // 목록 유효성 셀은 자유 입력 대신 드롭다운
      return;
    }
    // replaceWith: 타이핑 즉시 입력(기존 값 대체). 캐럿은 끝에 두어 이어서 입력되게 한다.
    const replace = editOpts.replaceWith != null;
    td.contentEditable = "true"; td.classList.add("editing");
    td.textContent = replace ? String(editOpts.replaceWith)
      : (s.f != null && s.f !== "") ? ("=" + s.f) : rawText(s);   // 수식 셀은 '=수식'을 보여줌
    td.focus();
    const range = document.createRange(); range.selectNodeContents(td);
    if (replace) range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const fxT = tdFxTarget(td);
    const onInput = () => updateFxMenu(fxT);
    // 셀 우클릭 메뉴(복사·붙여넣기·특수문자). 메뉴·문자표가 떠 있는 동안은 편집을 끝내지 않는다 —
    // 셀은 포커스를 잃는 순간 커밋되는데, 메뉴에 잠깐 포커스가 갈 수 있기 때문이다.
    let menuOpen = false;
    let detachCellMenu = null;
    const finish = (commit) => {
      td.removeEventListener("blur", onBlur); td.removeEventListener("keydown", onKey);
      td.removeEventListener("input", onInput);
      if (detachCellMenu){ detachCellMenu(); detachCellMenu = null; }
      hideFxMenu();
      td.contentEditable = "false"; td.classList.remove("editing");
      if (commit) applyCellInput(name, r, c, td.textContent);
      s = model[r][c];
      td.textContent = dispCell(s);
      td.classList.toggle("num", typeof s.v === "number");
      updateFormulaBar();
    };
    const onBlur = () => { if (menuOpen) return; finish(true); };
    const onKey = (e) => {
      if (fxHandleKey(e)) return;                     // 자동완성 목록이 떠 있으면 ↑↓·Tab·Enter 는 완성에 사용
      if (e.key === "Enter" && !e.altKey){ e.preventDefault(); finish(true); moveEditSelection(td, e.shiftKey ? -1 : 1, 0); }
      else if (e.key === "Tab"){ e.preventDefault(); finish(true); moveEditSelection(td, 0, e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape"){ e.preventDefault(); finish(false); }
      e.stopPropagation();
    };
    td.addEventListener("blur", onBlur);
    td.addEventListener("keydown", onKey);
    td.addEventListener("input", onInput);
    if (typeof attachEditableContextMenu === "function"){
      detachCellMenu = attachEditableContextMenu(td, {
        sanitize:(text) => text.replace(/[\t\r\n]+/g, " "),
        onMenuOpen:() => { menuOpen = true; },
        onMenuClose:() => { menuOpen = false; try { td.focus({ preventScroll:true }); } catch(_){} }
      });
    }
    if (replace) onInput();                             // '=' 로 시작하면 바로 함수 자동완성 표시
  };

  // ----- 선택 범위의 좌상단(붙여넣기·병합 기준점) -----
  const selectionTopLeft = () => {
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return { r:0, c:0 };
    return {
      r: Math.min(...marked.map(td => Number(td.dataset.mrow))),
      c: Math.min(...marked.map(td => Number(td.dataset.mcol)))
    };
  };
  const selectionBounds = () => {
    if (hasNonContiguousSelection()) return null;
    const marked = [...sheet.querySelectorAll('td.sheet-selected[data-mrow]')];
    if (!marked.length) return null;
    const rows = marked.map(td => Number(td.dataset.mrow)), cols = marked.map(td => Number(td.dataset.mcol));
    return { s:{ r:Math.min(...rows), c:Math.min(...cols) }, e:{ r:Math.max(...rows), c:Math.max(...cols) } };
  };

  // ----- 클립보드 표 붙여넣기(선택 좌상단부터 채우고, 부족하면 행·열 확장) -----
  const pasteGridIntoSelection = (grid) => {
    if (warnContiguousSelection("붙여넣으려면")) return;
    const model = exModels[currentSheet];
    if (!model || !grid.length) return;
    const { r:r0, c:c0 } = selectionTopLeft();
    const gridCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    const needRows = r0 + grid.length, needCols = c0 + gridCols;
    for(let i=0;i<grid.length;i++)for(let j=0;j<grid[i].length;j++){
      const cell=model[r0+i]?.[c0+j],invalid=validateInput(cell,coerce(grid[i][j],cell?.nf));
      if(invalid){toast(encodeSpreadsheetCell(r0+i,c0+j)+": "+invalid+" 붙여넣기는 적용하지 않았습니다.",3000);return;}
    }
    pushUndo(currentSheet);
    const curCols = model[0] ? model[0].length : 0;
    let grew = false;
    while (model.length < needRows){ model.push(Array.from({ length: Math.max(curCols, needCols) }, blankCell)); grew = true; }
    if (needCols > curCols){ model.forEach((row) => { while (row.length < needCols) row.push(blankCell()); }); grew = true; }
    const copiedRows = new Set();
    for (let i = 0; i < grid.length; i++){
      for (let j = 0; j < grid[i].length; j++){
        const r = r0 + i, c = c0 + j;
        const val = coerce(grid[i][j], model[r][c].nf);
        if (csvFastAoa){
          if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
          const prev = model[r][c];
          model[r][c] = { ...prev, v:val, xv:val === "" ? null : val, f:null, style:cloneSpreadsheetValue(prev.style || {}) };
        } else {
          const s = model[r][c]; s.v = val; s.xv = val === "" ? null : val; s.f = null;   // 붙여넣기는 리터럴로 덮음
          if (!grew && !structChanged.has(currentSheet)) markEdit(currentSheet, r, c, val);
        }
      }
    }
    if (grew || sheetsWithFormula.has(currentSheet)) structChanged.add(currentSheet);   // 수식 있으면 결과 갱신 위해 전체 재작성
    anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);      // renderEditable 이 재계산까지 수행
    toast(grid.length + "×" + gridCols + " 붙여넣었어요.", 1800);
  };

  // ----- 서식 포함 복사/붙여넣기: 선택 사각형의 값·수식·번호서식·스타일을 통째로 담았다가 복원 -----
  // 수식은 엑셀처럼 복사 위치만큼 상대참조를 옮겨 붙인다($ 절대참조는 고정). 잘라내기는 참조를 그대로 유지.
  const captureRichSelection = () => {
    if (hasNonContiguousSelection()) return null;
    const model = exModels[currentSheet];
    const b = selectionBounds();
    if (!model || !b) return null;
    const cells = [], lines = [];
    for (let r = b.s.r; r <= b.e.r; r++){
      const rowCells = [], line = [];
      for (let c = b.s.c; c <= b.e.c; c++){
        const s = (model[r] && model[r][c]) || blankCell();
        rowCells.push({
          v: cloneSpreadsheetValue(s.v),
          f: s.f || null,
          nf: s.nf || null,
          style: cloneSpreadsheetValue(s.style || {}),
          validation:cloneSpreadsheetValue(s.validation || null),
          dv: s.dv ? cloneSpreadsheetValue(s.dv) : null
        });
        line.push(dispCell(s));
      }
      cells.push(rowCells);
      lines.push(line.join("\t"));
    }
    return { cells, tsv: lines.join("\n"), origin: { sheet:currentSheet, r:b.s.r, c:b.s.c } };
  };
  const copyRichSelection = async () => {
    if (warnContiguousSelection("복사하려면")) return;
    const clip = captureRichSelection();
    if (!clip){ toast("복사할 셀을 먼저 선택하세요.", 1600); return; }
    richClip = clip;
    await copySpreadsheetText(clip.tsv);
    const rows = clip.cells.length, cols = clip.cells[0] ? clip.cells[0].length : 0;
    toast(rows + "×" + cols + " 복사했어요(서식 포함, Ctrl+V).", 1500);
  };
  const pasteRichIntoSelection = (clip, mode="all") => {
    if (warnContiguousSelection("붙여넣으려면")) return;
    const model = exModels[currentSheet];
    if (!model || !clip || !clip.cells.length) return;
    const grid = mode==="transpose"
      ? Array.from({length:Math.max(...clip.cells.map(row=>row.length))},(_,c)=>clip.cells.map(row=>({...row[c],f:null})))
      : clip.cells;
    const { r:r0, c:c0 } = selectionTopLeft();
    const gridCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    const needRows = r0 + grid.length, needCols = c0 + gridCols;
    for(let i=0;i<grid.length;i++)for(let j=0;j<grid[i].length;j++){
      const cell=["values","formulas"].includes(mode)?model[r0+i]?.[c0+j]:grid[i][j];
      const invalid=validateInput(cell,grid[i][j].v);
      if(invalid){toast(encodeSpreadsheetCell(r0+i,c0+j)+": "+invalid+" 붙여넣기는 적용하지 않았습니다.",3000);return;}
    }
    pushUndo(currentSheet);
    const curCols = model[0] ? model[0].length : 0;
    while (model.length < needRows) model.push(Array.from({ length: Math.max(curCols, needCols) }, blankCell));
    if (needCols > curCols) model.forEach(row => { while (row.length < needCols) row.push(blankCell()); });
    // 복사 원점 → 붙여넣기 위치의 이동량. 복사한 수식은 이만큼 상대참조를 옮긴다(잘라내기는 그대로).
    const dr = clip.origin ? r0 - clip.origin.r : 0;
    const dc = clip.origin ? c0 - clip.origin.c : 0;
    const sourceSheet = clip.origin && clip.origin.sheet ? clip.origin.sheet : currentSheet;
    const sourceBounds = {
      s:{ r:clip.origin ? clip.origin.r : r0, c:clip.origin ? clip.origin.c : c0 },
      e:{
        r:(clip.origin ? clip.origin.r : r0) + grid.length - 1,
        c:(clip.origin ? clip.origin.c : c0) + gridCols - 1
      }
    };
    let pastedFormula = false;
    for (let i = 0; i < grid.length; i++){
      for (let j = 0; j < grid[i].length; j++){
        const r = r0 + i, c = c0 + j;
        const src = grid[i][j];
        const v = cloneSpreadsheetValue(src.v);
        let f = mode==="values" || mode==="transpose" ? null : src.f || null;
        if (f && !clip.cut && (dr || dc)){
          f = remapFormulaRefs(
            f,
            (cc, rr, abs) => ({ c:abs.colAbs ? cc : cc + dc, r:abs.rowAbs ? rr : rr + dr }),
            { includeSheetRefs:true }
          );
        } else if (f && clip.cut && sourceSheet !== currentSheet){
          // 다른 시트로 범위를 옮길 때, 옮긴 수식 안의 로컬 참조는 원래 시트를 기준으로 목적지에 다시 연결한다.
          f = remapMovedFormulaRefs(f, sourceSheet, sourceSheet, currentSheet, sourceBounds, dr, dc);
        }
        const cell = {
          v, xv: f ? null : ((v === "" || v == null) ? null : cloneSpreadsheetValue(v)),
          f, nf: ["values","formulas"].includes(mode) ? model[r][c].nf : src.nf || null,
          style:cloneSpreadsheetValue(["values","formulas"].includes(mode) ? model[r][c].style || {} : src.style || {})
        };
        cell.validation = cloneSpreadsheetValue(["values","formulas"].includes(mode)?spreadsheetTools.validationFor(model[r][c]):src.validation || null);
        if (!["values","formulas"].includes(mode) && src.dv) cell.dv = cloneSpreadsheetValue(src.dv);
        model[r][c] = cell;
        if (f) pastedFormula = true;
      }
    }
    if (clip.cut && mode==="all" && clip.origin){
      // 잘라낸 범위를 참조하던 워크북의 다른 수식도 새 위치를 따라가게 한다.
      Object.keys(exModels).forEach(name => {
        const targetModel = exModels[name];
        if (!targetModel) return;
        const copiedRows = new Set();
        let changed = false;
        for (let r = 0; r < targetModel.length; r++){
          if (!targetModel[r]) continue;
          for (let c = 0; c < targetModel[r].length; c++){
            const cell = targetModel[r][c];
            if (!cell || !cell.f) continue;
            const next = remapMovedFormulaRefs(cell.f, name, sourceSheet, currentSheet, sourceBounds, dr, dc);
            if (next === cell.f) continue;
            if (csvFastAoa){
              if (!copiedRows.has(r)){ targetModel[r] = targetModel[r].slice(); copiedRows.add(r); }
              targetModel[r][c] = { ...targetModel[r][c], f:next };
            } else {
              cell.f = next;
            }
            changed = true;
          }
        }
        if (changed){ sheetsWithFormula.add(name); structChanged.add(name); }
      });
    }
    if (pastedFormula) sheetsWithFormula.add(currentSheet);   // 재계산 대상으로 등록(결과는 renderEditable 이 채움)
    structChanged.add(currentSheet);   // 값+서식을 함께 되쓰므로 전체 재작성 경로로 저장
    anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);
    if (clip.cut) richClip = null;                           // 잘라내기는 첫 성공적인 붙여넣기에서 소비
    toast(grid.length + "×" + gridCols + " 붙여넣었어요(서식·수식 포함).", 1800);
  };

  // ----- 셀 병합 / 병합 해제 -----
  const mergeSelection = () => {
    if (warnContiguousSelection("병합하려면")) return;
    const b = selectionBounds();
    if (!b || (b.s.r === b.e.r && b.s.c === b.e.c)){ toast("두 칸 이상 선택해 병합하세요.", 2000); return; }
    pushUndo(currentSheet);
    const model = exModels[currentSheet];
    exMerges[currentSheet] = (exMerges[currentSheet] || [])
      .filter(m => !spreadsheetRangesOverlap(decodeSpreadsheetMerge(m), b));      // 겹치는 기존 병합 흡수
    exMerges[currentSheet].push(encodeSpreadsheetCell(b.s.r, b.s.c) + ":" + encodeSpreadsheetCell(b.e.r, b.e.c));
    for (let r = b.s.r; r <= b.e.r; r++)                                          // 좌상단 외 값 비움(엑셀 동작)
      for (let c = b.s.c; c <= b.e.c; c++){
        if (r === b.s.r && c === b.s.c) continue;
        const s = model[r] && model[r][c]; if (s){ s.v = ""; s.xv = null; }
      }
    structChanged.add(currentSheet); anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);
    toast("선택 범위를 병합했어요.", 1500);
  };
  const unmergeSelection = () => {
    if (warnContiguousSelection("병합을 해제하려면")) return;
    const b = selectionBounds();
    if (!b){ toast("병합 해제할 셀을 선택하세요.", 1800); return; }
    const before = (exMerges[currentSheet] || []).length;
    const kept = (exMerges[currentSheet] || []).filter(m => !spreadsheetRangesOverlap(decodeSpreadsheetMerge(m), b));
    if (kept.length === before){ toast("선택 안에 병합된 셀이 없어요.", 1800); return; }
    pushUndo(currentSheet);
    exMerges[currentSheet] = kept;
    structChanged.add(currentSheet); anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);
    toast("병합을 해제했어요.", 1400);
  };

  // ----- Σ 자동계산: 선택 범위 바로 아래(또는 오른쪽)에 SUM·AVERAGE 등 수식 자동 삽입 -----
  const insertAutoFormula = (fnName) => {
    if (warnContiguousSelection("자동계산하려면")) return;
    const model = exModels[currentSheet]; if (!model) return;
    const b = selectionBounds();
    if (!b){ toast("계산할 범위를 먼저 선택하세요.", 2000); return; }
    const jobs = spreadsheetAutoFormulaJobs(model, b, fnName);
    if (!jobs.length){ toast("선택 범위(단일 셀이면 위·왼쪽)에 숫자가 있어야 해요.", 2400); return; }
    pushUndo(currentSheet);
    // 수식이 들어갈 자리가 격자 밖이면 행/열을 늘린다
    const curCols = model[0] ? model[0].length : 0;
    const needRows = Math.max(...jobs.map(j => j.r)) + 1;
    const needCols = Math.max(...jobs.map(j => j.c)) + 1;
    while (model.length < needRows) model.push(Array.from({ length: Math.max(curCols, needCols) }, blankCell));
    if (needCols > curCols) model.forEach(row => { while (row.length < needCols) row.push(blankCell()); });
    const copiedRows = new Set();
    jobs.forEach(({ r, c, f }) => {
      if (csvFastAoa){
        if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
        model[r][c] = { ...model[r][c], f, style: cloneSpreadsheetValue(model[r][c].style || {}) };
      } else {
        model[r][c].f = f;
      }
    });
    sheetsWithFormula.add(currentSheet);
    structChanged.add(currentSheet);
    anyDirty = true;
    buildEditBar(); renderEditable(currentSheet);   // renderEditable 이 재계산까지 수행
    toast(jobs.length + "개 셀에 " + fnName + " 수식을 넣었어요.", 1800);
  };

  const clipboardHtmlCells = html => {
    if(!html || html.length>5000000)return null;
    const safe=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,"")
      .replace(/<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi,(tag,name)=>{
        if(!["table","thead","tbody","tfoot","tr","td","th","br"].includes(name.toLowerCase()))return "";
        if(tag.startsWith("</"))return "</"+name+">";
        const attrs=[];
        for(const key of ["style","rowspan","colspan"]){
          const m=new RegExp("\\b"+key+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')","i").exec(tag);
          if(m)attrs.push(key+'="'+String(m[1]??m[2]).replace(/&/g,"&amp;").replace(/"/g,"&quot;")+'"');
        }
        return "<"+name+" "+attrs.join(" ")+">";
      });
    const parsed=new DOMParser().parseFromString(safe,"text/html"),table=parsed.querySelector("table");if(!table)return null;
    const grid=[];let count=0;
    for(const [r,tr] of [...table.rows].entries()){
      grid[r]=grid[r] || [];let c=0;
      for(const td of tr.cells){
        while(grid[r][c])c++;
        const rs=Math.min(1000,Math.max(1,Number(td.getAttribute("rowspan")) || 1)),cs=Math.min(1000,Math.max(1,Number(td.getAttribute("colspan")) || 1));
        if(count+rs*cs>100000)return null;count+=rs*cs;
        const text=td.textContent || "",v=coerce(text),style={},css=td.style;
        const rgb=color=>{const m=/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(color);return m?"FF"+m.slice(1).map(n=>Number(n).toString(16).padStart(2,"0")).join("").toUpperCase():/^#[a-f0-9]{6}$/i.test(color)?"FF"+color.slice(1).toUpperCase():null;};
        if(css.fontWeight || css.fontStyle || css.fontFamily || css.color)style.font={bold:css.fontWeight==="bold" || Number(css.fontWeight)>=600,italic:css.fontStyle==="italic",
          name:css.fontFamily || undefined,...(rgb(css.color)?{color:{argb:rgb(css.color)}}:{})};
        if(css.fontSize){style.font=style.font || {};style.font.size=parseFloat(css.fontSize)*(css.fontSize.endsWith("px")?0.75:1);}
        if(rgb(css.backgroundColor))style.fill={type:"pattern",pattern:"solid",fgColor:{argb:rgb(css.backgroundColor)}};
        if(css.textAlign)style.alignment={horizontal:css.textAlign};
        grid[r][c]={v,xv:v,f:null,style,nf:null};
        for(let dr=0;dr<rs;dr++)for(let dc=0;dc<cs;dc++){grid[r+dr]=grid[r+dr] || [];if(dr || dc)grid[r+dr][c+dc]=blankCell();}
        c+=cs;
      }
    }
    const cols=Math.max(...grid.map(row=>row.length));
    return grid.map(row=>Array.from({length:cols},(_,i)=>row[i] || blankCell()));
  };
  // 편집 모드에서 시트에 포커스가 있을 때 클립보드 붙여넣기(셀 편집 중이면 네이티브 붙여넣기)
  sheet.addEventListener("paste", (e) => {
    if (!editMode) return;
    const t = e.target;
    if (t && t.closest && t.closest('[contenteditable="true"]')) return;
    const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    // 내부에서 복사(Ctrl+C)한 직후 클립보드가 그대로면 서식·번호서식까지 복원한다.
    // 윈도우 클립보드는 \n 을 \r\n 으로 되돌려주므로 줄바꿈을 통일해 비교한다.
    const normNl = (x) => String(x).replace(/\r\n?/g, "\n");
    if (richClip && normNl(text) === normNl(richClip.tsv)){
      e.preventDefault();
      pasteRichIntoSelection(richClip);
      return;
    }
    const html=e.clipboardData?e.clipboardData.getData("text/html"):"";
    const rich=clipboardHtmlCells(html);
    if(rich){e.preventDefault();pasteRichIntoSelection({cells:rich,cut:false});return;}
    if (!text) return;
    e.preventDefault();
    const grid = parseClipboardTable(text);
    if (grid.length) pasteGridIntoSelection(grid);
  });

  // ----- 편집 모델 → CSV(현재 시트) -----
  const csvCell = (s) => {
    let v = s.v;
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else if (v === null || v === undefined) v = "";
    else v = String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const modelToCsv = (model) => spreadsheetDataModel(model).map(row => row.map(csvCell).join(",")).join("\r\n");

  // ----- 편집 반영해 ExcelJS 바이트 생성(저장용). 손 안 댄 셀의 서식·수식·병합 보존 -----
  const exportExBytes = async () => {
    syncTableHeaders();recalcAll();
    // 캐시된 편집 기준 워크북을 직접 바꾸면 "저장 → 되돌리기 → 다시 저장"에서 이전 변경이 남는다.
    // 매 저장마다 원본 바이트를 새 워크북에 로드한 뒤 현재 모델만 반영한다.
    if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("exceljs");   // 저장 시점에도 준비 보장
    if (typeof ExcelJS === "undefined") return null;
    // 화면에서 조절한 열 폭·행 높이(모델 인덱스 기준)와 머리글 고정을 워크시트에 반영한다.
    const applyViewSizes = (ws, name) => {
      const sizes = sheet.__sheetSizes && sheet.__sheetSizes[name];
      const sourceLayout = sourceLayoutSheets.get(name);
      if (sizes){
        Object.keys(sizes.col || {}).forEach(c => {
          // 원본 폭을 픽셀로 표시한 값은 저장 시 역환산하지 않아 원본 정밀도를 보존한다.
          if (sourceLayout && sourceLayout.columns[c] === sizes.col[c]) return;
          try { ws.getColumn(Number(c) + 1).width = pxToExcelColWidth(sizes.col[c]); } catch(_){}
        });
        Object.keys(sizes.rowModel || {}).forEach(r => {
          try { ws.getRow(Number(r) + 1).height = pxToExcelRowHeight(sizes.rowModel[r]); } catch(_){}
        });
      }
      const view=worksheetViews[name];
      if(view && view.changed){
        ws.views=[{state:view.freezeRows || view.freezeCols ? "frozen":"normal",xSplit:view.freezeCols || 0,ySplit:view.freezeRows || 0,
          topLeftCell:encodeSpreadsheetCell(view.freezeRows || 0,view.freezeCols || 0)}];
        const rows=new Set(view.hiddenRows || []),cols=new Set(view.hiddenCols || []);
        ws.eachRow({includeEmpty:true},(row,n)=>{
          const data=exModels[name]?.[n-1] || [],filters=colFiltersBySheet[name] || {};
          row.hidden=rows.has(n-1) || (view.filterChanged && n>1 && Object.keys(filters).some(c=>!filters[c].has(dispCell(data[Number(c)] || {}))));
        });
        if(view.filterChanged)ws.autoFilter={from:"A1",to:encodeSpreadsheetCell(Math.max(0,spreadsheetWorkspaceBounds(exModels[name]).rows-1),Math.max(0,spreadsheetWorkspaceBounds(exModels[name]).cols-1))};
        (ws.columns || []).forEach((col,n)=>{col.hidden=cols.has(n);});
        if(view.printArea)ws.pageSetup.printArea=view.printArea;else delete ws.pageSetup.printArea;
        if(view.orientation)ws.pageSetup.orientation=view.orientation;
        if(view.fitWidth){ws.pageSetup.fitToPage=true;ws.pageSetup.fitToWidth=1;ws.pageSetup.fitToHeight=0;}
        else if(view.fitWidth===false){ws.pageSetup.fitToPage=false;delete ws.pageSetup.fitToWidth;delete ws.pageSetup.fitToHeight;}
        if(view.repeatHeader)ws.pageSetup.printTitlesRow="1:1";else delete ws.pageSetup.printTitlesRow;
      }
    };
    const applyTables=(ws,name)=>{
      const view=worksheetViews[name],model=exModels[name];
      if(!view || !Array.isArray(view.tables) || !model)return;
      ws.getTables().forEach(table=>ws.removeTable(table.name));
      view.tables.forEach(spec=>{
        const b=spec.range;if(!b || b.e.r<b.s.r || b.e.c<b.s.c)return;
        const start=b.s.r+(spec.headerRow===false?0:1),end=b.e.r-(spec.totalsRow?1:0);
        const rows=[];
        for(let r=start;r<=end;r++){
          const row=[];
          for(let c=b.s.c;c<=b.e.c;c++){
            const cell=model[r]?.[c];row.push(cell?.f?{formula:cell.f,result:cell.v}:cloneSpreadsheetValue(cell?.xv ?? cell?.v ?? null));
          }
          rows.push(row);
        }
        ws.addTable({name:spec.name,ref:encodeSpreadsheetCell(b.s.r,b.s.c),headerRow:spec.headerRow!==false,totalsRow:!!spec.totalsRow,
          style:spec.style || {theme:"TableStyleMedium2",showRowStripes:true},
          columns:spec.columns.map((name,i)=>({...spec.nativeColumns?.[i],name})),rows});
      });
    };
    const writeWorkbook=async workbook=>{
      const settings={};
      for(const name of wb.SheetNames)settings[name]={view:worksheetViews[name] || {},
        filters:Object.fromEntries(Object.entries(colFiltersBySheet[name] || {}).map(([c,v])=>[c,[...v]]))};
      if(wb.Workbook?.Names){
        const definitions=(wb.Workbook.Names || []).filter(n=>n.Name && n.Ref && !String(n.Ref).includes("#REF!"));
        workbook.definedNames.model=workbook.definedNames.model.map(entry=>{
          const updated=definitions.find(n=>n.Sheet==null && n.Name===entry.name);
          return updated && /!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/i.test(updated.Ref)?{...entry,ranges:[updated.Ref]}:entry;
        });
      }
      const result=spreadsheetTools.writeDefinedNames(await workbook.xlsx.writeBuffer(),wb.Workbook?.Names || []);
      return spreadsheetTools.writeSettings(result,settings);
    };
    let w = new ExcelJS.Workbook();
    if (csvFastAoa){
      for (const name of wb.SheetNames){                 // 탭 순서(드래그로 바꾼 순서)대로 기록
        if (!exModels[name]) continue;
        const ws = w.addWorksheet(name);
        applyTables(ws,name);
        writeStructuredSpreadsheetModel(ws, exModels[name], exMerges[name] || []);
        applyViewSizes(ws, name);
        writeCondFormattingToWs(ws, name);
      }
      return await writeWorkbook(w);
    }
    const loaded = await spreadsheetLoadExcelWorkbook(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ExcelJS);
    if (!loaded) return null;
    w = loaded;
    // 시트 구조 변경 반영: 삭제 → 이름 변경(임시 이름 2단계로 맞바꿈 충돌 방지) → 새 시트는 아래 루프에서 추가
    removedOrigSheets.forEach(orig => {
      const ws = w.getWorksheet(orig);
      if (ws){ try { w.removeWorksheet(ws.id); } catch(e){ console.warn("시트 삭제 실패:", orig, e); } }
    });
    const renamePending = [];
    sheetOrigNames.forEach((orig, current) => {
      const ws = w.getWorksheet(orig);
      if (ws && ws.name !== current){
        renamePending.push([ws, current]);
        try { ws.name = "__mn_rename_" + renamePending.length; } catch(_){}
      }
    });
    renamePending.forEach(([ws, current]) => { try { ws.name = current; } catch(_){} });
    for (const name of Object.keys(exModels)){
      let ws = w.getWorksheet(name);
      if (!ws){
        if (!addedSheets.has(name)) continue;
        ws = w.addWorksheet(name);                      // 새로 만든 시트는 원본에 없음 → 추가 후 전체 기록
      }
      const model = exModels[name];
      applyTables(ws,name);
      applyViewSizes(ws, name);
      writeCondFormattingToWs(ws, name);
      if (structChanged.has(name)){
        // 구조가 바뀐 시트도 원본 값 객체(수식·리치텍스트·링크)와 현재 병합 범위를 함께 되쓴다.
        writeStructuredSpreadsheetModel(ws, model, exMerges[name] || []);
        applyViewSizes(ws,name);
      } else {
        // 값만 편집된 시트: 바뀐 셀만 갱신 → 나머지 서식·수식·병합 그대로.
        editedCells[name].forEach((val, key) => {
          const [r, c] = key.split(",").map(Number);
          try { ws.getCell(r + 1, c + 1).value = (val === "" ? null : val); } catch(_){}
        });
        // 서식만 바뀐 셀: 값은 건드리지 않고 전체 스타일(글꼴·정렬·표시형식·채우기·테두리) 반영(수식·병합 보존)
        const sm = styledCells[name];
        if (sm && sm.size){
          const model = exModels[name];
          sm.forEach((_, key) => {
            const [r, c] = key.split(",").map(Number);
            const st = model[r] && model[r][c] && model[r][c].style;
            try { ws.getCell(r + 1, c + 1).style = cloneSpreadsheetValue(st || {}); } catch(_){}
          });
        }
      }
    }
    // 탭에서 드래그로 바꾼 시트 순서를 파일에 반영(ExcelJS 는 orderNo 오름차순으로 기록)
    wb.SheetNames.forEach((name, i) => {
      const ws = w.getWorksheet(name);
      if (ws) ws.orderNo = i + 1;
    });
    return await writeWorkbook(w);
  };
  const exportCurrentSheetExBytes = async (name) => {
    if (imageProtectedWorkbook) return null;
    const full = await exportExBytes();
    return spreadsheetIsolateWorksheetBytes(full, name);
  };
  const flushSpreadsheetBackup = async () => {
    clearTimeout(spreadsheetRecoveryTimer);
    spreadsheetRecoveryTimer = 0;
    if (!anyDirty || !doc || !doc.hasUnsavedEdits) return true;
    const out = await exportExBytes();
    if (!out || typeof saveDocumentRecoverySnapshot !== "function") return false;
    return saveDocumentRecoverySnapshot(doc, out,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };
  if (doc){
    doc.flushBackupRecovery = flushSpreadsheetBackup;
    doc.cleanupFns.push(() => {
      if (doc.flushBackupRecovery === flushSpreadsheetBackup) delete doc.flushBackupRecovery;
    });
  }

  /* 자동 저장 폴더(SaveRoot) 아래에 쓴다(exe 로컬 서버가 있을 때). 성공 시 저장된 경로, 실패·미지원이면 null.
     이름이 예전에 "saveBytesInPlace" 였는데 그건 사실이 아니다 — 서버가 X-Save-Path 를
     SaveRoot 기준으로 풀기 때문에 원본 자리가 아니라 사본이 생긴다. 원본을 덮어쓰려면 파일 쓰기
     핸들이 있어야 하고, 그건 saveBytesToDocumentHandle 이 맡는다. 부르는 쪽은 둘을 순서대로 쓰고
     어느 쪽으로 저장됐는지 사용자에게 밝혀야 한다. */
  const saveBytesToSaveRoot = async (out) => {
    try {
      if (typeof saveFileBackendAvailable !== "function" || !(await saveFileBackendAvailable())) return null;
      const rel = String((doc && (doc.relPath || doc.workspacePath || doc.name)) || file.name)
        .replace(/\\/g, "/").replace(/^\/+/, "");
      const res = await fetch("/save-file", {
        method: "POST",
        headers: { "X-Save-Path": encodeURIComponent(rel) },
        body: new Blob([out], { type: "application/octet-stream" })
      });
      if (!res.ok) return null;
      const savedPath = (await res.text()).trim() || rel;
      try { window.__mnLastSaveRel = rel; } catch(_){}   // 헤더 '저장 폴더'가 직전 저장 파일 폴더를 열 수 있게 기록
      return savedPath;
    } catch(e){ console.error(e); return null; }
  };
  const saveBytesToDocumentHandle = async (out) => {
    const kind = spreadsheetDirectSaveKind(doc);
    if (!kind) return { handled:false };
    const requiresOriginal = kind === "existing" || !!(doc && doc.originalSaveMode);
    if (typeof saveViaFileHandle !== "function") return requiresOriginal ? { handled:true, error:true } : { handled:false };
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const result = await saveViaFileHandle(out, (doc && doc.name) || (base + ".xlsx"), doc, {
      existingOnly:kind === "existing",
      mime,
      pickerTypes:[{
        description:"Excel 통합 문서",
        accept:{ [mime]:[".xlsx"] }
      }]
    });
    if (result === "cancelled") return { handled:true, cancelled:true };
    if (result !== "saved"){
      // 이미 연결된 파일의 쓰기 실패는 다른 위치에 조용히 저장하지 않는다.
      if (requiresOriginal) return { handled:true, error:true };
      return { handled:false };
    }
    const actualName = doc && doc.fsHandle && doc.fsHandle.name;
    if (actualName && doc.name !== actualName){
      doc.name = actualName;
      if (typeof refreshWorkspacePath === "function"){
        doc.workspacePath = refreshWorkspacePath(doc.workspacePath, actualName);
        if (doc.relPath) doc.relPath = refreshWorkspacePath(doc.relPath, actualName);
      }
      if (typeof refreshChrome === "function") refreshChrome();
    }
    if (doc && doc.fsHandle && doc.workspacePath && typeof saveFsHandle === "function")
      saveFsHandle(doc.workspacePath, doc.fsHandle);
    if (doc) doc._named = true;
    return { handled:true, saved:true, path:(doc && (doc.nativeAbsolutePath || doc.workspacePath || doc.name)) || (base + ".xlsx") };
  };
  const finishDirectSpreadsheetSave = async (out, direct) => {
    if (!direct || !direct.handled) return false;
    if (direct.saved){
      await markSpreadsheetSaved(out);
      toast("XLSX로 저장했어요: " + direct.path, 2400, { type:"success" });
    } else if (direct.error){
      toast("원본 XLSX에 저장하지 못했어요. 폴더 연결과 쓰기 권한을 확인하세요.", 2800, { type:"error" });
    }
    return true;
  };
  // 새로 만든 표의 첫 저장에 파일 이름을 받는다. XLSX 다운로드도 a.download 로 바로 내려가
  // 이름을 묻는 창이 없으므로 저장 방식과 무관하게 항상 거친다.
  // 반환: 계속 저장해도 되는지(false = 사용자가 취소).
  const askSpreadsheetScratchName = async () => {
    if (!doc || !doc.isScratch || doc._named) return true;
    // 사이드바에서 이미 이름을 정했으면 다시 묻지 않는다. 내보내기 파일 이름(base)만 그 이름에 맞춘다.
    if (doc._nameChosen){ base = sheetBaseName(doc.name || (base + ".xlsx")); return true; }
    if (typeof askScratchSaveName !== "function") return true;
    const named = await askScratchSaveName(doc, doc.name || (base + ".xlsx"),
      { fallbackExt:".xlsx", placeholder:"예: 성적표" });
    if (named === null) return false;
    base = sheetBaseName(named);
    return true;
  };
  /* 사본 저장 마무리 — 원본에 못 쓴 경우다. 어디에 무엇이 생겼는지와 원본을 고치는 방법을 같이 말한다.
     "저장했어요" 로 뭉뚱그리면 원본을 고친 줄 알고 사본만 쌓인다. */
  const saveBytesAsCopy = async (out) => {
    const savedPath = await saveBytesToSaveRoot(out);
    if (!savedPath) return false;
    await markSpreadsheetSaved(out);
    toast("사본으로 저장했어요: " + savedPath + " · 원본을 직접 고치려면 '열기 → 폴더 열기'로 여세요", 5200);
    return true;
  };

  // Ctrl+S 빠른 저장: 원본에 쓸 수 있으면 덮어쓰고, 아니면 사본 → 그것도 안 되면 서식 유지 XLSX 다운로드.
  let quickSaving = false;
  const quickSave = async () => {
    if (quickSaving) return;
    quickSaving = true;
    try {
      const out = (imageProtectedWorkbook && !anyDirty && !csvFastAoa) ? bytes : await exportExBytes();
      if (!out){ toast("저장 준비에 실패했어요.", 2400, { type: "error" }); return; }
      // 새로 만든 표의 첫 저장 — 아래 두 경로에는 저장 대화상자가 없으므로 파일 이름을 먼저 받는다(.py 저장과 동일).
      if (!(await askSpreadsheetScratchName())) return;
      const direct = await saveBytesToDocumentHandle(out);
      if (await finishDirectSpreadsheetSave(out, direct)) return;
      if (await saveBytesAsCopy(out)) return;
      downloadSpreadsheetFile(out, base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await markSpreadsheetSaved(out);
      // 원본에도 자동 저장 폴더에도 못 썼을 때만 여기 온다. "저장했어요" 로 뭉뚱그리면 원본이 바뀐 줄 알고
      // 다음에 그 파일을 열었을 때 편집이 사라진 것처럼 보인다 — 사본이 어디로 갔는지 분명히 말한다.
      toast("파일에 바로 쓸 수 없어 다운로드 폴더에 XLSX로 저장했어요. 원본 파일에 바로 저장하려면 '열기 → 폴더 열기'로 여세요.",
        5200, { type: "warning" });
    } catch(e){ console.error(e); toast("저장하지 못했어요.", 2400, { type: "error" }); }
    finally { quickSaving = false; }
  };

  // ----- 현재 시트 인쇄 / PDF 저장: 숨은 iframe에 표만 담아 인쇄(앱 UI 제외, 셀 서식 유지) -----
  const printCurrentSheet = () => {
    let tableEl = null;
    if (exModels[currentSheet]){
      maybeRecalc(currentSheet);
      tableEl = tableFromModel(spreadsheetDataModel(exModels[currentSheet]), false);   // 병합·인라인 서식 포함 읽기 전용 표
    } else if (wb.Sheets[currentSheet]){
      const tmp = document.createElement("div");
      tmp.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[currentSheet], { editable: false });
      tableEl = tmp.querySelector("table");
    }
    if (!tableEl){ toast("인쇄할 내용이 없어요.", 1800); return; }
    const view=viewFor(currentSheet),printRange=view.printArea?decodeSpreadsheetMerge(view.printArea):null;
    tableEl.querySelectorAll("td[data-mrow]").forEach(cell=>{
      const r=Number(cell.dataset.mrow),c=Number(cell.dataset.mcol);
      if((view.hiddenRows || []).includes(r) || (view.hiddenCols || []).includes(c)
        || (printRange && (r<printRange.s.r || r>printRange.e.r || c<printRange.s.c || c>printRange.e.c)))cell.remove();
    });
    [...tableEl.rows].forEach(row=>{if(!row.cells.length)row.remove();});
    if(view.repeatHeader && tableEl.rows.length){
      const first=tableEl.rows[0];
      if(first.querySelector('td[data-mrow="0"]'))tableEl.createTHead().appendChild(first);
    }
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(iframe);
    const esc = (s) => String(s).replace(/[<>&]/g, ch => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[ch]));
    const idoc = iframe.contentDocument;
    idoc.open();
    idoc.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>" + esc(base + " - " + currentSheet) + "</title><style>"
      + "body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#111;margin:0}"
      + "h1{font-size:13pt;margin:0 0 5mm}"
      + "table{border-collapse:collapse;font-size:10pt}"
      + "td,th{border:1px solid #999;padding:3px 6px;vertical-align:middle;word-break:break-word}"
      + "@page{margin:12mm;size:A4 " + (view.orientation==="landscape"?"landscape":"portrait") + "}"
      + "thead{display:table-header-group}tr{break-inside:avoid}"
      + (view.fitWidth?"table{width:100%;table-layout:fixed}td,th{overflow-wrap:anywhere}":"")
      + "</style></head><body></body></html>");
    idoc.close();
    const h = idoc.createElement("h1");
    h.textContent = base + " · " + currentSheet;
    idoc.body.appendChild(h);
    idoc.body.appendChild(idoc.importNode(tableEl, true));
    const cleanup = () => setTimeout(() => { if (iframe.isConnected) iframe.remove(); }, 400);
    try { iframe.contentWindow.addEventListener("afterprint", cleanup); } catch(_){}
    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
      catch(e){ console.error(e); toast("인쇄 창을 열지 못했어요.", 2200); iframe.remove(); }
    }, 50);
    setTimeout(() => { if (iframe.isConnected) iframe.remove(); }, 120000);   // 인쇄 다이얼로그가 오래 열려도 결국 정리
  };

  let editToolMenus = [];
  let editContextActions = [];
  let editContextColumn = -1;
  let editContextMenu = null;
  let editContextLayers = [];      // 열려 있는 메뉴 층 [최상위, 하위, …] — 바깥 클릭 판정은 전부를 본다
  let editContextSubTimer = null;
  let editContextOutside = null;
  let editContextKeydown = null;
  const closeEditToolMenus = (except=null) => {
    editToolMenus.forEach(menu => { if (menu !== except) menu.open = false; });
  };
  // <details> 는 바깥 클릭으로 닫히지 않으므로, 메뉴가 열린 동안만 문서 레벨 리스너로 닫아 준다.
  let editToolOutside = null;
  let editToolEscape = null;
  const detachEditToolClosers = () => {
    if (editToolOutside){ document.removeEventListener("pointerdown", editToolOutside, true); editToolOutside = null; }
    if (editToolEscape){ document.removeEventListener("keydown", editToolEscape, true); editToolEscape = null; }
  };
  const attachEditToolClosers = () => {
    if (editToolOutside) return;
    editToolOutside = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".xlsx-tool-menu")) closeEditToolMenus();
    };
    editToolEscape = (event) => {
      if (event.key === "Escape"){ closeEditToolMenus(); event.stopPropagation(); }
    };
    document.addEventListener("pointerdown", editToolOutside, true);
    document.addEventListener("keydown", editToolEscape, true);
  };
  // ----- 우클릭 메뉴 -----
  // 항목이 많아졌으므로 같은 갈래는 하위 메뉴(▸)로 접어 오른쪽으로 펼친다.
  // 하위 메뉴는 부모 안에 넣지 않고 body 에 따로 띄운다 — 부모에는 세로 스크롤(max-height)이 걸려 있어
  // 자식으로 붙이면 같이 잘리기 때문. 대신 '바깥 클릭' 판정은 열린 층 전부를 검사해야 한다.
  const cancelEditContextSubClose = () => {
    if (editContextSubTimer){ clearTimeout(editContextSubTimer); editContextSubTimer = null; }
  };
  const closeEditContextLayers = (depth) => {
    while (editContextLayers.length > depth){
      const layer = editContextLayers.pop();
      if (layer.__parentButton) layer.__parentButton.classList.remove("is-open");
      layer.remove();
    }
  };
  const closeEditContextMenu = () => {
    cancelEditContextSubClose();
    closeEditContextLayers(0);
    editContextMenu = null;
    if (editContextOutside){ document.removeEventListener("pointerdown", editContextOutside, true); editContextOutside = null; }
    if (editContextKeydown){ document.removeEventListener("keydown", editContextKeydown, true); editContextKeydown = null; }
  };
  if (doc) doc.cleanupFns.push(closeEditContextMenu);
  // 하위 메뉴는 부모 항목 오른쪽에 붙이되, 화면 오른쪽을 넘으면 왼쪽으로 뒤집는다(도구막대 칩과 같은 규칙).
  const placeEditContextSub = (menu, button) => {
    const br = button.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight, margin = 6;
    let left = br.right - 4;
    if (left + mw > window.innerWidth - margin) left = br.left - mw + 4;
    if (left < margin) left = margin;
    let top = br.top - 5;
    if (top + mh > window.innerHeight - margin) top = window.innerHeight - margin - mh;
    if (top < margin) top = margin;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  };
  const renderEditContextLayer = (actions, depth) => {
    const menu = document.createElement("div");
    menu.className = depth ? "xlsx-context-menu xlsx-context-sub" : "xlsx-context-menu";
    menu.setAttribute("role", "menu");
    menu.addEventListener("pointerenter", cancelEditContextSubClose);
    actions.forEach(item => {
      if (item.separator){
        const sep = document.createElement("div"); sep.className = "xlsx-context-sep"; menu.appendChild(sep); return;
      }
      const button = document.createElement("button");
      button.type = "button";
      if (item.swatch){                                   // 색 항목: 왼쪽에 색 조각을 붙인다
        button.className = "xlsx-context-swatch-btn";
        const chip = document.createElement("span");
        chip.className = "xlsx-context-swatch";
        chip.style.background = item.swatch;
        button.append(chip, document.createTextNode(item.label));
      } else {
        button.textContent = item.label;
      }
      if (item.title) button.title = item.title;
      button.disabled = typeof item.disabled === "function" ? !!item.disabled() : !!item.disabled;
      const kids = item.children;
      if (kids && kids.length){
        button.classList.add("xlsx-context-parent");
        const openKids = () => {
          if (button.disabled) return;
          const opened = editContextLayers[depth + 1];
          if (opened && opened.__parentButton === button) return;   // 이미 이 항목의 하위 메뉴가 열려 있음
          closeEditContextLayers(depth + 1);
          const sub = renderEditContextLayer(kids, depth + 1);
          sub.__parentButton = button;
          document.body.appendChild(sub);
          editContextLayers.push(sub);
          button.classList.add("is-open");
          placeEditContextSub(sub, button);
        };
        button.addEventListener("pointerenter", () => { cancelEditContextSubClose(); openKids(); });
        button.addEventListener("click", () => { cancelEditContextSubClose(); openKids(); });
      } else {
        button.addEventListener("pointerenter", () => {
          // 열린 하위 메뉴로 대각선으로 건너가는 중일 수 있어, 형제 항목을 스쳐도 바로 닫지 않는다.
          if (editContextLayers.length <= depth + 1) return;
          cancelEditContextSubClose();
          editContextSubTimer = setTimeout(() => closeEditContextLayers(depth + 1), 220);
        });
        button.addEventListener("click", () => {
          closeEditContextMenu();
          if (!button.disabled && typeof item.action === "function") item.action();
        });
      }
      menu.appendChild(button);
    });
    return menu;
  };
  const openEditContextMenu = (x, y, actions = editContextActions) => {
    closeEditContextMenu();
    const menu = renderEditContextLayer(actions, 0);
    document.body.appendChild(menu);
    editContextLayers.push(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(window.innerWidth - rect.width - 6, x)) + "px";
    menu.style.top = Math.max(6, Math.min(window.innerHeight - rect.height - 6, y)) + "px";
    editContextMenu = menu;
    editContextOutside = (event) => {
      if (!editContextLayers.some(layer => layer.contains(event.target))) closeEditContextMenu();
    };
    editContextKeydown = (event) => {
      if (event.key !== "Escape") return;
      if (editContextLayers.length > 1) closeEditContextLayers(editContextLayers.length - 1);   // 하위 메뉴만 닫기
      else closeEditContextMenu();
    };
    setTimeout(() => {
      if (!editContextMenu) return;
      document.addEventListener("pointerdown", editContextOutside, true);
      document.addEventListener("keydown", editContextKeydown, true);
    }, 0);
  };
  // 팔레트의 "다른 색…" — 임시 색 고르개를 띄운다(도구막대 색 칸과 섞이지 않게 매번 새로 만들고 버린다).
  const pickCustomColor = (initial, apply) => {
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = /^#[0-9a-f]{6}$/i.test(String(initial || "")) ? initial : "#000000";
    picker.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(picker);
    picker.addEventListener("change", () => { apply(picker.value); picker.remove(); });
    picker.addEventListener("blur", () => setTimeout(() => picker.remove(), 400));   // 취소해도 남지 않게
    picker.click();
  };
  sheet.addEventListener("contextmenu", (event) => {
    if (!editMode) return;
    const target = event.target && event.target.closest
      ? event.target.closest("td[data-mrow],.sheet-row-head,.sheet-col-head")
      : null;
    if (!target || !sheet.contains(target)) return;
    event.preventDefault();
    closeEditToolMenus();
    if (!target.classList.contains("sheet-selected") && typeof sheet._selectSpreadsheetElement === "function"){
      sheet._selectSpreadsheetElement(target);
    }
    editContextColumn = Number(target.dataset.mcol != null ? target.dataset.mcol : target.dataset.col);
    if (!Number.isInteger(editContextColumn)) editContextColumn = -1;
    openEditContextMenu(event.clientX, event.clientY);
  });
  sheet.addEventListener("pointerdown", () => {
    closeEditToolMenus();
    closeEditContextMenu();
    closeColFilterMenu();
  });
  // 시트 탭 우클릭 → 시트 관리 메뉴(편집 모드). 읽기 전용에서는 안내만.
  tabs.addEventListener("contextmenu", (event) => {
    const tab = event.target && event.target.closest ? event.target.closest(".xlsx-tab") : null;
    if (!tab || tab.classList.contains("xlsx-tab-add")) return;
    event.preventDefault();
    if (!editMode){ toast("시트 추가·삭제는 '표 편집·정렬' 모드에서 할 수 있어요.", 2200); return; }
    const name = tab.textContent;
    closeEditToolMenus();
    if (name !== currentSheet){ currentSheet = name; rerender(); }   // 우클릭한 시트를 먼저 선택(엑셀과 동일)
    openEditContextMenu(event.clientX, event.clientY, [
      { label: "＋ 새 시트", action: () => addNewSheet() },
      { label: "⧉ 시트 복제", action: () => addNewSheet(name) },
      { label: "이름 바꾸기", action: () => renameSheetPrompt(name) },
      { separator: true },
      { label: "시트 삭제", action: () => deleteCurrentSheet(), disabled: () => wb.SheetNames.length <= 1 }
    ]);
  });

  // ===== 편집 도구막대: 자주 쓰는 기능은 2줄에 유지하고, 세부 기능은 드롭다운·우클릭으로 제공 =====
  const buildEditBar = () => {
    editState.headerFrozen=viewFor(currentSheet).header;
    headerFrozenChk.checked=editState.headerFrozen;
    editBar.innerHTML = "";
    editToolMenus = [];
    closeEditContextMenu();
    const model = exModels[currentSheet] || [[blankCell()]];
    const cols = model.length ? model[0].length : 1;

    const filterInput = document.createElement("input");
    filterInput.type = "search"; filterInput.className = "xlsx-filter"; filterInput.placeholder = "행 필터(포함 텍스트)";
    filterInput.value = editState.filter;
    filterInput.addEventListener("input", () => { editState.filter = filterInput.value; renderEditable(currentSheet); });

    const sortSel = document.createElement("select"); sortSel.className = "xlsx-sortcol";
    for (let c = 0; c < cols; c++){ const o = document.createElement("option"); o.value = String(c); o.textContent = spreadsheetColumnName(c) + "열"; sortSel.appendChild(o); }
    if (editState.sortCol >= 0 && editState.sortCol < cols) sortSel.value = String(editState.sortCol);
    const doSort = (dir, levels=null) => {
      if ((exMerges[currentSheet] || []).length){
        toast("병합 셀이 있는 시트는 병합을 유지하기 위해 정렬하지 않았어요.", 2600);
        return;
      }
      pushUndo(currentSheet);
      const col = Number(sortSel.value); editState.sortCol = col; editState.sortDir = dir;
      const head = editState.headerFrozen ? 1 : 0;
      const dataRows=spreadsheetWorkspaceBounds(model).rows;
      const tagged=spreadsheetTools.stableSort(model.slice(head,dataRows),levels || [{col,dir}])
        .map(item=>({row:item.row,old:head+item.index}));
      const oldToNew = new Map();
      tagged.forEach((t, i) => oldToNew.set(t.old, head + i));
      model.splice(head, dataRows - head, ...tagged.map(t => t.row));
      const lastRow = dataRows - 1;
      remapModelFormulas(currentSheet, (c, r, abs) =>
        (!abs.rowAbs && r >= head && r <= lastRow && oldToNew.has(r)) ? { c, r: oldToNew.get(r) } : { c, r });
      structChanged.add(currentSheet); anyDirty = true;
      renderEditable(currentSheet);
    };
    const ascBtn = document.createElement("button"); ascBtn.type = "button"; ascBtn.textContent = "▲ 오름"; ascBtn.title = "선택 열 오름차순 정렬"; ascBtn.onclick = () => doSort(1);
    const descBtn = document.createElement("button"); descBtn.type = "button"; descBtn.textContent = "▼ 내림"; descBtn.title = "선택 열 내림차순 정렬"; descBtn.onclick = () => doSort(-1);

    const addRowBtn = document.createElement("button"); addRowBtn.type = "button"; addRowBtn.textContent = "+ 행"; addRowBtn.title = "선택 행 위에 빈 행 추가(선택이 없으면 맨 아래)";
    addRowBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mrow]');
      const selectedRows = [...marked].map(td => Number(td.dataset.mrow)).filter(Number.isInteger);
      const at = selectedRows.length ? Math.min(...selectedRows) : model.length;
      pushUndo(currentSheet);
      model.splice(at, 0, Array.from({ length:model[0] ? model[0].length : 1 }, blankCell));
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterRowInsert(exMerges[currentSheet], at);
      remapWorkbookStructure(currentSheet, {axis:"r",at});   // 삽입 지점 이하 참조 +1
      structChanged.add(currentSheet); anyDirty = true;
      renderEditable(currentSheet);
      toast(selectedRows.length ? "선택 행 위에 빈 행을 추가했어요." : "맨 아래에 빈 행을 추가했어요.", 1600);
    };
    const addColBtn = document.createElement("button"); addColBtn.type = "button"; addColBtn.textContent = "+ 열"; addColBtn.title = "선택 열 왼쪽에 빈 열 추가(선택이 없으면 맨 오른쪽)";
    addColBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mcol]');
      const selectedCols = [...marked].map(td => Number(td.dataset.mcol)).filter(Number.isInteger);
      const at = selectedCols.length ? Math.min(...selectedCols) : (model[0] ? model[0].length : 0);
      pushUndo(currentSheet);
      model.forEach((row, index) => { model[index] = [...row.slice(0, at), blankCell(), ...row.slice(at)]; });
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterColumnInsert(exMerges[currentSheet], at);
      remapWorkbookStructure(currentSheet, {axis:"c",at});   // 삽입 지점 이후 열참조 +1
      delete colFiltersBySheet[currentSheet];   // 열 인덱스가 밀려 필터가 어긋나므로 초기화
      structChanged.add(currentSheet); anyDirty = true;
      buildEditBar(); renderEditable(currentSheet);
      toast(selectedCols.length ? "선택 열 왼쪽에 빈 열을 추가했어요." : "맨 오른쪽에 빈 열을 추가했어요.", 1600);
    };
    const delRowBtn = document.createElement("button"); delRowBtn.type = "button"; delRowBtn.textContent = "− 선택행"; delRowBtn.title = "현재 선택한 행 삭제";
    delRowBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mrow]');
      const rows = [...new Set([...marked].map(td => Number(td.dataset.mrow)))].sort((a, b) => b - a);
      if (!rows.length){ toast("삭제할 행을 먼저 선택하세요(행 머리글 클릭).", 2200); return; }
      pushUndo(currentSheet);
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterRowDelete(exMerges[currentSheet], rows);
      remapWorkbookStructure(currentSheet, {axis:"r",deleted:rows});
      rows.forEach(r => model.splice(r, 1));
      if (!model.length) model.push(Array.from({ length: cols }, blankCell));
      structChanged.add(currentSheet); anyDirty = true;
      renderEditable(currentSheet);
      toast(rows.length + "개 행을 삭제했어요.", 1600);
    };
    const delColBtn = document.createElement("button"); delColBtn.type = "button"; delColBtn.textContent = "− 선택열"; delColBtn.title = "현재 선택한 열 삭제";
    delColBtn.onclick = () => {
      const marked = sheet.querySelectorAll('td.sheet-selected[data-mcol]');
      const colsSel = [...new Set([...marked].map(td => Number(td.dataset.mcol)))].sort((a, b) => b - a);
      if (!colsSel.length){ toast("삭제할 열을 먼저 선택하세요(열 머리글 클릭).", 2200); return; }
      pushUndo(currentSheet);
      exMerges[currentSheet] = adjustSpreadsheetMergesAfterColumnDelete(exMerges[currentSheet], colsSel);
      remapWorkbookStructure(currentSheet, {axis:"c",deleted:colsSel});
      model.forEach(row => colsSel.forEach(c => row.splice(c, 1)));   // 내림차순 → 큰 인덱스부터 안전 삭제
      if (model[0] && !model[0].length) model.forEach(row => row.push(blankCell()));
      delete colFiltersBySheet[currentSheet];   // 열 인덱스가 밀려 필터가 어긋나므로 초기화
      structChanged.add(currentSheet); anyDirty = true;
      buildEditBar(); renderEditable(currentSheet);
      toast(colsSel.length + "개 열을 삭제했어요.", 1600);
    };
    const mergeBtn = document.createElement("button"); mergeBtn.type = "button"; mergeBtn.textContent = "⊞ 병합"; mergeBtn.title = "선택 범위를 하나로 병합(좌상단 값만 유지)";
    mergeBtn.onclick = () => mergeSelection();
    const unmergeBtn = document.createElement("button"); unmergeBtn.type = "button"; unmergeBtn.textContent = "⊟ 병합해제"; unmergeBtn.title = "선택 범위의 병합을 해제";
    unmergeBtn.onclick = () => unmergeSelection();

    // 되돌리기 / 다시실행
    undoBtn = document.createElement("button"); undoBtn.type = "button"; undoBtn.textContent = "↶"; undoBtn.title = "되돌리기 (Ctrl+Z)";
    undoBtn.onclick = () => doUndo();
    redoBtn = document.createElement("button"); redoBtn.type = "button"; redoBtn.textContent = "↷"; redoBtn.title = "다시실행 (Ctrl+Y)";
    redoBtn.onclick = () => doRedo();

    // ----- 글꼴: 굵게·기울임·밑줄 · 글자색 · 크기 · 글꼴 -----
    const mkFmtBtn = (text, title, onClick, extraClass) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.title = title;
      if (extraClass) b.className = extraClass;
      b.onclick = onClick; return b;
    };
    const boldBtn = mkFmtBtn("B", "굵게 (선택 셀)", () => toggleFontProp("bold", "굵게"), "xlsx-fmt-btn xlsx-fmt-bold");
    const italicBtn = mkFmtBtn("I", "기울임 (선택 셀)", () => toggleFontProp("italic", "기울임"), "xlsx-fmt-btn xlsx-fmt-italic");
    const underlineBtn = mkFmtBtn(
      "U", "밑줄 (선택 셀)", () => toggleFontProp("underline", "밑줄"), "xlsx-fmt-btn xlsx-fmt-underline"
    );
    const fontColorWrap = document.createElement("label");
    fontColorWrap.className = "xlsx-frozen";
    fontColorWrap.title = "선택 셀 글자 색";
    const fontColor = document.createElement("input");
    fontColor.type = "color";
    fontColor.className = "xlsx-fmt-color";
    fontColor.value = "#1f2937";
    fontColorWrap.append(document.createTextNode("글자색 "), fontColor);
    const fontColorApplyBtn = document.createElement("button");
    fontColorApplyBtn.type = "button";
    fontColorApplyBtn.textContent = "적용";
    fontColorApplyBtn.title = "고른 글자색을 선택 셀에 적용";
    fontColorApplyBtn.onclick = () => setFontColor(fontColor.value);
    const sizeSel = document.createElement("select"); sizeSel.className = "xlsx-sortcol"; sizeSel.title = "글자 크기";
    [["", "크기"], ...[8,9,10,11,12,14,16,18,20,24,28,36].map(v => [String(v), String(v)])]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; sizeSel.appendChild(o); });
    sizeSel.addEventListener("change", () => { if (sizeSel.value) setFontSize(sizeSel.value); sizeSel.value = ""; });
    const fontSel = document.createElement("select"); fontSel.className = "xlsx-sortcol"; fontSel.title = "글꼴";
    [["", "글꼴"], ["맑은 고딕","맑은 고딕"], ["굴림","굴림"], ["돋움","돋움"], ["바탕","바탕"], ["궁서","궁서"],
     ["Arial","Arial"], ["Calibri","Calibri"], ["Times New Roman","Times New Roman"], ["Courier New","Courier New"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; fontSel.appendChild(o); });
    fontSel.addEventListener("change", () => { if (fontSel.value) setFontName(fontSel.value); fontSel.value = ""; });

    // ----- 정렬: 가로 · 세로 · 자동 줄바꿈 -----
    const alignLeftBtn = mkFmtBtn("⌫", "왼쪽 맞춤", () => setAlign("left"), "xlsx-fmt-btn");
    alignLeftBtn.textContent = "◧"; alignLeftBtn.title = "왼쪽 맞춤";
    const alignCenterBtn = mkFmtBtn("▥", "가운데 맞춤", () => setAlign("center"), "xlsx-fmt-btn");
    const alignRightBtn = mkFmtBtn("◨", "오른쪽 맞춤", () => setAlign("right"), "xlsx-fmt-btn");
    const vAlignSel = document.createElement("select"); vAlignSel.className = "xlsx-sortcol"; vAlignSel.title = "세로 맞춤";
    [["", "세로맞춤"], ["top","위"], ["middle","가운데"], ["bottom","아래"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; vAlignSel.appendChild(o); });
    vAlignSel.addEventListener("change", () => { setVAlign(vAlignSel.value); });
    const wrapBtn = mkFmtBtn("↵ 줄바꿈", "자동 줄바꿈 켜기/끄기", () => toggleWrap(), "xlsx-fmt-btn");

    // ----- 표시형식(번호서식) -----
    const numSel = document.createElement("select"); numSel.className = "xlsx-sortcol"; numSel.title = "표시형식(숫자·통화·백분율·날짜)";
    [["", "표시형식"], ["__general","일반"], ["#,##0","1,234 (천단위)"], ["#,##0.00","1,234.00 (소수2)"],
     ["₩#,##0","₩ 통화"], ["$#,##0.00","$ 통화"], ["0%","백분율 0%"], ["0.00%","백분율 0.00%"],
     ["0.00","소수 2자리"], ["yyyy-mm-dd","날짜 2026-07-05"], ["yyyy-mm-dd hh:mm","날짜+시각"], ["@","텍스트"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; numSel.appendChild(o); });
    numSel.addEventListener("change", () => {
      if (!numSel.value) return;
      setNumberFormat(numSel.value === "__general" ? "" : numSel.value);
      numSel.value = "";
    });

    // ----- 채우기 · 테두리 -----
    const fillWrap = document.createElement("label"); fillWrap.className = "xlsx-frozen"; fillWrap.title = "선택 셀 채우기 색";
    const fillColor = document.createElement("input"); fillColor.type = "color"; fillColor.className = "xlsx-fmt-color"; fillColor.value = "#fde68a";
    fillWrap.append(document.createTextNode("채우기 "), fillColor);
    const fillBtn = document.createElement("button"); fillBtn.type = "button"; fillBtn.textContent = "채우기 적용"; fillBtn.title = "선택 셀에 채우기 색 적용";
    fillBtn.onclick = () => setSelectionFill(fillColor.value);

    const borderWrap = document.createElement("label"); borderWrap.className = "xlsx-frozen"; borderWrap.title = "선택 셀 테두리 색";
    const borderColor = document.createElement("input"); borderColor.type = "color"; borderColor.className = "xlsx-fmt-color"; borderColor.value = "#475569";
    borderWrap.append(document.createTextNode("테두리 "), borderColor);
    const borderStyleSel = document.createElement("select"); borderStyleSel.className = "xlsx-sortcol"; borderStyleSel.title = "테두리 굵기·모양";
    [["thin","얇게"], ["medium","중간"], ["thick","굵게"], ["dashed","점선"], ["double","이중선"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; borderStyleSel.appendChild(o); });
    const borderWhereSel = document.createElement("select"); borderWhereSel.className = "xlsx-sortcol"; borderWhereSel.title = "테두리 위치";
    [["all","전체"], ["outline","바깥쪽"], ["inside","내부"], ["inside-h","안쪽 가로"], ["inside-v","안쪽 세로"], ["bottom","아래"], ["top","위"], ["left","왼쪽"], ["right","오른쪽"], ["none","지우기"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; borderWhereSel.appendChild(o); });
    const borderBtn = document.createElement("button"); borderBtn.type = "button"; borderBtn.textContent = "테두리 적용"; borderBtn.title = "선택 셀에 테두리 적용";
    borderBtn.onclick = () => setSelectionBorder(borderColor.value, borderStyleSel.value, borderWhereSel.value);
    const clearFmtBtn = document.createElement("button"); clearFmtBtn.type = "button"; clearFmtBtn.textContent = "서식 지우기"; clearFmtBtn.title = "선택 셀의 글꼴·정렬·표시형식·채우기·테두리 모두 제거";
    clearFmtBtn.onclick = () => clearSelectionFormat();

    // ----- 서식 복사 붓 -----
    const copyFmtBtn = document.createElement("button"); copyFmtBtn.type = "button"; copyFmtBtn.textContent = "🖌 서식 복사"; copyFmtBtn.title = "선택 셀의 서식을 복사";
    copyFmtBtn.onclick = () => copyCellFormat();
    const pasteFmtBtn = document.createElement("button"); pasteFmtBtn.type = "button"; pasteFmtBtn.textContent = "서식 붙이기"; pasteFmtBtn.title = "복사한 서식을 선택 셀에 적용";
    pasteFmtBtn.onclick = () => pasteCellFormat();

    // ----- 찾기·바꿈 -----
    const findInput = document.createElement("input"); findInput.type = "search"; findInput.className = "xlsx-sortcol xlsx-find-input"; findInput.placeholder = "찾을 내용";
    const replInput = document.createElement("input"); replInput.type = "search"; replInput.className = "xlsx-sortcol xlsx-find-input"; replInput.placeholder = "바꿀 내용";
    const replaceBtn = document.createElement("button"); replaceBtn.type = "button"; replaceBtn.textContent = "모두 바꾸기"; replaceBtn.title = "현재 시트(선택이 있으면 선택 범위)에서 모두 바꾸기 · 대소문자 무시";
    replaceBtn.onclick = () => { rememberSheetFind(); replaceAllInSheet(findInput.value, replInput.value); };
    replInput.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); rememberSheetFind(); replaceAllInSheet(findInput.value, replInput.value); } e.stopPropagation(); });
    findInput.addEventListener("keydown", (e) => e.stopPropagation());

    // ----- 조건부 강조 -----
    const condSel = document.createElement("select"); condSel.className = "xlsx-sortcol"; condSel.title = "조건";
    [["ge","≥ 이상"], ["gt","> 초과"], ["le","≤ 이하"], ["lt","< 미만"], ["eq","= 같음"], ["ne","≠ 다름"], ["contains","포함(텍스트)"]]
      .forEach(([val, label]) => { const o = document.createElement("option"); o.value = val; o.textContent = label; condSel.appendChild(o); });
    const condVal = document.createElement("input"); condVal.type = "text"; condVal.className = "xlsx-sortcol xlsx-cond-val"; condVal.placeholder = "값"; condVal.title = "기준 값(예: 60)";
    const condColor = document.createElement("input"); condColor.type = "color"; condColor.className = "xlsx-fmt-color"; condColor.value = "#fecaca";
    const condBtn = document.createElement("button"); condBtn.type = "button"; condBtn.textContent = "강조"; condBtn.title = "선택 범위에서 조건에 맞는 셀만 채우기 색 적용";
    condBtn.onclick = () => highlightByCondition(condSel.value, condVal.value, condColor.value);
    condVal.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); highlightByCondition(condSel.value, condVal.value, condColor.value); } e.stopPropagation(); });

    // ----- 데이터 유효성(목록 드롭다운) -----
    const dvInput = document.createElement("input"); dvInput.type = "text"; dvInput.className = "xlsx-sortcol xlsx-dv-input";
    dvInput.placeholder = "목록 값(쉼표로 구분)"; dvInput.title = "예: 완료,진행,보류 — 선택 셀을 편집하면 이 목록이 드롭다운으로 뜹니다";
    const dvApplyBtn = document.createElement("button"); dvApplyBtn.type = "button"; dvApplyBtn.textContent = "드롭다운 적용"; dvApplyBtn.title = "선택 범위 셀에 목록 드롭다운 걸기(엑셀에서도 유지)";
    dvApplyBtn.onclick = () => setDataValidation(parseDvValues(dvInput.value));
    const dvRemoveBtn = document.createElement("button"); dvRemoveBtn.type = "button"; dvRemoveBtn.textContent = "제거"; dvRemoveBtn.title = "선택 범위의 드롭다운 유효성 제거";
    dvRemoveBtn.onclick = () => removeDataValidation();
    dvInput.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); setDataValidation(parseDvValues(dvInput.value)); } e.stopPropagation(); });

    // ----- 조건부 서식(라이브 규칙) -----
    const cfKind = document.createElement("select"); cfKind.className = "xlsx-sortcol"; cfKind.title = "규칙 종류";
    [["highlight","셀 강조"], ["databar","데이터 막대"], ["colorscale","색조(2색)"]]
      .forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; cfKind.appendChild(o); });
    const cfOp = document.createElement("select"); cfOp.className = "xlsx-sortcol"; cfOp.title = "조건";
    [["ge","≥ 이상"], ["gt","> 초과"], ["le","≤ 이하"], ["lt","< 미만"], ["eq","= 같음"], ["ne","≠ 다름"], ["between","사이"], ["contains","포함(텍스트)"], ["notcontains","미포함(텍스트)"]]
      .forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; cfOp.appendChild(o); });
    const cfVal = document.createElement("input"); cfVal.type = "text"; cfVal.className = "xlsx-sortcol xlsx-cond-val"; cfVal.placeholder = "값"; cfVal.title = "기준 값";
    const cfVal2 = document.createElement("input"); cfVal2.type = "text"; cfVal2.className = "xlsx-sortcol xlsx-cond-val"; cfVal2.placeholder = "~ 값2"; cfVal2.title = "사이 조건의 두 번째 값"; cfVal2.style.display = "none";
    const cfColor2 = document.createElement("input"); cfColor2.type = "color"; cfColor2.className = "xlsx-fmt-color"; cfColor2.value = "#ffffff"; cfColor2.title = "낮은 값 색(색조)"; cfColor2.style.display = "none";
    const cfColor = document.createElement("input"); cfColor.type = "color"; cfColor.className = "xlsx-fmt-color"; cfColor.value = "#fde68a"; cfColor.title = "강조/막대/높은 값 색";
    const cfAddBtn = document.createElement("button"); cfAddBtn.type = "button"; cfAddBtn.textContent = "규칙 추가"; cfAddBtn.title = "선택 범위에 라이브 규칙 추가(값이 바뀌면 자동 반영·저장 시 엑셀 조건부 서식으로)";
    const cfManageBtn = document.createElement("button"); cfManageBtn.type = "button"; cfManageBtn.textContent = "규칙 관리"; cfManageBtn.title = "이 시트의 조건부 서식 규칙 목록·삭제";
    const syncCfUi = () => {
      const k = cfKind.value;
      const showHi = k === "highlight";
      cfOp.style.display = showHi ? "" : "none";
      cfVal.style.display = showHi ? "" : "none";
      cfVal2.style.display = (showHi && cfOp.value === "between") ? "" : "none";
      cfColor2.style.display = (k === "colorscale") ? "" : "none";
      cfColor.title = k === "colorscale" ? "높은 값 색" : (k === "databar" ? "막대 색" : "강조 채우기 색");
    };
    cfKind.addEventListener("change", syncCfUi);
    cfOp.addEventListener("change", syncCfUi);
    syncCfUi();
    const submitCondRule = () => {
      const k = cfKind.value;
      if (k === "highlight") addCondRule({ kind:"highlight", op:cfOp.value, value:cfVal.value, value2:cfVal2.value, fill:cfColor.value });
      else if (k === "databar") addCondRule({ kind:"databar", barColor:cfColor.value });
      else addCondRule({ kind:"colorscale", minColor:cfColor2.value, maxColor:cfColor.value });
    };
    cfAddBtn.onclick = submitCondRule;
    cfManageBtn.onclick = () => openCondManager();
    cfVal.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); submitCondRule(); } e.stopPropagation(); });
    cfVal2.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); submitCondRule(); } e.stopPropagation(); });

    /* [XLSX 저장] — Ctrl+S 와 완전히 같은 순서를 지난다(원본 핸들 → 자동 저장 폴더 사본 → 다운로드).
       예전에는 이 버튼만 다운로드로 바로 갔다. CSV 에서 변환한 표만 핸들 갈래를 거치고, 폴더로 열어
       원본에 쓸 수 있는 xlsx 조차 사본을 내려받은 뒤 "저장했어요" 라고 알려 탭의 수정 표시까지 지웠다.
       그래서 다음에 그 파일을 열면 편집이 사라진 것처럼 보였다 — 저장 입구는 quickSave 하나로 모은다.
       원본을 건드리지 않고 사본만 받고 싶으면 옆의 [복사본 내려받기] 를 쓴다. */
    const xlsxBtn = document.createElement("button"); xlsxBtn.type = "button"; xlsxBtn.textContent = "XLSX 저장";
    xlsxBtn.className = "xlsx-save-inplace";   // 저장 메뉴의 기본 동작임을 색으로 드러낸다
    xlsxBtn.title = "편집 내용을 원본 파일에 저장합니다(서식 유지 · Ctrl+S와 같음). "
      + "원본에 쓸 수 없으면 자동 저장 폴더에 사본으로, 그것도 안 되면 다운로드로 저장하고 어느 쪽인지 알려 줍니다.";
    xlsxBtn.onclick = async () => {
      xlsxBtn.disabled = true;
      try { await quickSave(); }
      finally { xlsxBtn.disabled = false; }
    };
    /* [복사본 내려받기] — 원본은 그대로 두고 서식 유지 XLSX 를 내려받는 '내보내기'.
       원본을 바꾼 게 아니므로 수정 표시(dirty)는 일부러 지우지 않는다. */
    const xlsxCopyBtn = document.createElement("button"); xlsxCopyBtn.type = "button"; xlsxCopyBtn.textContent = "복사본 내려받기";
    xlsxCopyBtn.title = "원본 파일은 그대로 두고, 서식(번호서식·색·글꼴·병합)을 유지한 XLSX 사본을 다운로드 폴더로 내려받습니다.";
    xlsxCopyBtn.onclick = async () => {
      xlsxCopyBtn.disabled = true;
      try {
        const out = await exportExBytes();
        if (!out){ toast("내보내기 준비에 실패했어요.", 2400, { type: "error" }); return; }
        downloadSpreadsheetFile(out, base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        toast("XLSX 사본을 내려받았어요(원본은 그대로예요).", 2400, { type: "success" });
      } catch(e){ console.error(e); toast("내보내지 못했어요.", 2400, { type: "error" }); }
      finally { xlsxCopyBtn.disabled = false; }
    };
    const csvBtn2 = document.createElement("button"); csvBtn2.type = "button"; csvBtn2.textContent = "CSV 저장"; csvBtn2.title = "현재 시트를 CSV로 저장(서식 없음)";
    csvBtn2.onclick = () => {
      const csv = "﻿" + modelToCsv(exModels[currentSheet] || []);
      downloadSpreadsheetFile(csv, base + "_" + sanitizeFilePart(currentSheet) + ".csv", "text/csv;charset=utf-8");
      toast("현재 시트를 CSV로 저장했어요.", 1800, { type: "success" });
    };

    const makeGroup = (name, className, ...nodes) => {
      const group = document.createElement("div");
      group.className = "xlsx-editgroup " + className;
      if (name){
        const label = document.createElement("span"); label.className = "xlsx-editgroup-label"; label.textContent = name;
        group.append(label);
      }
      group.append(...nodes);
      return group;
    };
    // 도구막대 메뉴 패널: 칩 기준 오른쪽으로 펼치되, 화면 오른쪽/왼쪽을 넘으면 안쪽으로 밀어 넣는다.
    // (줄바꿈으로 칩 위치가 창 폭에 따라 달라져도 항상 화면 안에 보이게 — 고정 left/right 로는 안 맞음)
    const clampToolMenuPanel = (details, panel) => {
      // 화면이 좁아 패널을 position:fixed 로 펼치는 모바일 레이아웃에선 CSS 에 맡긴다.
      if (window.matchMedia && window.matchMedia("(max-width:760px)").matches){ panel.style.left = ""; panel.style.right = ""; return; }
      panel.style.right = "auto"; panel.style.left = "0px";
      const dr = details.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const margin = 8;
      // 기준 영역은 화면이 아니라 '도구막대 상자' — 오른쪽에 있는 칩은 막대 밖(빈 여백)으로 펼쳐지지 않고 왼쪽으로 펼쳐진다.
      const bar = details.closest(".xlsx-editbar");
      const bounds = bar ? bar.getBoundingClientRect() : { left: margin, right: window.innerWidth - margin };
      const rightBound = Math.min(bounds.right, window.innerWidth - margin);
      const leftBound = Math.max(bounds.left, margin);
      let leftVp = dr.left;                                    // 기본: 칩 왼쪽에 맞춰 오른쪽으로 펼침
      if (leftVp + pw > rightBound) leftVp = dr.right - pw;    // 막대 오른쪽을 넘으면 칩 오른쪽에 맞춰 왼쪽으로 펼침
      if (leftVp < leftBound) leftVp = leftBound;              // 왼쪽을 넘으면 안쪽으로
      if (leftVp + pw > window.innerWidth - margin) leftVp = window.innerWidth - margin - pw;   // 최후: 화면 오른쪽 보호
      panel.style.left = (leftVp - dr.left) + "px";
    };
    const makeMenu = (label, className, ...nodes) => {
      const details = document.createElement("details");
      details.className = "xlsx-tool-menu " + className;
      const summary = document.createElement("summary");
      summary.textContent = label;
      summary.title = label + " 메뉴";
      const panel = document.createElement("div");
      panel.className = "xlsx-tool-menu-panel";
      panel.append(...nodes);
      details.append(summary, panel);
      details.addEventListener("toggle", () => {
        if (details.open){
          closeEditToolMenus(details); attachEditToolClosers();
          clampToolMenuPanel(details, panel);   // 칩 기준 오른쪽으로 펼치되 화면 밖이면 안쪽으로 보정
        }
        else if (!editToolMenus.some(menu => menu.open)) detachEditToolClosers();
      });
      panel.addEventListener("click", (event) => {
        if (event.target.closest("button") && !event.target.closest("button").disabled) details.open = false;
      });
      editToolMenus.push(details);
      return { details, panel, summary };
    };
    const historyGroup = makeGroup("", "xlsx-editgroup-history", undoBtn, redoBtn);
    const toolButton=(label,action)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=action;return b;};
    const multiLevels=[];
    const multiControls=[];
    for(let i=0;i<3;i++){
      const col=sortSel.cloneNode(true),dir=document.createElement("select"),label=document.createElement("label");
      const empty=document.createElement("option");empty.value="";empty.textContent="선택 안 함";col.prepend(empty);col.value=i===0?sortSel.value:"";
      dir.innerHTML='<option value="1">오름차순</option><option value="-1">내림차순</option>';
      label.append(document.createTextNode((i+1)+"순위 "),col,dir);multiControls.push(label);multiLevels.push({col,dir});
    }
    const multiSort=makeMenu("다중 정렬","xlsx-tool-menu-multisort",...multiControls,toolButton("정렬 적용",()=>{
      const levels=multiLevels.filter(x=>x.col.value!=="").map(x=>({col:Number(x.col.value),dir:Number(x.dir.value)}));
      if(levels.length)doSort(1,levels);
    }));
    const dataGroup = makeGroup("", "xlsx-editgroup-data", filterInput, sortSel, ascBtn, descBtn,multiSort.details);
    const pasteMenu=makeMenu("붙여넣기","xlsx-tool-menu-paste",
      ...[["서식·수식 포함","all"],["값만","values"],["수식만","formulas"],["행·열 바꾸기(값)","transpose"]].map(([label,mode])=>toolButton(label,()=>{
        if(!richClip){toast("먼저 이 표에서 셀을 복사하세요.",2000);return;}
        if(richClip.cut && mode!=="all"){toast("선택하여 붙여넣기는 잘라내기 대신 복사한 셀에 사용하세요.",2400);return;}
        pasteRichIntoSelection(richClip,mode);
      })));
    dataGroup.appendChild(pasteMenu.details);
    const addSheetBtn = document.createElement("button"); addSheetBtn.type = "button"; addSheetBtn.textContent = "＋ 새 시트"; addSheetBtn.title = "빈 시트를 새로 추가";
    addSheetBtn.onclick = () => addNewSheet();
    const dupSheetBtn = document.createElement("button"); dupSheetBtn.type = "button"; dupSheetBtn.textContent = "⧉ 시트 복제"; dupSheetBtn.title = "현재 시트를 값·서식·병합까지 복제";
    dupSheetBtn.onclick = () => addNewSheet(currentSheet);
    const renSheetBtn = document.createElement("button"); renSheetBtn.type = "button"; renSheetBtn.textContent = "시트 이름 바꾸기"; renSheetBtn.title = "현재 시트 이름 바꾸기(시트 탭 더블클릭도 가능)";
    renSheetBtn.onclick = () => renameSheetPrompt(currentSheet);
    const delSheetBtn = document.createElement("button"); delSheetBtn.type = "button"; delSheetBtn.textContent = "시트 삭제"; delSheetBtn.title = "현재 시트를 삭제(실행 취소 가능)";
    delSheetBtn.onclick = () => deleteCurrentSheet();
    const structureMenu = makeMenu("행·열·시트", "xlsx-tool-menu-structure", addRowBtn, addColBtn, delRowBtn, delColBtn, mergeBtn, unmergeBtn, addSheetBtn, dupSheetBtn, renSheetBtn, delSheetBtn,
      toolButton("선택 범위를 Excel 표로",createExcelTable),
      toolButton("선택 표를 일반 범위로",()=>{
        const b=selectionBounds();if(!b)return;
        changeWorksheetView(v=>{v.tables=(v.tables || []).filter(t=>!spreadsheetRangesOverlap(t.range,b));});
      }),
      toolButton("선택 셀 기준 틀 고정",()=>{const b=selectionBounds();if(b)changeWorksheetView(v=>{v.freezeRows=b.s.r;v.freezeCols=b.s.c;});}),
      toolButton("틀 고정 해제",()=>changeWorksheetView(v=>{v.freezeRows=0;v.freezeCols=0;})),
      toolButton("선택 행 숨기기",()=>{const b=selectionBounds();if(b)changeWorksheetView(v=>{v.hiddenRows=[...new Set([...(v.hiddenRows || []),...Array.from({length:b.e.r-b.s.r+1},(_,i)=>b.s.r+i)])];});}),
      toolButton("선택 열 숨기기",()=>{const b=selectionBounds();if(b)changeWorksheetView(v=>{v.hiddenCols=[...new Set([...(v.hiddenCols || []),...Array.from({length:b.e.c-b.s.c+1},(_,i)=>b.s.c+i)])];});}),
      toolButton("숨긴 행·열 모두 표시",()=>changeWorksheetView(v=>{v.hiddenRows=[];v.hiddenCols=[];})));
    const fontGroup = makeGroup(
      "", "xlsx-editgroup-font", fontSel, sizeSel, boldBtn, italicBtn, underlineBtn, fontColorWrap, fontColorApplyBtn
    );
    const alignGroup = makeGroup("", "xlsx-editgroup-align", alignLeftBtn, alignCenterBtn, alignRightBtn, vAlignSel, wrapBtn, numSel);
    const formatMenu = makeMenu("채우기·테두리", "xlsx-tool-menu-format", fillWrap, fillBtn, borderWrap, borderStyleSel, borderWhereSel, borderBtn, clearFmtBtn, copyFmtBtn, pasteFmtBtn);
    const findMenu = makeMenu("찾기·바꿈", "xlsx-tool-menu-find", findInput, replInput, replaceBtn);
    // 최근 검색어(sheet 구획) — 찾을 내용에만 붙인다. 여기서 '바꿀 내용'은 기억하지 않는다.
    // 자동 채우기도 하지 않는다: 이 메뉴의 동작은 '모두 바꾸기' 하나뿐이라, 지난 검색어가 미리 들어가 있으면
    // 엉뚱한 대상을 한꺼번에 바꿔 버릴 수 있다. 목록에서 직접 고른 것만 들어간다.
    const sheetFindHistory = (typeof MNSearchHistory === "object" && MNSearchHistory)
      ? MNSearchHistory.attach(findInput, { scope: "sheet", mount: findMenu.panel })
      : null;
    // 메뉴 패널은 "버튼을 누르면 닫는다" 규칙이라, 목록 항목 클릭이 메뉴를 닫지 않게 여기서 막는다.
    if (sheetFindHistory) sheetFindHistory.panel.addEventListener("click", (e) => e.stopPropagation());
    const rememberSheetFind = () => { if (sheetFindHistory) sheetFindHistory.remember(findInput.value); };
    const condMenu = makeMenu("조건부 강조", "xlsx-tool-menu-cond", condSel, condVal, condColor, condBtn);
    const cfMenu = makeMenu("조건부 서식", "xlsx-tool-menu-cf", cfKind, cfOp, cfVal, cfVal2, cfColor2, cfColor, cfAddBtn, cfManageBtn);
    const dvType=document.createElement("select");dvType.innerHTML='<option value="whole">정수</option><option value="decimal">숫자</option><option value="date">날짜</option><option value="textLength">글자 수</option>';
    const dvMin=document.createElement("input"),dvMax=document.createElement("input");dvMin.placeholder="최소 (날짜: YYYY-MM-DD)";dvMax.placeholder="최대";
    const dvMenu = makeMenu("입력 제한·목록", "xlsx-tool-menu-dv", dvInput, dvApplyBtn, dvRemoveBtn,
      toolButton("입력한 셀 범위를 목록으로",()=>{
        const ref=dvInput.value.trim().replace(/^=/,""),rule={type:"list",allowBlank:true,formulae:[ref],showErrorMessage:true,errorStyle:"stop"};
        if(!validationList(rule)){toast("목록 범위를 입력하세요. 예: Sheet2!A1:A10",2600);return;}
        setNativeValidation(rule);
      }),dvType,dvMin,dvMax,toolButton("범위 제한 적용",()=>{
        const parse=v=>{const value=coerce(v);return value instanceof Date?spreadsheetDateSerial(value):value;};
        const a=parse(dvMin.value),b=parse(dvMax.value);
        if(typeof a!=="number" || typeof b!=="number" || a>b){toast("유효한 최소·최대 값을 입력하세요.",2400);return;}
        setNativeValidation({type:dvType.value,operator:"between",allowBlank:true,formulae:[a,b],showErrorMessage:true,errorStyle:"stop",errorTitle:"입력 범위 확인",error:"지정한 범위 안의 값을 입력하세요."});
      }));
    const chartBtn = document.createElement("button"); chartBtn.type = "button"; chartBtn.textContent = "📊 차트"; chartBtn.title = "선택 범위(라벨 열 + 값 열)로 막대·선·원 차트 만들기";
    chartBtn.onclick = () => insertChart();
    const selImgBtn = document.createElement("button"); selImgBtn.type = "button"; selImgBtn.textContent = "📷 선택→메모"; selImgBtn.title = "선택한 셀 범위를 이미지로 만들어 메모에 저장";
    selImgBtn.onclick = () => saveSelectionToMemo();
    const pivotBtn = document.createElement("button"); pivotBtn.type = "button"; pivotBtn.textContent = "🧮 미니 피벗"; pivotBtn.title = "선택 범위(머리글 1행 + 데이터)를 그룹별로 요약해 새 시트로 만들기";
    pivotBtn.onclick = () => openPivotModal();
    const formulaHint = document.createElement("span"); formulaHint.className = "xlsx-formula-hint";
    formulaHint.textContent = "🧮 =SUM(A1:A3), =RANK(B2,B2:B31), =Sheet2!A1 · Enter=편집·아래 이동, Tab=오른쪽, Ctrl+S=저장";
    formulaHint.title = "함수: SUM·AVERAGE·IF·IFS·COUNTIF(S)·SUMIF(S)·AVERAGEIF(S)·RANK·MEDIAN·STDEV·LARGE·SMALL·VLOOKUP·XLOOKUP·INDEX·MATCH·CHOOSE·DATE·TEXT 등 · 시트 간 참조·자동 재계산·참조 자동 조정 · 채우기 핸들은 숫자·요일·월·'1반' 패턴 연장";
    const duplicateBtn=toolButton("선택 범위 중복 행 제거",async()=>{
      const b=selectionBounds();if(!b)return;
      if((exMerges[currentSheet] || []).length){toast("병합을 해제한 뒤 중복 행을 제거하세요.",2200);return;}
      const rows=spreadsheetTools.duplicateRows(model,b);
      if(!rows.length){toast("중복 행이 없습니다.",1800);return;}
      if(!await confirmDialog(rows.length+"개 중복 행 전체를 삭제합니다. 선택하지 않은 열의 데이터도 함께 삭제됩니다.","삭제","취소"))return;
      pushUndo(currentSheet);
      remapWorkbookStructure(currentSheet,{axis:"r",deleted:rows});
      rows.sort((a,b)=>b-a).forEach(r=>model.splice(r,1));
      structChanged.add(currentSheet);anyDirty=true;renderEditable(currentSheet);
    });
    const splitBtn=toolButton("텍스트를 열로 나누기",async()=>{
      const b=selectionBounds();if(!b || b.s.c!==b.e.c){toast("나눌 텍스트가 있는 한 열을 선택하세요.",2200);return;}
      const delimiter=await askText({title:"텍스트를 열로 나누기",message:"구분자를 입력하세요. 탭은 \\t 로 입력합니다.",value:",",okText:"나누기"});
      if(!delimiter)return;
      const separator=delimiter==="\\t"?"\t":delimiter;
      const grid=model.slice(b.s.r,b.e.r+1).map(row=>String(row[b.s.c]?.v??"").split(separator));
      const width=Math.max(...grid.map(row=>row.length));
      let occupied=false;
      for(let r=b.s.r;r<=b.e.r;r++)for(let c=b.s.c+1;c<b.s.c+width;c++)if(!spreadsheetModelCellEmpty(model[r]?.[c]))occupied=true;
      if(occupied && !await confirmDialog("오른쪽 셀의 기존 내용을 덮어씁니다. 계속할까요?","나누기","취소"))return;
      pasteGridIntoSelection(grid);
    });
    const moreMenu = makeMenu("더보기", "xlsx-tool-menu-more", chartBtn,pivotBtn,
      toolButton("피벗 새로고침",refreshPivot),
      toolButton("저장된 차트 열기",()=>{const spec=viewFor(currentSheet).chart;if(!spec){toast("저장된 차트가 없습니다.",1800);return;}const data=extractChartData(spec);if(data)openChartModal(data,spec);}),
      selImgBtn,duplicateBtn,splitBtn,formulaHint);
    const printBtn2 = document.createElement("button"); printBtn2.type = "button"; printBtn2.textContent = "인쇄·PDF"; printBtn2.title = "현재 시트를 프린터로 인쇄하거나 PDF로 저장";
    printBtn2.onclick = () => printCurrentSheet();
    const printSettings=makeMenu("인쇄 설정","xlsx-tool-menu-print",
      toolButton("선택 영역을 인쇄 범위로",()=>{const b=selectionBounds();if(b)changeWorksheetView(v=>{v.printArea=rangeA1(b);});}),
      toolButton("인쇄 범위 해제",()=>changeWorksheetView(v=>{v.printArea="";})),
      toolButton("가로 방향",()=>changeWorksheetView(v=>{v.orientation="landscape";})),
      toolButton("세로 방향",()=>changeWorksheetView(v=>{v.orientation="portrait";})),
      toolButton("가로 한 페이지 맞춤 켜기/끄기",()=>changeWorksheetView(v=>{v.fitWidth=!v.fitWidth;})),
      toolButton("첫 행 반복 켜기/끄기",()=>changeWorksheetView(v=>{v.repeatHeader=!v.repeatHeader;})));
    const saveMenu = makeMenu("저장", "xlsx-tool-menu-save xlsx-editgroup-save", xlsxBtn, xlsxCopyBtn, csvBtn2, printBtn2);
    const mkAutoBtn = (label, fn, title) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title;
      b.onclick = () => insertAutoFormula(fn); return b;
    };
    const autoMenu = makeMenu("Σ 자동계산", "xlsx-tool-menu-autosum",
      toolButton("내 함수 관리",openFunctionManager),
      mkAutoBtn("Σ 합계", "SUM", "선택 범위 아래(한 행이면 오른쪽)에 합계 수식 삽입"),
      mkAutoBtn("평균", "AVERAGE", "선택 범위의 평균 수식 삽입"),
      mkAutoBtn("개수", "COUNT", "선택 범위의 숫자 개수 수식 삽입"),
      mkAutoBtn("최대", "MAX", "선택 범위의 최댓값 수식 삽입"),
      mkAutoBtn("최소", "MIN", "선택 범위의 최솟값 수식 삽입"));
    const mainRow = document.createElement("div"); mainRow.className = "xlsx-editbar-row xlsx-editbar-main";
    mainRow.append(historyGroup, dataGroup, structureMenu.details, autoMenu.details, findMenu.details, moreMenu.details, printSettings.details, saveMenu.details);
    const fmtRow = document.createElement("div"); fmtRow.className = "xlsx-editbar-row xlsx-editbar-fmt";
    fmtRow.append(fontGroup, alignGroup, formatMenu.details, condMenu.details, cfMenu.details, dvMenu.details);
    editBar.append(mainRow, fmtRow);
    // ----- 우클릭 메뉴 구성 -----
    // 상단 도구막대의 기능을 같은 갈래끼리 묶어 하위 메뉴로 낸다. 실제 동작은 전부 도구막대와 같은 함수를
    // 그대로 부르므로(버튼 흉내가 아니라 setAlign·setNumberFormat 등 직접 호출) 동작이 갈라질 일이 없다.
    // 입력 칸이 여러 개라 메뉴로 옮길 수 없는 것(조건부 강조·조건부 서식 규칙)은 해당 도구막대 칩을 열어 준다.
    const openToolChip = (menu) => {
      if (!menu || !menu.details) return;
      menu.details.open = true;
      const first = menu.panel.querySelector("input:not([type=color]),select,button");
      if (first) setTimeout(() => first.focus(), 40);
    };
    const sortByContextColumn = (dir) => {
      if (editContextColumn >= 0) sortSel.value = String(editContextColumn);
      doSort(dir);
    };
    const askReplaceAll = async () => {
      const find = await askText({ title:"찾아 바꾸기", message:"현재 시트(선택이 있으면 선택 범위)에서 찾을 내용이에요.",
        value: findInput.value, placeholder:"찾을 내용", okText:"다음" });
      if (find == null || !find) return;
      const repl = await askText({ title:"찾아 바꾸기", message:"'" + find + "' 을(를) 무엇으로 바꿀까요? (비우면 지웁니다)",
        value: replInput.value, placeholder:"바꿀 내용", okText:"모두 바꾸기" });
      if (repl == null) return;
      findInput.value = find; replInput.value = repl;
      rememberSheetFind();
      replaceAllInSheet(find, repl);
    };
    const askDataValidationList = async () => {
      const typed = await askText({ title:"드롭다운 목록", message:"쉼표로 구분해 입력하세요. 선택 범위 셀에 드롭다운이 걸립니다.",
        value: dvInput.value, placeholder:"완료,진행,보류", okText:"적용" });
      if (typed == null) return;
      dvInput.value = typed;
      setDataValidation(parseDvValues(typed));
    };
    const applyFontColor = (hex) => { fontColor.value = hex; setFontColor(hex); };
    const applyFillColor = (hex) => { fillColor.value = hex; setSelectionFill(hex); };
    const swatchItems = (list, apply) => list.map(([label, hex]) => ({ label, swatch:hex, action:() => apply(hex) }));
    const FONT_SWATCHES = [["검정","#1f2937"], ["회색","#94a3b8"], ["빨강","#dc2626"], ["주황","#ea580c"], ["노랑","#ca8a04"],
      ["초록","#16a34a"], ["파랑","#2563eb"], ["남색","#1e3a8a"], ["보라","#7c3aed"], ["흰색","#ffffff"]];
    const FILL_SWATCHES = [["노랑","#fde68a"], ["연두","#bbf7d0"], ["하늘","#bfdbfe"], ["분홍","#fbcfe8"],
      ["주황","#fed7aa"], ["보라","#ddd6fe"], ["회색","#e2e8f0"], ["흰색","#ffffff"]];
    // 글꼴·크기·표시형식은 도구막대 셀렉트의 목록을 그대로 하위 메뉴로 옮긴다(목록이 한 곳에서만 관리되게).
    const itemsFromSelect = (sel, apply) => [...sel.options]
      .filter(option => option.value)
      .map(option => ({ label: option.textContent, action: () => apply(option.value) }));
    editContextActions = [
      { label:"복사(서식 포함)", action:() => copyRichSelection() },
      { label:"붙여넣기(서식 포함)", action:() => { if (richClip) pasteRichIntoSelection(richClip); else toast("먼저 '복사(서식 포함)'를 하세요.", 1800); } },
      { label:"선택 셀 내용 지우기", action:() => clearSelectionContents() },
      { separator:true },
      { label:"삽입·삭제", children:[
        { label:"선택 행 위에 삽입", action:() => addRowBtn.click() },
        { label:"선택 행 삭제", action:() => delRowBtn.click() },
        { separator:true },
        { label:"선택 열 왼쪽에 삽입", action:() => addColBtn.click() },
        { label:"선택 열 삭제", action:() => delColBtn.click() }
      ]},
      { label:"정렬", children:[
        { label:"▲ 오름차순", action:() => sortByContextColumn(1) },
        { label:"▼ 내림차순", action:() => sortByContextColumn(-1) }
      ]},
      { label:"병합", children:[
        { label:"⊞ 셀 병합", action:() => mergeSelection() },
        { label:"⊟ 병합 해제", action:() => unmergeSelection() }
      ]},
      { separator:true },
      { label:"글자", children:[
        { label:"굵게", action:() => toggleFontProp("bold", "굵게") },
        { label:"기울임", action:() => toggleFontProp("italic", "기울임") },
        { label:"밑줄", action:() => toggleFontProp("underline", "밑줄") },
        { separator:true },
        ...swatchItems(FONT_SWATCHES, applyFontColor),
        { label:"다른 색…", action:() => pickCustomColor(fontColor.value, applyFontColor) }
      ]},
      { label:"글꼴", children: itemsFromSelect(fontSel, setFontName) },
      { label:"크기", children: itemsFromSelect(sizeSel, setFontSize) },
      { label:"맞춤", children:[
        { label:"◧ 왼쪽", action:() => setAlign("left") },
        { label:"▥ 가운데", action:() => setAlign("center") },
        { label:"◨ 오른쪽", action:() => setAlign("right") },
        { separator:true },
        { label:"세로 위", action:() => setVAlign("top") },
        { label:"세로 가운데", action:() => setVAlign("middle") },
        { label:"세로 아래", action:() => setVAlign("bottom") },
        { separator:true },
        { label:"↵ 자동 줄바꿈", action:() => toggleWrap() }
      ]},
      { label:"표시형식", children: itemsFromSelect(numSel, (v) => setNumberFormat(v === "__general" ? "" : v)) },
      { label:"채우기·테두리", children:[
        ...swatchItems(FILL_SWATCHES, applyFillColor),
        { label:"채우기 다른 색…", action:() => pickCustomColor(fillColor.value, applyFillColor) },
        { separator:true },
        { label:"테두리 전체 얇게", action:() => setSelectionBorder(borderColor.value, "thin", "all") },
        { label:"테두리 바깥쪽 굵게", action:() => setSelectionBorder(borderColor.value, "thick", "outline") },
        { label:"테두리 지우기", action:() => setSelectionBorder(borderColor.value, "thin", "none") },
        { label:"테두리 자세히 설정…", action:() => openToolChip(formatMenu) },
        { separator:true },
        { label:"🖌 서식 복사", action:() => copyCellFormat() },
        { label:"서식 붙이기", action:() => pasteCellFormat() },
        { label:"서식 지우기", action:() => clearSelectionFormat() }
      ]},
      { separator:true },
      { label:"계산", children:[
        { label:"Σ 합계", action:() => insertAutoFormula("SUM") },
        { label:"평균", action:() => insertAutoFormula("AVERAGE") },
        { label:"개수", action:() => insertAutoFormula("COUNT") },
        { label:"최대", action:() => insertAutoFormula("MAX") },
        { label:"최소", action:() => insertAutoFormula("MIN") }
      ]},
      { label:"데이터", children:[
        { label:"찾아 바꾸기…", action:() => askReplaceAll() },
        { separator:true },
        { label:"조건부 강조 설정…", action:() => openToolChip(condMenu) },
        { label:"조건부 서식 규칙 추가…", action:() => openToolChip(cfMenu) },
        { label:"조건부 서식 규칙 관리…", action:() => openCondManager() },
        { separator:true },
        { label:"드롭다운 목록 적용…", action:() => askDataValidationList() },
        { label:"드롭다운 유효성 제거", action:() => removeDataValidation() }
      ]},
      { label:"만들기", children:[
        { label:"📊 선택 범위로 차트", action:() => insertChart() },
        { label:"🧮 선택 범위로 미니 피벗", action:() => openPivotModal() },
        { label:"📷 선택 범위를 이미지 메모로", action:() => saveSelectionToMemo() }
      ]},
      { label:"저장", children:[
        { label:"XLSX 저장", action:() => xlsxBtn.click() },
        { label:"복사본 내려받기", action:() => xlsxCopyBtn.click() },
        { label:"CSV 저장", action:() => csvBtn2.click() },
        { label:"인쇄·PDF", action:() => printCurrentSheet() }
      ]}
    ];
    updateUndoButtons();

    /* 예전에는 exe 로컬 서버가 있을 때만 [파일에 저장] 버튼을 따로 붙였다. 이제 [XLSX 저장] 자체가
       같은 순서(원본 핸들 → 자동 저장 폴더 사본 → 다운로드)를 지나므로 버튼을 둘로 두지 않는다 —
       어느 것이 '진짜 저장'인지 고르게 만드는 것이 이 기능의 원래 함정이었다. */
  };

  // ===== 시트 관리(편집 모드): 추가·복제·이름 바꾸기·삭제 =====
  const addedSheets = new Set();          // 원본 파일에 없는 새 시트(저장 시 addWorksheet)
  const removedOrigSheets = new Set();    // 삭제된 원본 시트의 '원본 이름'
  const sheetOrigNames = new Map();       // 이름 바뀐 원본 시트: 현재 이름 -> 원본 이름
  const validSheetName = (name) => {
    const t = String(name || "").trim();
    return (t && t.length <= 31 && !/[\\\/\?\*\[\]:]/.test(t)) ? t : null;
  };
  const uniqueSheetName = (base) => {
    const names = new Set(wb.SheetNames.map(n => String(n).toLowerCase()));
    let t = String(base).slice(0, 28) || "Sheet", i = 2;
    while (names.has(t.toLowerCase())) t = String(base).slice(0, 28) + i++;
    return t.slice(0, 31);
  };
  // 시트 편집 모델·병합·변경추적을 새 이름으로 옮기는 공용 도우미
  const renameSheetState = (oldName, name) => {
    [exModels, exMerges, editedCells, styledCells, sheetRevs, colFiltersBySheet, condRulesBySheet, worksheetViews, sheet.__sheetSizes || {}].forEach(obj => {
      if (obj && obj[oldName] !== undefined){ obj[name] = obj[oldName]; delete obj[oldName]; }
    });
    if (structChanged.delete(oldName)) structChanged.add(name);
    if (sourceLayoutSheets.has(oldName)){
      sourceLayoutSheets.set(name, sourceLayoutSheets.get(oldName)); sourceLayoutSheets.delete(oldName);
    }
    if (sheetsWithFormula.delete(oldName)) sheetsWithFormula.add(name);
  };
  const addNewSheet = async (copyFrom = null) => {
    if (copyFrom){
      await exModelFor(copyFrom);
      if (!exModels[copyFrom]){ toast("시트를 복제할 수 없어요.", 2200); return; }
    }
    pushUndo(currentSheet);
    const name = uniqueSheetName(copyFrom ? (copyFrom + " 사본") : ("Sheet" + (wb.SheetNames.length + 1)));
    exModels[name] = copyFrom
      ? exModels[copyFrom].map(row => row.map(s => cloneSpreadsheetValue(s)))
      : Array.from({ length: 20 }, () => Array.from({ length: 8 }, blankCell));
    exMerges[name] = copyFrom ? (exMerges[copyFrom] || []).slice() : [];
    worksheetViews[name]=cloneSpreadsheetValue(copyFrom?viewFor(copyFrom):{header:true,freezeRows:1,freezeCols:0,hiddenRows:[],hiddenCols:[],changed:true});
    if(copyFrom){
      const used=new Set(Object.entries(worksheetViews).filter(([key])=>key!==name).flatMap(([,view])=>(view.tables || []).map(table=>table.name.toLowerCase())));
      for(const table of worksheetViews[name].tables || []){
        const old=table.name;let n=1;while(used.has("table"+n))n++;
        table.name="Table"+n;used.add(table.name.toLowerCase());
        for(const row of exModels[name])for(const cell of row)if(cell.f)
          cell.f=spreadsheetTools.renameTableReferences(cell.f,old,new Map(),false,table.name);
      }
      worksheetViews[name].changed=true;
    }
    condRulesBySheet[name]=cloneSpreadsheetValue(copyFrom?condRulesBySheet[copyFrom] || []:[]);
    editedCells[name] = new Map(); styledCells[name] = new Map();
    structChanged.add(name); addedSheets.add(name);
    if (copyFrom && sheetsWithFormula.has(copyFrom)) sheetsWithFormula.add(name);
    wb.SheetNames.push(name);
    wb.Sheets[name] = { "!ref": "A1" };            // 보기 전용 폴백 스텁(실데이터는 exModels)
    anyDirty = true;
    currentSheet = name;
    rerender();
    toast(copyFrom ? ("시트를 복제했어요: " + name) : ("새 시트를 추가했어요: " + name), 1800);
  };
  const renameSheetPrompt = async (oldName) => {
    if (typeof askText !== "function") return;
    const input = await askText({ title:"시트 이름 바꾸기", message:"새 시트 이름을 입력하세요.",
      value:oldName, placeholder:"시트 이름", okText:"변경" });
    if (input == null) return;
    const name = validSheetName(input);
    if (!name){ toast("시트 이름은 1~31자, \\ / ? * [ ] : 문자는 쓸 수 없어요.", 2600); return; }
    if (name === oldName) return;
    if (wb.SheetNames.some(n => n !== oldName && String(n).toLowerCase() === name.toLowerCase())){
      toast("같은 이름의 시트가 이미 있어요.", 2200); return;
    }
    pushUndo(currentSheet);
    wb.SheetNames[wb.SheetNames.indexOf(oldName)] = name;
    if (wb.Sheets[oldName] !== undefined){ wb.Sheets[name] = wb.Sheets[oldName]; delete wb.Sheets[oldName]; }
    renameSheetState(oldName, name);
    if (addedSheets.delete(oldName)) addedSheets.add(name);
    else {
      const orig = sheetOrigNames.get(oldName) || oldName;
      sheetOrigNames.delete(oldName);
      sheetOrigNames.set(name, orig);
    }
    Object.values(worksheetViews).forEach(view=>{
      if(view.chart?.sheet===oldName)view.chart.sheet=name;
      if(view.pivot?.source===oldName)view.pivot.source=name;
    });
    (wb.Workbook?.Names || []).forEach(n=>{n.Ref=remapFormulaSheetName(n.Ref,oldName,name);});
    Object.entries(exModels).forEach(([home,rows])=>rows.forEach(row=>row.forEach(cell=>{
      if(!cell.validation?.formulae)return;
      const formulae=cell.validation.formulae.map(v=>typeof v==="string"?remapFormulaSheetName(v,oldName,name):v);
      if(formulae.some((v,i)=>v!==cell.validation.formulae[i])){cell.validation={...cell.validation,formulae};structChanged.add(home);}
    })));
    Object.values(condRulesBySheet).forEach(rules=>rules.forEach(rule=>{
      if(rule.native?.formulae)rule.native={...rule.native,formulae:rule.native.formulae.map(v=>typeof v==="string"?remapFormulaSheetName(v,oldName,name):v)};
    }));
    // 다른 시트 수식의 'OldName!A1'  참조를 새 이름으로 따라가게 재작성
    Object.keys(exModels).forEach(nm => {
      const model = exModels[nm];
      const copiedRows = new Set();
      for (let r = 0; r < model.length; r++){
        if (!model[r]) continue;
        for (let c = 0; c < model[r].length; c++){
          const s = model[r][c];
          if (!s || !s.f) continue;
          const nf = remapFormulaSheetName(s.f, oldName, name);
          if (nf === s.f) continue;
          if (csvFastAoa){
            if (!copiedRows.has(r)){ model[r] = model[r].slice(); copiedRows.add(r); }
            model[r][c] = { ...model[r][c], f: nf };
          } else {
            s.f = nf;
          }
          structChanged.add(nm);
        }
      }
    });
    if (currentSheet === oldName) currentSheet = name;
    anyDirty = true;
    rerender();
    toast("시트 이름을 바꿨어요: " + name, 1600);
  };
  const deleteCurrentSheet = async () => {
    const name = currentSheet;
    if (wb.SheetNames.length <= 1){ toast("마지막 시트는 삭제할 수 없어요.", 2200); return; }
    if (typeof confirmDialog !== "function"
      || !await confirmDialog("'" + name + "' 시트를 삭제할까요? Ctrl+Z로 되돌릴 수 있어요.", "삭제", "취소")) return;
    pushUndo(currentSheet);
    const removedIndex=wb.SheetNames.indexOf(name);
    if(wb.Workbook?.Names)wb.Workbook.Names=wb.Workbook.Names.filter(n=>n.Sheet!==removedIndex).map(n=>n.Sheet>removedIndex?{...n,Sheet:n.Sheet-1}:n);
    wb.SheetNames.splice(removedIndex, 1);
    delete wb.Sheets[name];
    [exModels, exMerges, editedCells, styledCells, sheetRevs, colFiltersBySheet,condRulesBySheet,worksheetViews].forEach(obj => { delete obj[name]; });
    structChanged.delete(name); sheetsWithFormula.delete(name);
    if (!addedSheets.delete(name)) removedOrigSheets.add(sheetOrigNames.get(name) || name);
    sheetOrigNames.delete(name);
    anyDirty = true;
    currentSheet = wb.SheetNames[0];
    recalcAndRefresh();                              // 삭제한 시트를 참조하던 수식 → #REF!
    rerender();
    toast("시트를 삭제했어요.", 1600);
  };
  // 편집 모드: 탭을 좌우로 끌어 시트 순서 바꾸기(엑셀과 동일). 6px 이상 움직여야 드래그로 인식해
  // 클릭(시트 전환)·더블클릭(이름 바꾸기)과 충돌하지 않는다. 저장 시 파일에도 순서가 반영된다.
  const wireTabDrag = (b, name) => {
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
      let dragging = false;
      const onMove = (ev) => {
        if (ev.pointerId !== pid) return;
        if (!dragging){
          if (Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 14) return;
          dragging = true;
          b.classList.add("xlsx-tab-dragging");
          try { b.setPointerCapture(pid); } catch(_){}
        }
        // 다른 탭들의 가운데를 기준으로 현재 위치를 정하고, 맨 뒤는 ＋ 탭 앞까지만
        const siblings = [...tabs.querySelectorAll(".xlsx-tab:not(.xlsx-tab-add)")].filter(el => el !== b);
        let before = null;
        for (const el of siblings){
          const r = el.getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2){ before = el; break; }
        }
        tabs.insertBefore(b, before || tabs.querySelector(".xlsx-tab-add"));
      };
      const onUp = (ev) => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (!dragging) return;
        b.classList.remove("xlsx-tab-dragging");
        try { b.releasePointerCapture(pid); } catch(_){}
        const order = [...tabs.querySelectorAll(".xlsx-tab:not(.xlsx-tab-add)")].map(el => el.textContent);
        const changed = order.join("\u0001") !== wb.SheetNames.join("\u0001");
        if (changed){
          pushUndo(currentSheet);
          if(wb.Workbook?.Names)wb.Workbook.Names=wb.Workbook.Names.map(n=>n.Sheet==null?n:{...n,Sheet:order.indexOf(wb.SheetNames[n.Sheet])});
          wb.SheetNames.length = 0;
          wb.SheetNames.push(...order);
          anyDirty = true;
        }
        currentSheet = name;              // 엑셀처럼 끌던 시트를 선택 상태로
        rerender();
        if (changed) toast("시트 순서를 바꿨어요. 저장하면 파일에도 반영돼요.", 1800);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  };
  const rebuildTabs = () => {
    tabs.replaceChildren();
    wb.SheetNames.forEach(name => {
      const b = document.createElement("button");
      b.className = "xlsx-tab"; b.textContent = name;
      b.title = editMode ? (name + " (더블클릭: 이름 바꾸기 · 우클릭: 시트 메뉴 · 드래그: 순서 바꾸기)") : name;
      if (name === currentSheet) b.classList.add("active");
      b.onclick = () => { if (name !== currentSheet){ currentSheet = name; rerender(); } };
      if (editMode){
        b.ondblclick = () => renameSheetPrompt(name);
        wireTabDrag(b, name);
      }
      tabs.appendChild(b);
    });
    if (editMode){
      const add = document.createElement("button");
      add.className = "xlsx-tab xlsx-tab-add"; add.textContent = "＋"; add.title = "새 시트 추가";
      add.onclick = () => addNewSheet();
      tabs.appendChild(add);
    }
    tabs.style.display = (wb.SheetNames.length === 1 && !editMode) ? "none" : "";
  };

  const rerender = async () => {
    rebuildTabs();
    expBtns.hidden = editMode;   // 읽기 전용에서는 항상 표시 — 편집분·CSV 변환본은 exportSheetOf 가 모델 값으로 내보냄
    editBar.hidden = !editMode;
    if (editMode){
      sheet.textContent = "편집기를 준비하는 중…";
      const model = await exModelFor(currentSheet);
      if (!model){
        toast("서식 보존 편집 라이브러리(ExcelJS)를 불러오지 못했어요. 보기 모드로 전환합니다.", 3400);
        editMode = false; syncEditToggle(); expBtns.hidden = false; editBar.hidden = true;
        renderReadonly(currentSheet); return;
      }
      if (!editMode){ editBar.hidden = true; renderReadonly(currentSheet); return; }
      // 시트 간 참조(Sheet2!A1) 해석을 위해 다중 시트 워크북은 모든 모델을 미리 만든다(첫 편집 1회).
      if ((wb.SheetNames || []).length > 1){ await ensureAllModelsBuilt(); if (!editMode) return; }
      spreadsheetEnsureWorkspace(model, sheet.clientWidth);
      buildEditBar();
      renderEditable(currentSheet);
    } else {
      renderReadonly(currentSheet);
    }
  };

  await ensureSpreadsheetMedia();
  await rerender();
}

if (typeof module === "object" && module.exports){
  module.exports = {
    adjustSpreadsheetMergesAfterColumnInsert,
    adjustSpreadsheetMergesAfterColumnDelete,
    adjustSpreadsheetMergesAfterRowDelete,
    adjustSpreadsheetMergesAfterRowInsert,
    spreadsheetRangesOverlap,
    parseClipboardTable,
    pxToExcelColWidth,
    pxToExcelRowHeight,
    excelColWidthToPx,
    excelRowHeightToPx,
    spreadsheetWorksheetDisplayLayout,
    parseFormula,
    evaluateFormula,
    isFormulaError,
    remapFormulaRefs,
    remapMovedFormulaRefs,
    remapFormulaSheetName,
    spreadsheetTextSeries,
    formulaTypingContext,
    spreadsheetAutoFormulaJobs,
    buildSpreadsheetChartSvg,
    cloneSpreadsheetValue,
    spreadsheetVirtualWindow,
    spreadsheetCellValueSnapshot,
    spreadsheetGuessHeader,
    spreadsheetConvertedDocOptions,
    spreadsheetDirectSaveKind,
    spreadsheetJumpToDataEdge,
    spreadsheetModelCellEmpty,
    spreadsheetSelectionBoundsFromKeys,
    spreadsheetSelectionCombineKeys,
    spreadsheetSelectionDragHitPoint,
    spreadsheetSelectionRangeCovered,
    spreadsheetSelectionRangeKeys,
    spreadsheetImageMime,
    spreadsheetNormalizeXlsxNamespaces,
    spreadsheetLoadExcelWorkbook,
    spreadsheetPackageImageInfo,
    spreadsheetImageFormulaInfo,
    spreadsheetFormulaImages,
    spreadsheetFloatingImageDescriptors,
    spreadsheetIsolateWorksheetBytes,
    spreadsheetExtendSheetRangeForImages,
    spreadsheetWorkspaceBounds,
    spreadsheetDataModel,
    spreadsheetEnsureWorkspace,
    writeStructuredSpreadsheetModel
  };
}
