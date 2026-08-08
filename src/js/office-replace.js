"use strict";

/* ===== 오피스(Word·PowerPoint) 찾아 바꾸기 (설계: docs/오피스-찾아바꾸기-설계.md) =====
   본문 글자만 고쳐 쓰고 서식·이미지·스타일은 바이트 그대로 둔다.

   왜 문단 단위로 찾는가: Word·PowerPoint 는 한 문장을 아무 이유 없이 여러 run 으로 쪼갠다
   (서식 경계뿐 아니라 편집 이력 rsid·맞춤법 마커 때문에도). 사람이 "2025" 라고 친 글자가
   파일 안에서는 <w:t>20</w:t><w:t>25</w:t> 로 있을 수 있어, <w:t> 를 하나씩 보면
   화면에 뻔히 보이는 글자가 안 걸린다. 그래서 찾기는 문단을 이어붙인 평문에서 하고,
   되쓸 때만 run 경계를 본다.

   되쓰기 규칙: 치환문은 일치가 시작된 첫 조각에 통째로 넣고, 겹친 나머지 조각에서는
   겹친 부분을 지운다(= Word 자체 찾아 바꾸기와 같은 결과 — 첫 조각의 서식을 따른다).
   손대지 않은 조각은 건드리지 않으므로 문단 안 다른 서식이 그대로 남는다.

   Word 와 PowerPoint 를 한 코어가 처리하는 이유: 문단·run·글자 태그가 이름공간만 다르고
   구조가 같다(<w:p>/<w:r>/<w:t> ↔ <a:p>/<a:r>/<a:t>). 형식마다 다른 건 "어느 파트를
   어떻게 다루는가" 뿐이라, 그 표(§officePartRole)만 갈라 두었다.

   이 파일 위쪽(순수부)은 DOM 도 zip 도 모른다. tests/office-replace.test.js 가
   window 없이 그대로 올려 검증한다. 아래쪽 브라우저부만 zip·파일을 다룬다. */

const OFFICE_REPLACE_MAX_BYTES = 40 * 1024 * 1024;   // 전체를 메모리에 올려 재압축하므로 상한을 둔다(교실 PC 기준)
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/* ---------- 순수 코어 (형식 공통) ---------- */

// 파일 이름 → 다룰 수 있는 형식. 그 밖(.doc·.hwp·.xlsx…)은 null.
function officeReplaceKindOf(name){
  const value = String(name || "").toLowerCase();
  if (/\.docx$/.test(value)) return "docx";
  if (/\.pptx$/.test(value)) return "pptx";
  return null;
}

function officeReplaceMime(kind){ return kind === "pptx" ? PPTX_MIME : DOCX_MIME; }

// XML 엔티티 → 글자. 코어(PdfSignerCore.officeXmlDecodeText)가 있으면 그걸 쓰고,
// 없으면(단위 테스트 등) 같은 규칙을 그대로 쓴다.
function officeReplaceDecode(value){
  if (typeof officeXmlDecodeText === "function") return officeXmlDecodeText(value);
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch(_){ return ""; } })
    .replace(/&#(\d+);/g, (_, digits) => { try { return String.fromCodePoint(parseInt(digits, 10)); } catch(_){ return ""; } })
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// 글자 → XML. XML 1.0 이 담지 못하는 제어문자는 버린다(탭·줄바꿈은 유효해서 남긴다).
function officeReplaceEscape(text){
  return String(text == null ? "" : text)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* 같은 이름의 태그가 겹쳐 있을 때 짝을 맞춰 훑는다. 깊이 0 인 구간만 돌려준다.
   반환: [{ start, end,           여는 태그 시작 ~ 닫는 태그 끝
            innerStart, innerEnd }]  여는 태그 다음 ~ 닫는 태그 앞(안쪽 내용)

   정규식 한 방(<w:p>[\s\S]*?</w:p>)으로 잡으면 안 되는 이유: Word 는 문단 안에 도형을 넣고
   그 도형 안에 다시 문단을 둔다(<w:p> → <w:pict> → <w:txbxContent> → <w:p>). 그러면 바깥 문단이
   안쪽 </w:p> 에서 끊겨, 상자 뒤 글자는 아예 안 보이고 그 문단을 지우면 XML 이 깨진다.
   표도 셀 안에 표를 넣을 수 있어 같은 일이 생긴다. */
function officeBalancedRanges(xml, localName){
  const source = String(xml || "");
  const re = new RegExp("<(/?)(?:[A-Za-z_][\\w.-]*:)?" + localName + "(\\s[^>]*?)?(/?)>", "gi");
  const out = [];
  let depth = 0, start = -1, innerStart = 0, match;
  while ((match = re.exec(source))){
    if (match[1] === "/"){                        // </w:p>
      if (!depth) continue;                       // 짝 없는 닫는 태그는 무시한다(깨진 XML 방어)
      depth--;
      if (!depth && start >= 0){ out.push({ start, end: re.lastIndex, innerStart, innerEnd: match.index }); start = -1; }
      continue;
    }
    if (match[3] === "/"){                        // <w:p/> — 빈 태그
      if (!depth) out.push({ start: match.index, end: re.lastIndex, innerStart: re.lastIndex, innerEnd: re.lastIndex });
      continue;
    }
    if (!depth){ start = match.index; innerStart = re.lastIndex; }
    depth++;
  }
  return out;
}

// 문단 구간 목록(깊이 0 만 — 텍스트 상자 안 문단은 바깥 문단에 딸린 것으로 본다).
function officeParagraphRanges(xml){ return officeBalancedRanges(xml, "p"); }

/* 텍스트 상자 안쪽 구간. 도형 안 글자는 설정과 무관하게 바꾸지 않고 세기만 한다
   (설계: docs/오피스-찾아바꾸기-설계.md) — 도형은 w:txbxContent·DrawingML·VML 세 갈래라
   문단 구조가 본문과 달라 지금의 되쓰기 규칙이 그대로 통하지 않는다. */
function officeTextboxRanges(xml){ return officeBalancedRanges(xml, "txbxContent"); }

/* 문단 안에서 "본문 글자가 아닌" 구역.
    - pPr 의 탭 정의(<w:tab w:pos="720"/>)를 본문 탭으로 착각하면 없는 글자가 생겨 오프셋이 어긋난다.
    - fld 는 자동으로 채워지는 값(슬라이드 번호·날짜)이라 사람이 바꿀 대상이 아니다.
    - txbxContent 는 도형 안 글자라 바꾸지 않는다. 여기서 빼 두어야 바깥 문단 평문이
      "앞글자 + 상자 안 글자" 로 뒤섞이지 않는다. */
function officeSkipRanges(paraXml){
  const ranges = [];
  const re = /<(?:[A-Za-z_][\w.-]*:)?(pPr|rPr|fld)(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/gi;
  let match;
  while ((match = re.exec(paraXml))) ranges.push([match.index, match.index + match[0].length]);
  for (const box of officeTextboxRanges(paraXml)) ranges.push([box.start, box.end]);
  return ranges;
}

/* 문단 XML 한 개 → 검색용 평문 + 되쓰기용 조각 지도.
   segs[i] = { xmlStart, xmlEnd,   원본 XML 에서 글자가 놓인 구간(태그 제외, baseOffset 더한 절대 위치)
               tagStart, open,     여는 <w:t …> 태그의 시작과 원문(xml:space 를 붙일 때 쓴다)
               start, end,         평문 text 안에서의 구간
               locked }            true = 바꿀 수 없는 자리(탭·줄바꿈)
   탭·줄바꿈을 평문에 자리까지 넣어 두는 이유: 빼 버리면 "가\t나" 가 "가나" 로 잘못 걸린다. */
function officeParagraphModel(paraXml, baseOffset){
  const source = String(paraXml || "");
  const base = Number(baseOffset) || 0;
  const skips = officeSkipRanges(source);
  const skipped = (at) => skips.some(([from, to]) => at >= from && at < to);
  const segs = [];
  let text = "";
  const re = /<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>|<(?:[A-Za-z_][\w.-]*:)?(tab|br|cr)(?:\s[^>]*)?\/?>/gi;
  let match;
  while ((match = re.exec(source))){
    if (skipped(match.index)) continue;
    if (match[2]){                                   // <w:tab/> · <w:br/> · <a:br/>
      const ch = match[2].toLowerCase() === "tab" ? "\t" : "\n";
      segs.push({ xmlStart: base + match.index, xmlEnd: base + match.index + match[0].length,
        tagStart: base + match.index, open: "", start: text.length, end: text.length + ch.length, locked: true });
      text += ch;
      continue;
    }
    const raw = match[1];
    const openLen = match[0].indexOf(">") + 1;       // 여는 태그 길이
    const rawStart = match.index + openLen;
    const decoded = officeReplaceDecode(raw);
    segs.push({ xmlStart: base + rawStart, xmlEnd: base + rawStart + raw.length,
      tagStart: base + match.index, open: match[0].slice(0, openLen),
      start: text.length, end: text.length + decoded.length, locked: false });
    text += decoded;
  }
  return { text, segs };
}

/* 정규식 치환문의 $$ · $& · $1~$99 를 편다. String.replace 가 하는 일과 같지만,
   일치 위치를 함께 알아야 해서(어느 조각에 넣을지 정해야 한다) 직접 편다.
   일반(비정규식) 모드에서는 $ 도 그냥 글자다. */
function officeExpandReplacement(replacement, match, regexMode){
  const src = String(replacement == null ? "" : replacement);
  if (!regexMode) return src;
  let out = "";
  for (let i = 0; i < src.length; i++){
    if (src[i] !== "$" || i + 1 >= src.length){ out += src[i]; continue; }
    const next = src[i + 1];
    if (next === "$"){ out += "$"; i++; continue; }
    if (next === "&"){ out += match[0]; i++; continue; }
    const pair = src.slice(i + 1, i + 3);
    let digits = "";
    if (/^\d\d$/.test(pair) && +pair >= 1 && match[+pair] !== undefined) digits = pair;
    else if (/^\d$/.test(next) && +next >= 1 && match[+next] !== undefined) digits = next;
    if (digits){ out += (match[+digits] === undefined ? "" : match[+digits]); i += digits.length; continue; }
    out += src[i];
  }
  return out;
}

// 앞뒤 공백이 있는 글자는 xml:space="preserve" 없이는 Word 가 공백을 먹는다("1학기 계획" → "1학기계획").
function officeOpenTagFor(open, text){
  const tag = String(open || "");
  if (!tag || !/\s$|^\s/.test(String(text))) return tag;
  if (/\sxml:space\s*=/i.test(tag)) return tag;
  return tag.replace(/\/?>$/, ' xml:space="preserve">');
}

/* 평문 구간 목록 → XML 편집 목록. 찾아 바꾸기와 문단 편집이 함께 지나는 되쓰기 엔진이다.
   ranges = [{ start, end, value }]  (문단 평문 기준, 서로 겹치지 않고 앞에서 뒤 순서)

   배치 규칙: 새 글자는 구간이 시작된 첫 조각에 통째로 넣고, 겹친 나머지 조각에서는 겹친 부분을
   지운다. 손대지 않은 조각은 건드리지 않으므로 문단 안 다른 서식이 그대로 남는다.
   탭·줄바꿈(잠긴 조각)을 넘나드는 구간은 되쓸 안전한 자리가 없어 건너뛰고 개수만 보고한다.
   반환: { edits, applied, skipped } */
function officeApplyRangesToSegments(model, ranges){
  const text = model.text;
  const perSeg = new Map();                          // 조각 index -> [{ from, to, value }] (조각 안 상대 위치)
  let applied = 0, skipped = 0;
  for (const range of (Array.isArray(ranges) ? ranges : [])){
    const start = range.start, end = range.end;
    const touched = [];
    model.segs.forEach((seg, index) => {
      // 길이 0 구간(순수 삽입)은 경계에 걸친 조각 하나를 잡아야 한다.
      const hit = end > start ? (seg.end > start && seg.start < end) : (seg.start <= start && seg.end >= start);
      if (hit) touched.push({ seg, index });
    });
    if (!touched.length || touched.some(item => item.seg.locked)){ skipped++; continue; }
    touched.forEach((item, order) => {
      const from = Math.max(item.seg.start, start) - item.seg.start;
      const to = Math.min(item.seg.end, end) - item.seg.start;
      if (!perSeg.has(item.index)) perSeg.set(item.index, []);
      perSeg.get(item.index).push({ from, to, value: order === 0 ? String(range.value == null ? "" : range.value) : "" });
    });
    applied++;
  }

  const edits = [];
  for (const [index, list] of perSeg){
    const seg = model.segs[index];
    const original = text.slice(seg.start, seg.end);
    list.sort((a, b) => a.from - b.from);
    let next = "", pos = 0;
    for (const part of list){ next += original.slice(pos, part.from) + part.value; pos = part.to; }
    next += original.slice(pos);
    edits.push({ start: seg.xmlStart, end: seg.xmlEnd, value: officeReplaceEscape(next) });
    const open = officeOpenTagFor(seg.open, next);
    if (open !== seg.open) edits.push({ start: seg.tagStart, end: seg.xmlStart, value: open });
  }
  return { edits, applied, skipped };
}

/* 문단 모델 + 매처 → 적용할 편집 목록(찾아 바꾸기).
   반환: { edits:[{ start, end, value }], count, skipped, after } */
function officePlanParagraphEdits(model, matcher, replacement){
  const text = model.text;
  const re = new RegExp(matcher.pattern, matcher.flags.includes("g") ? matcher.flags : matcher.flags + "g");
  const ranges = [];
  let cursor = 0, after = "";
  let match;
  while ((match = re.exec(text))){
    if (match[0] === ""){ re.lastIndex++; continue; }   // 빈 일치는 matcher 단계에서 막지만 한 번 더 막는다
    const start = match.index, end = start + match[0].length;
    const value = officeExpandReplacement(replacement, match, matcher.regex);
    ranges.push({ start, end, value });
    after += text.slice(cursor, start) + value;
    cursor = end;
  }
  after += text.slice(cursor);
  const plan = officeApplyRangesToSegments(model, ranges);
  return { edits: plan.edits, count: plan.applied, skipped: plan.skipped, after };
}

/* 문단 평문을 통째로 새 글자로 바꾼다(문단 편집).
   diffTextEdit 으로 앞뒤 공통부를 뺀 "바뀐 한 구간"만 되쓰므로, 문단 끝에 한 글자를 더해도
   앞쪽 run 들의 XML 은 바이트가 그대로다.
   반환: { edits, changed, skipped } — skipped 가 있으면 탭·줄바꿈 자리를 건드려 되쓸 수 없었다는 뜻. */
function officeParagraphTextEdits(model, newText){
  const before = model.text, after = String(newText == null ? "" : newText);
  if (before === after) return { edits: [], changed: false, skipped: 0 };
  const diff = typeof diffTextEdit === "function"
    ? diffTextEdit(before, after)
    : officeFallbackDiff(before, after);
  const plan = officeApplyRangesToSegments(model, [{ start: diff.start, end: diff.end, value: diff.inserted }]);
  return { edits: plan.edits, changed: plan.applied > 0, skipped: plan.skipped };
}

// 코어(PdfSignerCore.diffTextEdit)가 없을 때만 쓰는 같은 규칙의 대체 구현(단위 테스트 대비).
function officeFallbackDiff(before, after){
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]){ oldEnd--; newEnd--; }
  return { start, end: oldEnd, inserted: after.slice(start, newEnd) };
}

// 편집을 뒤에서부터 적용한다 — 앞쪽 오프셋이 밀리지 않게. 편집끼리는 겹치지 않는다.
function officeApplyEdits(xml, edits){
  const list = (Array.isArray(edits) ? edits.slice() : []).sort((a, b) => b.start - a.start);
  let out = String(xml || "");
  for (const edit of list) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
  return out;
}

/* 파트 XML 하나(본문·머리말·슬라이드 모두 같은 구조) → 치환된 XML + 보고서.
   미리보기와 실제 적용이 반드시 같은 코드를 지나야 개수가 어긋나지 않는다.
   boxed = 텍스트 상자 안에서 걸렸지만 바꾸지 않은 곳(부르는 쪽이 "세기만 한 곳" 으로 알린다).
   반환: { out, count, skipped, boxed, changes:[{ para, before, after, count }] } */
function officeReplacePartXml(xml, matcher, replacement){
  const source = String(xml || "");
  const edits = [], changes = [];
  let count = 0, skipped = 0, index = 0;
  for (const range of officeParagraphRanges(source)){
    index++;
    const model = officeParagraphModel(source.slice(range.start, range.end), range.start);
    if (!model.segs.length) continue;
    const plan = officePlanParagraphEdits(model, matcher, replacement);
    skipped += plan.skipped;
    if (!plan.count) continue;
    count += plan.count;
    for (const edit of plan.edits) edits.push(edit);
    changes.push({ para: index, before: model.text, after: plan.after, count: plan.count });
  }
  return { out: count ? officeApplyEdits(source, edits) : source, count, skipped,
    boxed: officeCountTextboxMatches(source, matcher), changes };
}

// 문단 평문에서 몇 곳이 걸리는지 센다(도형 안은 빼고 — officeSkipRanges 가 이미 걸러 둔다).
function officeCountParagraphMatches(xml, matcher){
  const source = String(xml || "");
  let total = 0;
  for (const range of officeParagraphRanges(source)){
    const model = officeParagraphModel(source.slice(range.start, range.end), range.start);
    if (!model.text) continue;
    const finder = new RegExp(matcher.pattern, matcher.flags.includes("g") ? matcher.flags : matcher.flags + "g");
    const found = model.text.match(finder);
    if (found) total += found.length;
  }
  return total;
}

// 텍스트 상자 안에서 걸리는 곳의 수. 상자 안 상자도 세도록 안쪽 내용을 두고 다시 센다.
function officeCountTextboxMatches(xml, matcher){
  const source = String(xml || "");
  let total = 0;
  for (const box of officeTextboxRanges(source))
    total += officeCountMatches(source.slice(box.innerStart, box.innerEnd), matcher);
  return total;
}

// 바꾸지 않고 개수만 센다(설정이 꺼져 있을 때의 머리말·노트, 언제나 메모·차트). 도형 안도 함께 센다.
function officeCountMatches(xml, matcher){
  return officeCountParagraphMatches(xml, matcher) + officeCountTextboxMatches(xml, matcher);
}

/* ---------- 미리보기 제자리 편집: 화면 문단 ↔ XML 문단 대조 ---------- */

/* 대조용 열쇠 — 공백을 다 지운 글자만 남긴다.
   docx-preview 는 <w:tab/> 을 &emsp;(U+2003) 로, <w:br/> 을 <br> 로 그린다. <br> 은 textContent 에
   아무것도 남기지 않으므로 우리 평문의 "\t"·"\n" 과 애초에 같을 수가 없다. 여기서 알고 싶은 건
   "이 화면 문단이 그 XML 문단이 맞나" 뿐이라, 공백 표현 차이는 버리고 글자만 본다. */
function officeInlineTextKey(text){ return String(text == null ? "" : text).replace(/\s/g, ""); }

/* 미리보기에서 뽑은 본문 문단 글자 목록 ↔ officeParagraphOutline 이 매기는 순서가 같은 것을
   가리키는지 확인한다. 순번이 어긋난 채 저장하면 사용자가 고친 것과 다른 문단이 바뀌고,
   화면상으로는 멀쩡해 보여 알아채지도 못한다. 그래서 붙일 때 전부 맞춰 보고 하나라도
   어긋나면 순번으로 붙이지 않는다. 화면 쪽에서는 임시 북마크로 정확한 위치를 한 번 더
   확인하고, 그것도 실패할 때만 목록 화면으로 물러난다.

   대응이 깨질 수 있는 자리: mc:AlternateContent(Choice·Fallback 양쪽에 <w:p> 가 있다),
   <w:sdt>, altChunk, 렌더러가 그리지 못한 요소. 전부 여기서 걸린다.
   반환: { ok } 또는 { ok:false, reason, at } */
function officeInlineMapVerify(domTexts, outline){
  const dom = Array.isArray(domTexts) ? domTexts : [];
  const items = Array.isArray(outline) ? outline : [];
  if (dom.length !== items.length)
    return { ok: false, at: -1, reason: "화면 문단 " + dom.length + "개와 문서 문단 " + items.length + "개가 맞지 않아요." };
  for (let i = 0; i < items.length; i++){
    if (officeInlineTextKey(dom[i]) !== officeInlineTextKey(items[i].text))
      return { ok: false, at: i, reason: (i + 1) + "번째 문단 글자가 화면과 문서에서 달라요." };
  }
  return { ok: true, at: -1, reason: "" };
}

/* document.xml 의 본문 문단마다 임시 북마크를 넣는다. docx-preview 는 북마크 시작을
   <span id="…"> 로 그대로 그리므로, 글자·문단 수가 달라도 화면 <p> 와 XML 문단을
   순번 추측 없이 정확히 이을 수 있다. 반환된 XML 은 편집 화면을 다시 그리는 데만 쓰고
   저장 바이트에는 절대 넣지 않는다.

   북마크 시작/끝을 문단 맨 앞에 붙여 내용은 감싸지 않는다. 따라서 Word 필드·도형·표
   구조에는 손대지 않고, 빈 <w:p/> 만 정상 여닫는 태그로 편다. */
function officeParagraphMarkerPlan(xml, rawPrefix){
  const source = String(xml || "");
  const prefix = (String(rawPrefix || "_mn_docx_para_").replace(/[^A-Za-z0-9_]/g, "_") || "_mn_docx_para_");
  let nextId = 1;
  const idRe = /<(?:[A-Za-z_][\w.-]*:)?bookmarkStart\s[^>]*(?:[A-Za-z_][\w.-]*:)?id="(\d+)"/gi;
  let idMatch;
  while ((idMatch = idRe.exec(source))) nextId = Math.max(nextId, Number(idMatch[1]) + 1);

  const edits = [], markers = [];
  for (const [at, range] of officeParagraphRanges(source).entries()){
    const paraXml = source.slice(range.start, range.end);
    const open = paraXml.match(/^<((?:[A-Za-z_][\w.-]*:)?)p(?:\s[^>]*)?\/?>/i);
    if (!open) continue;
    const ns = open[1] || "w:";
    const name = prefix + (at + 1);
    const id = nextId++;
    const marker = "<" + ns + "bookmarkStart " + ns + "id=\"" + id + "\" " + ns + "name=\"" + name + "\"/>" +
      "<" + ns + "bookmarkEnd " + ns + "id=\"" + id + "\"/>";
    if (/\/>$/.test(open[0])){
      const expanded = open[0].replace(/\/>$/, ">") + marker + "</" + ns + "p>";
      edits.push({ start: range.start, end: range.end, value: expanded });
    } else {
      edits.push({ start: range.innerStart, end: range.innerStart, value: marker });
    }
    markers.push({ index: at + 1, name });
  }
  return { xml: officeApplyEdits(source, edits), edits, markers };
}

/* ---------- Word 표 구조 편집 ---------- */

// Word 본문의 바깥쪽 표 → 행 → 셀 범위. 중첩 표는 바깥 셀에 속한 것으로 표시하고 구조 편집은
// 막는다. 중첩 표까지 평평하게 좌표를 매기면 바깥 표의 열 삭제가 안쪽 셀을 지울 수 있기 때문이다.
function officeTableOutline(xml){
  const source = String(xml || "");
  return officeBalancedRanges(source, "tbl").map((tableRange, tableAt) => {
    const tableXml = source.slice(tableRange.start, tableRange.end);
    const tableOpen = tableXml.match(/^<(?:[A-Za-z_][\w.-]*:)?tbl(?:\s[^>]*)?>/i);
    const tableInner = tableOpen ? tableXml.slice(tableOpen[0].length, tableXml.lastIndexOf("</")) : tableXml;
    const hasNestedTable = /<(?:[A-Za-z_][\w.-]*:)?tbl(?:\s[^>]*)?>/i.test(tableInner);
    const rows = officeBalancedRanges(tableXml, "tr").map((rowRange, rowAt) => {
      const rowStart = tableRange.start + rowRange.start;
      const rowEnd = tableRange.start + rowRange.end;
      const rowXml = source.slice(rowStart, rowEnd);
      const cells = officeBalancedRanges(rowXml, "tc").map((cellRange, cellAt) => {
        const start = rowStart + cellRange.start;
        const end = rowStart + cellRange.end;
        const cellXml = source.slice(start, end);
        const tcPr = cellXml.match(/<(?:[A-Za-z_][\w.-]*:)?tcPr(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?tcPr\s*>/i);
        const span = tcPr && tcPr[0].match(/<(?:[A-Za-z_][\w.-]*:)?gridSpan\s[^>]*(?:[A-Za-z_][\w.-]*:)?val="(\d+)"/i);
        const merge = tcPr && tcPr[0].match(/<(?:[A-Za-z_][\w.-]*:)?vMerge(?:\s[^>]*)?\/?>/i);
        const mergeVal = merge && merge[0].match(/(?:[A-Za-z_][\w.-]*:)?val="([^"]+)"/i);
        return {
          index: cellAt + 1, start, end,
          gridSpan: Math.max(1, span ? Number(span[1]) || 1 : 1),
          vMerge: merge ? (mergeVal ? mergeVal[1] : "continue") : ""
        };
      });
      return { index: rowAt + 1, start: rowStart, end: rowEnd, cells };
    });
    const hasVerticalMerge = rows.some(row => row.cells.some(cell => !!cell.vMerge));
    // gridSpan 외에 구형 hMerge, 행 앞뒤의 가상 격자도 열 좌표가 단순하지 않다.
    const hasGridSpan = rows.some(row => row.cells.some(cell => cell.gridSpan > 1)) ||
      /<(?:[A-Za-z_][\w.-]*:)?(?:hMerge|gridBefore|gridAfter)(?:\s[^>]*)?\/?>/i.test(tableXml);
    const cellCounts = rows.map(row => row.cells.length);
    const rectangular = !!rows.length && cellCounts.every(count => count === cellCounts[0]);
    return {
      index: tableAt + 1, start: tableRange.start, end: tableRange.end, rows,
      hasNestedTable, hasVerticalMerge, hasGridSpan, rectangular,
      columnCount: rectangular && cellCounts.length ? cellCounts[0] : 0
    };
  });
}

function officeTableOwnProperties(xml, localName){
  const source = String(xml || "");
  const re = new RegExp("<(?:[A-Za-z_][\\w.-]*:)?" + localName + "(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?" + localName + "\\s*>", "i");
  const match = source.match(re);
  return match ? match[0] : "";
}

// 셀의 너비·테두리·음영·정렬은 물려받고 내용은 빈 문단 하나로 만든다.
function officeBlankTableCellXml(cellXml){
  const source = String(cellXml || "");
  const open = source.match(/^<((?:[A-Za-z_][\w.-]*:)?)tc(?:\s[^>]*)?>/i);
  const ns = open ? (open[1] || "w:") : "w:";
  const tcOpen = open ? open[0] : "<" + ns + "tc>";
  const tcPr = officeTableOwnProperties(source, "tcPr");
  const firstPara = officeParagraphRanges(source)[0];
  const paraXml = firstPara ? source.slice(firstPara.start, firstPara.end) : "";
  const pPr = officeTableOwnProperties(paraXml, "pPr");
  return tcOpen + tcPr + "<" + ns + "p>" + pPr + "</" + ns + "p></" + ns + "tc>";
}

// 선택한 행의 높이·셀 모양을 물려받되 반복 머리글 속성은 새 행에 복제하지 않는다.
function officeBlankTableRowXml(rowXml){
  const source = String(rowXml || "");
  const open = source.match(/^<((?:[A-Za-z_][\w.-]*:)?)tr(?:\s[^>]*)?>/i);
  const ns = open ? (open[1] || "w:") : "w:";
  const trOpen = open ? open[0] : "<" + ns + "tr>";
  let trPr = officeTableOwnProperties(source, "trPr");
  trPr = trPr.replace(/<(?:[A-Za-z_][\w.-]*:)?tblHeader(?:\s[^>]*)?\/>/gi, "")
             .replace(/<(?:[A-Za-z_][\w.-]*:)?tblHeader(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?tblHeader\s*>/gi, "");
  const cells = officeBalancedRanges(source, "tc").map(range => officeBlankTableCellXml(source.slice(range.start, range.end)));
  return trOpen + trPr + cells.join("") + "</" + ns + "tr>";
}

function officeTableGridEdit(source, table, cellIndex, kind){
  const tableXml = source.slice(table.start, table.end);
  const gridRange = officeBalancedRanges(tableXml, "tblGrid")[0];
  if (!gridRange) return null;                         // tblGrid 없는 문서도 Word가 열 수 있으므로 셀만 고친다
  const gridXml = tableXml.slice(gridRange.start, gridRange.end);
  const cols = [];
  const re = /<(?:[A-Za-z_][\w.-]*:)?gridCol(?:\s[^>]*)?\/?>/gi;
  let match;
  while ((match = re.exec(gridXml))) cols.push({ start: match.index, end: re.lastIndex, xml: match[0] });
  if (!cols.length) return null;
  const at = Math.max(0, Math.min(cols.length - 1, cellIndex - 1));
  if (kind === "column-delete")
    return { start: table.start + gridRange.start + cols[at].start,
      end: table.start + gridRange.start + cols[at].end, value: "" };
  const before = kind === "column-add-left";
  const pos = table.start + gridRange.start + (before ? cols[at].start : cols[at].end);
  return { start: pos, end: pos, value: cols[at].xml };
}

/* 행·열 한 동작을 document.xml 편집으로 만든다.
   kind: row-add-above | row-add-below | row-delete |
         column-add-left | column-add-right | column-delete
   병합 표는 기존 병합을 보존하기 위해 영향받는 축의 구조 편집을 거부한다. */
function officeTableStructureEdit(xml, action){
  const source = String(xml || "");
  const request = action || {};
  const tables = officeTableOutline(source);
  const tableIndex = Number(request.tableIndex) || 0;
  const rowIndex = Number(request.rowIndex) || 0;
  const cellIndex = Number(request.cellIndex) || 0;
  const table = tables[tableIndex - 1];
  if (!table) return { xml: source, changed: false, reason: "표 위치를 찾지 못했어요." };
  const row = table.rows[rowIndex - 1];
  if (!row) return { xml: source, changed: false, reason: "표 행 위치를 찾지 못했어요." };
  const cell = row.cells[cellIndex - 1];
  if (!cell) return { xml: source, changed: false, reason: "표 셀 위치를 찾지 못했어요." };
  if (table.hasNestedTable)
    return { xml: source, changed: false, reason: "표 안에 다른 표가 들어 있어 구조는 바꿀 수 없어요." };

  const kind = String(request.kind || "");
  const rowKind = /^row-/.test(kind);
  const columnKind = /^column-/.test(kind);
  if (!rowKind && !columnKind) return { xml: source, changed: false, reason: "알 수 없는 표 편집이에요." };
  if (rowKind && table.hasVerticalMerge)
    return { xml: source, changed: false, reason: "세로 병합된 셀이 있어 행 구조는 바꿀 수 없어요. 병합은 그대로 유지됩니다." };
  if (columnKind && (table.hasVerticalMerge || table.hasGridSpan))
    return { xml: source, changed: false, reason: "병합된 셀이 있어 열 구조는 바꿀 수 없어요. 병합은 그대로 유지됩니다." };
  if (columnKind && !table.rectangular)
    return { xml: source, changed: false, reason: "행마다 셀 수가 달라 열 구조는 바꿀 수 없어요." };

  const edits = [];
  let selection = { tableIndex, rowIndex, cellIndex };
  if (kind === "row-add-above" || kind === "row-add-below"){
    const blank = officeBlankTableRowXml(source.slice(row.start, row.end));
    const before = kind === "row-add-above";
    const pos = before ? row.start : row.end;
    edits.push({ start: pos, end: pos, value: blank });
    selection = { tableIndex, rowIndex: before ? rowIndex : rowIndex + 1, cellIndex };
  } else if (kind === "row-delete"){
    if (table.rows.length <= 1)
      return { xml: source, changed: false, reason: "표의 마지막 행은 지울 수 없어요." };
    edits.push({ start: row.start, end: row.end, value: "" });
    const nextRowIndex = Math.min(rowIndex, table.rows.length - 1);
    const nextRow = rowIndex < table.rows.length ? table.rows[rowIndex] : table.rows[rowIndex - 2];
    selection = { tableIndex, rowIndex: nextRowIndex, cellIndex: Math.min(cellIndex, nextRow.cells.length) };
  } else if (kind === "column-add-left" || kind === "column-add-right"){
    const before = kind === "column-add-left";
    for (const eachRow of table.rows){
      const eachCell = eachRow.cells[cellIndex - 1];
      const pos = before ? eachCell.start : eachCell.end;
      edits.push({ start: pos, end: pos, value: officeBlankTableCellXml(source.slice(eachCell.start, eachCell.end)) });
    }
    const grid = officeTableGridEdit(source, table, cellIndex, kind);
    if (grid) edits.push(grid);
    selection = { tableIndex, rowIndex, cellIndex: before ? cellIndex : cellIndex + 1 };
  } else if (kind === "column-delete"){
    if (table.columnCount <= 1)
      return { xml: source, changed: false, reason: "표의 마지막 열은 지울 수 없어요." };
    for (const eachRow of table.rows){
      const eachCell = eachRow.cells[cellIndex - 1];
      edits.push({ start: eachCell.start, end: eachCell.end, value: "" });
    }
    const grid = officeTableGridEdit(source, table, cellIndex, kind);
    if (grid) edits.push(grid);
    selection = { tableIndex, rowIndex, cellIndex: Math.min(cellIndex, table.columnCount - 1) };
  }
  return { xml: officeApplyEdits(source, edits), changed: true, reason: "", kind, edits, selection };
}

// 요소의 맨 앞 속성 컨테이너(pPr/tcPr/trPr)에 자식 속성 하나를 추가·교체·삭제한다.
// 속성 컨테이너를 시작 부분에서만 찾는 이유는 텍스트 상자·중첩 표 안의 pPr/tcPr를 바깥
// 요소의 속성으로 잘못 집지 않기 위해서다.
function officeSetWordProperty(ownerXml, ownerName, propsName, childName, childXml){
  const source = String(ownerXml || "");
  const open = source.match(new RegExp("^<((?:[A-Za-z_][\\w.-]*:)?)" + ownerName + "(?:\\s[^>]*)?/?>", "i"));
  if (!open) return source;
  const ns = open[1] || "w:";
  const wanted = String(childXml || "");
  if (/\/>$/.test(open[0])){
    if (!wanted) return source;
    return open[0].replace(/\/>$/, ">") + "<" + ns + propsName + ">" + wanted + "</" + ns + propsName + ">" +
      "</" + ns + ownerName + ">";
  }

  const rest = source.slice(open[0].length);
  const propsRe = new RegExp("^([\\s\\r\\n]*)(<(?:[A-Za-z_][\\w.-]*:)?" + propsName +
    "(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?" + propsName + "\\s*>))", "i");
  const propsMatch = rest.match(propsRe);
  if (!propsMatch){
    if (!wanted) return source;
    return source.slice(0, open[0].length) + "<" + ns + propsName + ">" + wanted + "</" + ns + propsName + ">" + rest;
  }

  const propsXml = propsMatch[2];
  const childRe = new RegExp("<(?:[A-Za-z_][\\w.-]*:)?" + childName +
    "(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?" + childName + "\\s*>)", "i");
  let nextProps;
  if (childRe.test(propsXml)) nextProps = propsXml.replace(childRe, wanted);
  else if (!wanted) nextProps = propsXml;
  else if (/\/>$/.test(propsXml)) nextProps = propsXml.replace(/\/>$/, ">") + wanted + "</" + ns + propsName + ">";
  else nextProps = propsXml.replace(new RegExp("</(?:[A-Za-z_][\\w.-]*:)?" + propsName + "\\s*>$", "i"),
    wanted + "</" + ns + propsName + ">");
  return source.slice(0, open[0].length) + propsMatch[1] + nextProps + rest.slice(propsMatch[0].length);
}

function officeWordVal(xml, localName, attrName){
  const source = String(xml || "");
  const re = new RegExp("<(?:[A-Za-z_][\\w.-]*:)?" + localName + "\\s[^>]*(?:[A-Za-z_][\\w.-]*:)?" +
    (attrName || "val") + "=\"([^\"]*)\"", "i");
  const match = source.match(re);
  return match ? match[1] : "";
}

function officeColorValue(value, fallback){
  const normalized = String(value || "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : (fallback || "");
}

function officeAttributeEscape(value){
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function officeWordToggle(xml, localName){
  const source = String(xml || "");
  const re = new RegExp("<(?:[A-Za-z_][\\w.-]*:)?" + localName + "(?:\\s([^>]*))?/?>", "i");
  const match = source.match(re);
  if (!match) return false;
  const value = (match[1] || "").match(/(?:[A-Za-z_][\w.-]*:)?val="([^"]*)"/i);
  return !value || !/^(0|false|off|no)$/i.test(value[1]);
}

function officeCellTextRunRanges(cellXml){
  const source = String(cellXml || "");
  const textboxes = officeTextboxRanges(source);
  return officeBalancedRanges(source, "r").filter(range =>
    !textboxes.some(box => range.start >= box.start && range.start < box.end) &&
    /<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>/i.test(source.slice(range.start, range.end)));
}

function officeTextFormatOfXml(ownerXml){
  const source = String(ownerXml || "");
  const firstRange = officeCellTextRunRanges(source)[0];
  const firstRun = firstRange ? source.slice(firstRange.start, firstRange.end) : "";
  const rPr = officeTableOwnProperties(firstRun, "rPr");
  const fontSize = Number(officeWordVal(rPr, "sz", "val"));
  return {
    font: officeWordVal(rPr, "rFonts", "eastAsia") || officeWordVal(rPr, "rFonts", "ascii") ||
      officeWordVal(rPr, "rFonts", "hAnsi") || "",
    fontSize: fontSize > 0 ? fontSize / 2 : 11,
    bold: officeWordToggle(rPr, "b")
  };
}

function officeApplyTextRunFormat(ownerXml, kind, value){
  const source = String(ownerXml || "");
  const runRanges = officeCellTextRunRanges(source);
  if (!runRanges.length) return { xml: source, changed: false, reason: "서식을 적용할 글자가 없어요." };
  let font = "", halfPoints = 0, enabled = false;
  if (kind === "font"){
    font = String(value || "").trim().slice(0, 100);
    if (!font) return { xml: source, changed: false, reason: "적용할 글꼴을 골라 주세요." };
  } else if (kind === "font-size"){
    const requestedPoints = Number(value);
    if (!Number.isFinite(requestedPoints) || requestedPoints <= 0)
      return { xml: source, changed: false, reason: "적용할 글자 크기를 골라 주세요." };
    halfPoints = Math.round(Math.max(1, Math.min(200, requestedPoints)) * 2);
  } else if (kind === "bold"){
    enabled = value === true || String(value).toLowerCase() === "true" || String(value) === "1";
  } else return { xml: source, changed: false, reason: "알 수 없는 글자 서식 편집이에요." };

  const edits = [];
  for (const range of runRanges){
    let runXml = source.slice(range.start, range.end);
    const prefix = (runXml.match(/^<((?:[A-Za-z_][\w.-]*:)?)r/i) || [])[1] || "w:";
    if (kind === "font"){
      const escaped = officeAttributeEscape(font);
      runXml = officeSetWordProperty(runXml, "r", "rPr", "rFonts",
        "<" + prefix + "rFonts " + prefix + "ascii=\"" + escaped + "\" " + prefix +
        "hAnsi=\"" + escaped + "\" " + prefix + "eastAsia=\"" + escaped + "\" " + prefix +
        "cs=\"" + escaped + "\"/>");
    } else if (kind === "font-size"){
      runXml = officeSetWordProperty(runXml, "r", "rPr", "sz",
        "<" + prefix + "sz " + prefix + "val=\"" + halfPoints + "\"/>");
      runXml = officeSetWordProperty(runXml, "r", "rPr", "szCs",
        "<" + prefix + "szCs " + prefix + "val=\"" + halfPoints + "\"/>");
    } else {
      const direct = enabled ? "<" + prefix + "b/>" : "<" + prefix + "b " + prefix + "val=\"0\"/>";
      const complex = enabled ? "<" + prefix + "bCs/>" : "<" + prefix + "bCs " + prefix + "val=\"0\"/>";
      runXml = officeSetWordProperty(runXml, "r", "rPr", "b", direct);
      runXml = officeSetWordProperty(runXml, "r", "rPr", "bCs", complex);
    }
    edits.push({ start: range.start, end: range.end, value: runXml });
  }
  const xml = officeApplyEdits(source, edits);
  return { xml, changed: xml !== source, reason: xml === source ? "같은 서식이에요." : "" };
}

function officeTableGridColumnXml(source, table, cellIndex){
  const tableXml = source.slice(table.start, table.end);
  const gridRange = officeBalancedRanges(tableXml, "tblGrid")[0];
  if (!gridRange) return null;
  const gridXml = tableXml.slice(gridRange.start, gridRange.end);
  const cols = [];
  const re = /<(?:[A-Za-z_][\w.-]*:)?gridCol(?:\s[^>]*)?\/?>/gi;
  let match;
  while ((match = re.exec(gridXml))) cols.push({ start: match.index, end: re.lastIndex, xml: match[0] });
  const col = cols[Math.max(0, Math.min(cols.length - 1, cellIndex - 1))];
  return col ? { ...col, absoluteStart: table.start + gridRange.start + col.start,
    absoluteEnd: table.start + gridRange.start + col.end } : null;
}

function officeTableCellFormat(xml, request){
  const source = String(xml || "");
  const target = request || {};
  const table = officeTableOutline(source)[(Number(target.tableIndex) || 0) - 1];
  const row = table && table.rows[(Number(target.rowIndex) || 0) - 1];
  const cell = row && row.cells[(Number(target.cellIndex) || 0) - 1];
  if (!table || !row || !cell) return null;
  const cellXml = source.slice(cell.start, cell.end);
  const tcPr = officeTableOwnProperties(cellXml, "tcPr");
  const firstParaRange = officeParagraphRanges(cellXml)[0];
  const firstPara = firstParaRange ? cellXml.slice(firstParaRange.start, firstParaRange.end) : "";
  const pPr = officeTableOwnProperties(firstPara, "pPr");
  const fill = officeWordVal(tcPr, "shd", "fill");
  const borderColor = officeWordVal(tcPr, "top", "color") || officeWordVal(tcPr, "left", "color") ||
    officeWordVal(tcPr, "bottom", "color") || officeWordVal(tcPr, "right", "color");
  const gridCol = officeTableGridColumnXml(source, table, cell.index);
  const cellWidth = Number(officeWordVal(tcPr, "tcW", "w")) ||
    Number(gridCol && officeWordVal(gridCol.xml, "gridCol", "w")) || 1440;
  const rowXml = source.slice(row.start, row.end);
  const textFormat = officeTextFormatOfXml(cellXml);
  return {
    horizontal: officeWordVal(pPr, "jc", "val") || "left",
    vertical: officeWordVal(tcPr, "vAlign", "val") || "top",
    fill: officeColorValue(fill, "FFFFFF"),
    borderColor: officeColorValue(borderColor, "000000"),
    width: cellWidth,
    height: Number(officeWordVal(officeTableOwnProperties(rowXml, "trPr"), "trHeight", "val")) || 360,
    font: textFormat.font,
    fontSize: textFormat.fontSize,
    bold: textFormat.bold,
    canResizeColumn: table.rectangular && !table.hasNestedTable && !table.hasVerticalMerge && !table.hasGridSpan,
    canFormat: !table.hasNestedTable
  };
}

function officeSetGridColumnWidth(source, table, cellIndex, width){
  const col = officeTableGridColumnXml(source, table, cellIndex);
  if (!col) return null;
  const prefix = (col.xml.match(/^<((?:[A-Za-z_][\w.-]*:)?)gridCol/i) || [])[1] || "w:";
  let value = col.xml;
  const widthRe = /\s(?:[A-Za-z_][\w.-]*:)?w="[^"]*"/i;
  if (widthRe.test(value)) value = value.replace(widthRe, " " + prefix + "w=\"" + width + "\"");
  else value = value.replace(/\/>$/, " " + prefix + "w=\"" + width + "\"/>");
  return { start: col.absoluteStart, end: col.absoluteEnd, value };
}

/* 선택 셀의 정렬·색·테두리·글자 서식, 선택 행 높이, 단순 표의 선택 열 너비를 바꾼다.
   kind: horizontal | vertical | fill | border | font | font-size | bold | column-width | row-height */
function officeTableFormatEdit(xml, action){
  const source = String(xml || "");
  const request = action || {};
  const tableIndex = Number(request.tableIndex) || 0;
  const rowIndex = Number(request.rowIndex) || 0;
  const cellIndex = Number(request.cellIndex) || 0;
  const table = officeTableOutline(source)[tableIndex - 1];
  const row = table && table.rows[rowIndex - 1];
  const cell = row && row.cells[cellIndex - 1];
  if (!table || !row || !cell) return { xml: source, changed: false, reason: "표 셀 위치를 찾지 못했어요." };
  if (table.hasNestedTable) return { xml: source, changed: false, reason: "표 안에 다른 표가 들어 있어 셀 서식을 바꿀 수 없어요." };

  const kind = String(request.kind || "");
  const edits = [];
  const cellXml = source.slice(cell.start, cell.end);
  const cellPrefix = (cellXml.match(/^<((?:[A-Za-z_][\w.-]*:)?)tc/i) || [])[1] || "w:";
  if (kind === "horizontal"){
    const value = /^(left|center|right|both)$/.test(String(request.value || "")) ? String(request.value) : "left";
    const paraEdits = [];
    for (const range of officeParagraphRanges(cellXml)){
      const paraXml = cellXml.slice(range.start, range.end);
      const prefix = (paraXml.match(/^<((?:[A-Za-z_][\w.-]*:)?)p/i) || [])[1] || "w:";
      const next = officeSetWordProperty(paraXml, "p", "pPr", "jc",
        "<" + prefix + "jc " + prefix + "val=\"" + value + "\"/>");
      paraEdits.push({ start: range.start, end: range.end, value: next });
    }
    edits.push({ start: cell.start, end: cell.end, value: officeApplyEdits(cellXml, paraEdits) });
  } else if (kind === "vertical"){
    const value = /^(top|center|bottom)$/.test(String(request.value || "")) ? String(request.value) : "top";
    edits.push({ start: cell.start, end: cell.end, value: officeSetWordProperty(cellXml, "tc", "tcPr", "vAlign",
      "<" + cellPrefix + "vAlign " + cellPrefix + "val=\"" + value + "\"/>") });
  } else if (kind === "fill"){
    const color = officeColorValue(request.value, "");
    const child = color ? "<" + cellPrefix + "shd " + cellPrefix + "val=\"clear\" " + cellPrefix +
      "color=\"auto\" " + cellPrefix + "fill=\"" + color + "\"/>" : "";
    edits.push({ start: cell.start, end: cell.end,
      value: officeSetWordProperty(cellXml, "tc", "tcPr", "shd", child) });
  } else if (kind === "border"){
    const color = officeColorValue(request.value, "");
    let child = "";
    if (color){
      const edge = (name) => "<" + cellPrefix + name + " " + cellPrefix + "val=\"single\" " + cellPrefix +
        "sz=\"8\" " + cellPrefix + "space=\"0\" " + cellPrefix + "color=\"" + color + "\"/>";
      child = "<" + cellPrefix + "tcBorders>" + edge("top") + edge("left") + edge("bottom") + edge("right") +
        "</" + cellPrefix + "tcBorders>";
    }
    edits.push({ start: cell.start, end: cell.end,
      value: officeSetWordProperty(cellXml, "tc", "tcPr", "tcBorders", child) });
  } else if (kind === "font"){
    const formatted = officeApplyTextRunFormat(cellXml, kind, request.value);
    if (!formatted.changed) return { xml: source, changed: false, reason: formatted.reason };
    edits.push({ start: cell.start, end: cell.end, value: formatted.xml });
  } else if (kind === "font-size"){
    const formatted = officeApplyTextRunFormat(cellXml, kind, request.value);
    if (!formatted.changed) return { xml: source, changed: false, reason: formatted.reason };
    edits.push({ start: cell.start, end: cell.end, value: formatted.xml });
  } else if (kind === "bold"){
    const formatted = officeApplyTextRunFormat(cellXml, kind, request.value);
    if (!formatted.changed) return { xml: source, changed: false, reason: formatted.reason };
    edits.push({ start: cell.start, end: cell.end, value: formatted.xml });
  } else if (kind === "column-width"){
    if (!table.rectangular || table.hasVerticalMerge || table.hasGridSpan)
      return { xml: source, changed: false, reason: "병합되거나 셀 수가 다른 표에서는 열 너비를 바꿀 수 없어요." };
    const current = officeTableCellFormat(source, { tableIndex, rowIndex, cellIndex });
    const width = Math.max(240, Math.min(14400, current.width + (Number(request.delta) || 0)));
    for (const eachRow of table.rows){
      const eachCell = eachRow.cells[cellIndex - 1];
      const eachXml = source.slice(eachCell.start, eachCell.end);
      const prefix = (eachXml.match(/^<((?:[A-Za-z_][\w.-]*:)?)tc/i) || [])[1] || "w:";
      edits.push({ start: eachCell.start, end: eachCell.end,
        value: officeSetWordProperty(eachXml, "tc", "tcPr", "tcW",
          "<" + prefix + "tcW " + prefix + "w=\"" + width + "\" " + prefix + "type=\"dxa\"/>") });
    }
    const gridEdit = officeSetGridColumnWidth(source, table, cellIndex, width);
    if (gridEdit) edits.push(gridEdit);
  } else if (kind === "row-height"){
    const rowXml = source.slice(row.start, row.end);
    const prefix = (rowXml.match(/^<((?:[A-Za-z_][\w.-]*:)?)tr/i) || [])[1] || "w:";
    const current = Number(officeWordVal(officeTableOwnProperties(rowXml, "trPr"), "trHeight", "val")) || 360;
    const height = Math.max(120, Math.min(14400, current + (Number(request.delta) || 0)));
    edits.push({ start: row.start, end: row.end, value: officeSetWordProperty(rowXml, "tr", "trPr", "trHeight",
      "<" + prefix + "trHeight " + prefix + "val=\"" + height + "\" " + prefix + "hRule=\"atLeast\"/>") });
  } else return { xml: source, changed: false, reason: "알 수 없는 표 서식 편집이에요." };

  const out = officeApplyEdits(source, edits);
  return { xml: out, changed: out !== source, reason: out === source ? "같은 서식이에요." : "", kind, edits,
    selection: { tableIndex, rowIndex, cellIndex } };
}

function officeParagraphTextFormat(xml, request){
  const source = String(xml || "");
  const index = Number(request && request.paragraphIndex) || 0;
  const item = officeParagraphOutline(source)[index - 1];
  if (!item) return null;
  return officeTextFormatOfXml(source.slice(item.start, item.end));
}

function officeParagraphFormatEdit(xml, action){
  const source = String(xml || "");
  const request = action || {};
  const paragraphIndex = Number(request.paragraphIndex) || 0;
  const item = officeParagraphOutline(source)[paragraphIndex - 1];
  if (!item) return { xml: source, changed: false, reason: "문단 위치를 찾지 못했어요." };
  const paragraphXml = source.slice(item.start, item.end);
  const formatted = officeApplyTextRunFormat(paragraphXml, String(request.kind || ""), request.value);
  if (!formatted.changed) return { xml: source, changed: false, reason: formatted.reason };
  return {
    xml: officeApplyEdits(source, [{ start: item.start, end: item.end, value: formatted.xml }]),
    changed: true, reason: "", kind: String(request.kind || ""),
    selection: { paragraphIndex }
  };
}

/* ---------- 문단 편집(Phase 2, 설계: docs/워드-문단편집-설계.md) ---------- */

/* 파트 XML → 편집 화면이 쓸 문단 목록.
   items[i] = { index, start, end,   문단 순번과 XML 구간(통째 삭제·삽입 지점 계산용)
                text, style,          평문과 문단 스타일 이름(<w:pStyle w:val>)
                inTable, hasSectPr, locked }
   inTable/hasSectPr 를 여기서 정하는 이유: 추가·삭제를 막아야 하는 문단을 화면이 아니라
   순수 함수가 판정해야 단위 테스트로 굳힐 수 있다. */
function officeParagraphOutline(xml){
  const source = String(xml || "");
  // 표도 셀 안에 표가 들어갈 수 있어 짝을 맞춰 훑는다 — 안쪽 </w:tbl> 에서 끊으면
  // 그 뒤 문단이 "표 밖" 으로 잘못 보여 지울 수 있게 되고, 그러면 셀 구조가 깨진다.
  const tableRanges = officeBalancedRanges(source, "tbl");
  const tables = officeTableOutline(source);
  const tableCells = [];
  for (const table of tables)
    for (const row of table.rows)
      for (const cell of row.cells) tableCells.push({ table, row, cell });

  const items = [];
  let index = 0;
  let tableCellAt = 0;
  for (const range of officeParagraphRanges(source)){
    index++;
    const paraXml = source.slice(range.start, range.end);
    const model = officeParagraphModel(paraXml, range.start);
    // 스타일은 이 문단 자신의 pPr 안에서만 찾는다 — 도형 안 문단의 스타일을 바깥 이름표로 쓰면 안 된다.
    const ownPr = paraXml.match(/<(?:[A-Za-z_][\w.-]*:)?pPr(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?pPr\s*>/i);
    const styleMatch = ownPr ? ownPr[0].match(/<(?:[A-Za-z_][\w.-]*:)?pStyle\s[^>]*w:val="([^"]*)"/i) : null;
    while (tableCellAt < tableCells.length && tableCells[tableCellAt].cell.end <= range.start) tableCellAt++;
    const candidateCell = tableCells[tableCellAt];
    const tableCell = candidateCell && range.start >= candidateCell.cell.start && range.start < candidateCell.cell.end
      ? candidateCell : null;
    items.push({
      index,
      start: range.start,
      end: range.end,
      text: model.text,
      style: styleMatch ? styleMatch[1] : "",
      inTable: tableRanges.some(box => range.start >= box.start && range.start < box.end),
      tableIndex: tableCell ? tableCell.table.index : 0,
      tableRow: tableCell ? tableCell.row.index : 0,
      tableCell: tableCell ? tableCell.cell.index : 0,
      tableHasNested: tableCell ? tableCell.table.hasNestedTable : false,
      tableHasVerticalMerge: tableCell ? tableCell.table.hasVerticalMerge : false,
      tableHasGridSpan: tableCell ? tableCell.table.hasGridSpan : false,
      tableRectangular: tableCell ? tableCell.table.rectangular : false,
      tableRowCount: tableCell ? tableCell.table.rows.length : 0,
      tableColumnCount: tableCell ? tableCell.table.columnCount : 0,
      hasSectPr: /<(?:[A-Za-z_][\w.-]*:)?sectPr(?:\s[^>]*)?[>/]/i.test(paraXml),
      locked: model.segs.some(seg => seg.locked),
      // 도형이 든 문단은 글자를 고칠 수는 있어도 통째로 지우면 도형까지 사라진다 — 화면이 알려 준다.
      hasTextbox: officeTextboxRanges(paraXml).length > 0
    });
  }
  return items;
}

/* 새 문단 XML — 직전 문단의 문단 서식(<w:pPr>)만 물려받고 글자는 비운다.
   Word 에서 Enter 를 쳤을 때와 같은 규칙이다(스타일·정렬·들여쓰기가 이어진다).
   단 <w:sectPr>(쪽 설정)은 복제하지 않는다 — 복제하면 쪽 나눔이 하나 더 생긴다. */
function officeNewParagraphXml(templateParaXml, text){
  const source = String(templateParaXml || "");
  const prefixMatch = source.match(/^<((?:[A-Za-z_][\w.-]*:)?)p(?:\s[^>]*)?>/i);
  const ns = prefixMatch ? prefixMatch[1] : "w:";
  const prMatch = source.match(/<(?:[A-Za-z_][\w.-]*:)?pPr(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?pPr\s*>/i);
  let pPr = prMatch ? prMatch[0] : "";
  if (pPr && /<(?:[A-Za-z_][\w.-]*:)?sectPr(?:\s[^>]*)?[>/]/i.test(pPr)){
    pPr = pPr.replace(/<(?:[A-Za-z_][\w.-]*:)?sectPr(?:\s[^>]*)?\/>/gi, "")
             .replace(/<(?:[A-Za-z_][\w.-]*:)?sectPr(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?sectPr\s*>/gi, "");
  }
  const body = String(text == null ? "" : text);
  const escaped = officeReplaceEscape(body);
  const space = /^\s|\s$/.test(body) ? ' xml:space="preserve"' : "";
  const run = body ? "<" + ns + "r><" + ns + "t" + space + ">" + escaped + "</" + ns + "t></" + ns + "r>" : "";
  return "<" + ns + "p>" + pPr + run + "</" + ns + "p>";
}

/* 문단 통째 삭제·삽입을 XML 편집 목록으로 바꾼다.
   removeIndexes: 지울 문단 순번(1부터) · inserts: [{ afterIndex, xml }] (0 이면 맨 앞)

   쪽 설정(<w:sectPr>)을 품은 문단은 지우지 않는다 — 문서 끝 문단에 용지·여백·머리말 연결이
   들어 있어, 지우면 쪽 설정이 통째로 날아간다. 표 안 문단도 추가·삭제하지 않는다(셀 구조가 깨진다).
   반환: { edits, removed, inserted, refused:[{ index, reason }] } */
function officeParagraphStructureEdits(outline, removeIndexes, inserts){
  const items = Array.isArray(outline) ? outline : [];
  const byIndex = new Map(items.map(item => [item.index, item]));
  const edits = [], refused = [];
  let removed = 0, inserted = 0;

  for (const rawIndex of (Array.isArray(removeIndexes) ? removeIndexes : [])){
    const item = byIndex.get(rawIndex);
    if (!item){ refused.push({ index: rawIndex, reason: "없는 문단이에요." }); continue; }
    if (item.hasSectPr){ refused.push({ index: rawIndex, reason: "쪽 설정이 든 문단이라 지울 수 없어요." }); continue; }
    if (item.inTable){ refused.push({ index: rawIndex, reason: "표 안 문단은 지울 수 없어요." }); continue; }
    edits.push({ start: item.start, end: item.end, value: "" });
    removed++;
  }

  for (const entry of (Array.isArray(inserts) ? inserts : [])){
    const afterIndex = Number(entry && entry.afterIndex) || 0;
    if (afterIndex === 0){
      const first = items[0];
      if (!first){ refused.push({ index: 0, reason: "문단이 없어 넣을 자리를 찾지 못했어요." }); continue; }
      edits.push({ start: first.start, end: first.start, value: String(entry.xml || "") });
      inserted++;
      continue;
    }
    const item = byIndex.get(afterIndex);
    if (!item){ refused.push({ index: afterIndex, reason: "없는 문단이에요." }); continue; }
    if (item.inTable){ refused.push({ index: afterIndex, reason: "표 안에는 문단을 더할 수 없어요." }); continue; }
    // 쪽 설정 문단 "앞"에 넣는다 — 뒤에 넣으면 마지막 쪽 설정보다 뒤로 밀려 새 구역이 생긴 것처럼 보인다.
    const at = item.hasSectPr ? item.start : item.end;
    edits.push({ start: at, end: at, value: String(entry.xml || "") });
    inserted++;
  }
  return { edits, removed, inserted, refused };
}

/* 편집 화면의 행 목록 → XML 편집 목록. 화면(docx-editor.js)은 행 배열만 들고 있고
   "무엇을 어떻게 되쓸지" 는 전부 여기서 정한다 — 그래야 DOM 없이 검증할 수 있다.

   rows[i] = { index,      원본 문단 순번(1부터). 새 문단이면 0
               text,       지금 글자
               original,   처음 읽은 글자(새 문단은 없어도 된다)
               removed,    지움 표시
               after }     새 문단일 때: 이 순번 뒤에 넣는다(0 = 맨 앞)

   같은 자리에 새 문단이 여럿이면 한 편집으로 합친다 — 오프셋이 같은 삽입을 따로 넣으면
   적용 순서가 보장되지 않아 줄 순서가 뒤집힌다.
   반환: { edits, changed, removed, inserted, refused, skipped } */
function officeParagraphEditPlan(xml, rows){
  const source = String(xml || "");
  const outline = officeParagraphOutline(source);
  const byIndex = new Map(outline.map(item => [item.index, item]));
  const list = Array.isArray(rows) ? rows : [];
  const edits = [];
  let changed = 0, skipped = 0;

  // ① 글자만 바뀐 문단
  for (const row of list){
    if (!row || !row.index || row.removed) continue;
    const item = byIndex.get(row.index);
    if (!item) continue;
    if (String(row.text) === String(row.original)) continue;
    const model = officeParagraphModel(source.slice(item.start, item.end), item.start);
    const plan = officeParagraphTextEdits(model, row.text);
    skipped += plan.skipped;
    if (!plan.changed) continue;
    for (const edit of plan.edits) edits.push(edit);
    changed++;
  }

  // ② 지운 문단 + ③ 새 문단(같은 자리끼리 합치기)
  const removeIndexes = list.filter(row => row && row.index && row.removed).map(row => row.index);
  const grouped = new Map();
  for (const row of list){
    if (!row || row.index || row.removed) continue;
    const after = Number(row.after) || 0;
    const template = after > 0 && byIndex.has(after)
      ? source.slice(byIndex.get(after).start, byIndex.get(after).end)
      : (outline[0] ? source.slice(outline[0].start, outline[0].end) : "<w:p/>");
    const made = officeNewParagraphXml(template, row.text);
    grouped.set(after, (grouped.get(after) || "") + made);
  }
  const inserts = [...grouped].map(([afterIndex, xmlText]) => ({ afterIndex, xml: xmlText }));
  const struct = officeParagraphStructureEdits(outline, removeIndexes, inserts);
  for (const edit of struct.edits) edits.push(edit);

  return { edits, changed, removed: struct.removed, inserted: struct.inserted,
    refused: struct.refused, skipped };
}

/* ---------- 형식별 파트 표 ---------- */

/* 파트의 갈래. "어떤 파트를 어떻게 다루는가" 를 여기 한 곳에 모아 둔다.
   body      = 언제나 바꾼다
   attached  = 설정을 켜면 바꾸고, 끄면 개수만 센다 (Word 머리말·꼬리말·각주 / PPT 발표자 노트)
   countOnly = 언제나 개수만 센다 (메모·차트·도해 — 남이 쓴 글이거나 다른 데이터와 묶여 있다)
   null      = 상관없는 파트 (스타일·테마·슬라이드 마스터·레이아웃 등)

   슬라이드 마스터·레이아웃을 뺀 이유: 거기 든 "제목을 입력하십시오" 는 화면에 보이는 글이 아니라
   빈 자리 안내문이다. 세어서 알리면 없는 일치를 있다고 하는 셈이 된다. */
function officePartRole(path, kind){
  const value = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (kind === "pptx"){
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(value)) return "body";
    if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(value)) return "attached";
    if (/^ppt\/(?:comments|modernComments)\/[^/]+\.xml$/i.test(value)) return "countOnly";
    if (/^ppt\/(?:charts|diagrams)\/[^/]+\.xml$/i.test(value)) return "countOnly";
    return null;
  }
  if (value === "word/document.xml") return "body";
  if (/^word\/(?:header|footer)\d*\.xml$/i.test(value)) return "attached";
  if (/^word\/(?:footnotes|endnotes)\.xml$/i.test(value)) return "attached";
  if (/^word\/comments\.xml$/i.test(value)) return "countOnly";
  return null;
}

/* 화면에 보여줄 파트 이름. PowerPoint 는 파트 자체가 번호를 달고 있어(슬라이드 3) 이름표에 번호를
   넣고, 문단 번호는 붙이지 않는다(numbered:false) — "슬라이드 3 · 문단 2" 는 읽는 사람에게 쓸모가 없다. */
function officePartLabel(path, kind){
  const value = String(path || "").replace(/\\/g, "/");
  const numberIn = (re) => { const m = value.match(re); return m ? m[1] : ""; };
  if (kind === "pptx"){
    const slide = numberIn(/slide(\d+)\.xml$/i);
    if (/notesSlide\d+\.xml$/i.test(value)) return { label: "노트 " + slide, numbered: false };
    if (/slide\d+\.xml$/i.test(value)) return { label: "슬라이드 " + slide, numbered: false };
    if (/(?:comments|modernComments)\//i.test(value)) return { label: "메모", numbered: false };
    if (/charts\//i.test(value)) return { label: "차트", numbered: false };
    if (/diagrams\//i.test(value)) return { label: "도해", numbered: false };
    return { label: "슬라이드", numbered: false };
  }
  if (/header\d*\.xml$/i.test(value)) return { label: "머리말", numbered: true };
  if (/footer\d*\.xml$/i.test(value)) return { label: "꼬리말", numbered: true };
  if (/footnotes\.xml$/i.test(value)) return { label: "각주", numbered: true };
  if (/endnotes\.xml$/i.test(value)) return { label: "미주", numbered: true };
  if (/comments\.xml$/i.test(value)) return { label: "메모", numbered: true };
  return { label: "문단", numbered: true };
}

// 경로에 든 숫자로 정렬한다(slide2 가 slide10 보다 먼저 오도록 — 문자열 정렬은 어긋난다).
function officeSortParts(paths){
  const numberOf = (p) => { const m = String(p).match(/(\d+)\.xml$/i); return m ? +m[1] : 0; };
  return paths.slice().sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b));
}

// 실제로 바꿀 파트 목록(본문 먼저, 그다음 딸린 글). opts.includeAttached 는 설정에서 온다.
function officeTargetParts(paths, kind, opts){
  const includeAttached = !!(opts && opts.includeAttached);
  const body = [], attached = [];
  for (const path of (Array.isArray(paths) ? paths : [])){
    const role = officePartRole(path, kind);
    if (role === "body") body.push(path);
    else if (role === "attached" && includeAttached) attached.push(path);
  }
  return officeSortParts(body).concat(officeSortParts(attached));
}

/* 개수만 셀 파트 목록(설정이 꺼졌을 때의 딸린 글 + 언제나 메모·차트).
   딸린 글을 먼저 두는 이유: 결과 문구가 "머리말 2곳 · 메모 1곳" 처럼 사용자가 신경 쓰는 순서로 읽힌다. */
function officeCountOnlyParts(paths, kind, opts){
  const includeAttached = !!(opts && opts.includeAttached);
  const attached = [], others = [];
  for (const path of (Array.isArray(paths) ? paths : [])){
    const role = officePartRole(path, kind);
    if (role === "attached" && !includeAttached) attached.push(path);
    else if (role === "countOnly") others.push(path);
  }
  return officeSortParts(attached).concat(officeSortParts(others));
}

// 문서 전체에서 한 번만 보면 되는 위험 신호(Word 전용 — PowerPoint 에는 이런 게 없다).
function officeDetectFlags(xml){
  const source = String(xml || "");
  return {
    hasTrackedChanges: /<(?:[A-Za-z_][\w.-]*:)?(?:ins|del)(?:\s[^>]*)?>/i.test(source),
    hasDataBinding: /<(?:[A-Za-z_][\w.-]*:)?dataBinding\b/i.test(source)
  };
}

/* 바꿀 수 없는 이유를 문자열로, 바꿔도 되면 null 을 돌려준다.
   설정값은 함수 밖에서 읽어 opts 로 넣는다 — 순수부가 appSettings 를 보면 단위 테스트가 못 돈다. */
function officeExclusionReason(info, opts){
  const value = info || {}, options = opts || {};
  const what = value.kind === "pptx" ? "PowerPoint" : "Word";
  if (value.encrypted) return "암호로 보호된 문서예요.";
  if (Number(value.size) > OFFICE_REPLACE_MAX_BYTES) return "파일이 너무 커요(40MB 넘음).";
  if (!value.hasBody) return what + " 문서 구조가 아니에요.";
  if (value.hasDataBinding) return "내용 컨트롤이 연결된 문서라 바꿔도 되돌아가요.";
  if (value.hasTrackedChanges && !options.allowTrackedChanges)
    return "변경 내용 추적이 켜진 문서예요. 설정▸문서에서 켤 수 있어요.";
  return null;
}

/* ---------- 브라우저 전용: zip 읽기·쓰기 ---------- */

const MNOfficeReplace = (() => {
  const isBrowser = typeof window !== "undefined" && !!window.document;

  async function needZip(){
    if (typeof MNLazy !== "undefined") await MNLazy.tryNeed("zip");
    if (typeof zip === "undefined") throw new Error("zip-unavailable");
    zip.configure({ useWebWorkers: false });
    return zip;
  }

  // 파일을 열어 우리가 볼 XML 파트만 문자열로 꺼낸다. 원본 바이트도 함께 들고 나온다
  // (되돌리기와 저장에 쓰고, 창이 떠 있는 동안 다시 풀지 않기 위해).
  async function readParts(file, kind){
    const lib = await needZip();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encrypted = typeof looksEncryptedOffice === "function" && looksEncryptedOffice(bytes);
    if (encrypted) return { bytes, encrypted: true, paths: [], parts: {} };
    const reader = new lib.ZipReader(new lib.BlobReader(new Blob([bytes])));
    try {
      const entries = await reader.getEntries();
      const paths = [], parts = {};
      for (const entry of entries){
        if (entry.directory) continue;
        const path = entry.filename.replace(/\\/g, "/");
        if (!officePartRole(path, kind)) continue;
        paths.push(path);
        parts[path] = await entry.getData(new lib.TextWriter());
      }
      return { bytes, encrypted: false, paths, parts };
    } finally { try { await reader.close(); } catch(_){} }
  }

  /* 파일을 한 번만 풀어 둔다(찾을 말과 무관한 부분). opts = { includeAttached, allowTrackedChanges }.
     반환: { reason } 이 있으면 바꿀 수 없는 문서, 아니면 { kind, bytes, parts, paths, hasTrackedChanges }.
     읽기와 계산을 나눠 두는 이유: 창이 떠 있는 동안 찾을 말을 고칠 때마다 zip 을 다시 풀지 않기 위해서다. */
  async function read(file, kind, opts){
    let raw;
    try { raw = await readParts(file, kind); }
    catch(_){ return { reason: "문서를 열지 못했어요." }; }
    const flags = officeDetectFlags(Object.values(raw.parts).join("\n"));
    const hasBody = raw.paths.some(path => officePartRole(path, kind) === "body");
    const reason = officeExclusionReason({
      kind,
      encrypted: raw.encrypted,
      size: file && file.size,
      hasBody,
      hasTrackedChanges: flags.hasTrackedChanges,
      hasDataBinding: flags.hasDataBinding
    }, opts);
    if (reason) return { reason, hasTrackedChanges: flags.hasTrackedChanges };
    return { kind, bytes: raw.bytes, parts: raw.parts, paths: raw.paths, hasTrackedChanges: flags.hasTrackedChanges };
  }

  /* 풀어 둔 파트 + 찾기 조건 → 바뀔 내용. 미리보기와 실제 적용이 함께 지나는 유일한 통로다.
     반환: { count, skipped, changes, replaced, outside } */
  function compute(source, matcher, replacement, opts){
    const kind = source.kind;
    const changes = [], replaced = {}, outside = [];
    let count = 0, skipped = 0, boxed = 0;
    for (const path of officeTargetParts(source.paths, kind, opts)){
      const result = officeReplacePartXml(source.parts[path], matcher, replacement);
      skipped += result.skipped;
      boxed += result.boxed;              // 바꾸는 파트라도 그 안 도형 글자는 바꾸지 않는다
      if (!result.count) continue;
      count += result.count;
      replaced[path] = result.out;
      const naming = officePartLabel(path, kind);
      for (const change of result.changes)
        changes.push({ ...change, part: path, label: naming.label, numbered: naming.numbered });
    }
    for (const path of officeCountOnlyParts(source.paths, kind, opts)){
      const found = officeCountMatches(source.parts[path], matcher);
      if (found) outside.push({ label: officePartLabel(path, kind).label, count: found });
    }
    if (boxed) outside.push({ label: "텍스트 상자", count: boxed });
    return { count, skipped, changes, replaced, outside };
  }

  // 읽기 + 계산을 한 번에(단일 파일 검증·테스트용).
  async function preview(file, kind, matcher, replacement, opts){
    const source = await read(file, kind, opts);
    if (source.reason) return source;
    return { ...source, ...compute(source, matcher, replacement, opts) };
  }

  /* 지정한 파트만 갈아끼운 새 바이트. 나머지 엔트리는 바이트 그대로 복사한다.
     zip.js 를 쓰는 이유: docx-preview·PPTXjs 지연 로드가 전역 JSZip 을 3.x ↔ 2.6.1 로 갈아 끼우는데,
     저장이 그 타이밍에 얹히면 재현하기 어려운 버그가 된다. zip.js 는 전역 충돌이 없다. */
  async function build(bytes, newXmlByPath){
    const lib = await needZip();
    const reader = new lib.ZipReader(new lib.BlobReader(new Blob([bytes])));
    const writer = new lib.ZipWriter(new lib.BlobWriter("application/zip"));
    try {
      const entries = await reader.getEntries();
      for (const entry of entries){
        if (entry.directory) continue;
        const path = entry.filename.replace(/\\/g, "/");
        const replacement = newXmlByPath && newXmlByPath[path];
        if (typeof replacement === "string"){
          await writer.add(entry.filename, new lib.TextReader(replacement));
        } else {
          const blob = await entry.getData(new lib.BlobWriter());
          await writer.add(entry.filename, new lib.BlobReader(blob));
        }
      }
      const blob = await writer.close();
      return new Uint8Array(await blob.arrayBuffer());
    } finally { try { await reader.close(); } catch(_){} }
  }

  /* 오피스 문서 저장. 찾아 바꾸기와 문단 편집이 같은 규칙을 쓴다.
     반환: { path, mode } 또는 저장하지 못했으면 null.
       mode "original" — 열어 둔 원본 파일을 그 자리에서 덮어썼다
       mode "copy"     — 원본은 그대로 두고 자동 저장 폴더 아래에 사본을 만들었다

     갈래가 둘인 이유: 파일 쓰기 핸들이 있어야 원본을 덮어쓸 수 있다. 폴더로 연 문서는 핸들이
     있고(exe 는 /source-folder-file 로 원본 폴더에 쓰는 네이티브 핸들을 준다), 낱개 파일로 끌어다
     놓은 문서는 절대 경로 자체가 없어 원본을 찾아갈 방법이 없다. 그때 쓰는 /save-file 은 서버가
     경로를 자동 저장 폴더(SaveRoot) 기준으로 풀기 때문에 결과가 사본이다.

     부르는 쪽은 mode 를 반드시 사용자에게 알려야 한다 — "저장했어요" 한마디로 뭉뚱그리면
     원본을 고친 줄 알고 사본만 남는다. 헤더 배지("원본 저장"/"사본 저장")와 같은 말을 쓴다. */
  async function saveDocument(doc, bytes, kind){
    if (doc && doc.fsHandle && typeof saveViaFileHandle === "function"){
      try {
        const result = await saveViaFileHandle(bytes, doc.name, doc, { existingOnly: true, mime: officeReplaceMime(kind) });
        return result === "saved" ? { path: doc.workspacePath || doc.relPath || doc.name, mode: "original" } : null;
      } catch(e){ console.warn("오피스 문서 핸들 저장 실패:", e); return null; }
    }
    try {
      if (typeof saveFileBackendAvailable !== "function" || !(await saveFileBackendAvailable())) return null;
      const rel = String((doc && (doc.relPath || doc.workspacePath || doc.name)) || "")
        .replace(/\\/g, "/").replace(/^\/+/, "");
      if (!rel) return null;
      const response = await fetch("/save-file", {
        method: "POST",
        headers: { "X-Save-Path": encodeURIComponent(rel) },
        body: new Blob([bytes], { type: "application/octet-stream" })
      });
      if (!response.ok) return null;
      const savedPath = (await response.text()).trim() || rel;
      try { window.__mnLastSaveRel = rel; } catch(_){}
      return { path: savedPath, mode: "copy" };
    } catch(e){ console.error(e); return null; }
  }

  // 저장 결과 한 줄. 사본이면 원본을 고치는 방법까지 붙인다(모르면 사본만 쌓인다).
  function saveResultText(result){
    if (!result) return "";
    if (result.mode === "copy")
      return "사본으로 저장했어요: " + result.path + " · 원본을 직접 고치려면 '열기 → 폴더 열기'로 여세요";
    return "원본에 저장했어요: " + result.path;
  }

  /* 저장된 바이트를 앱이 실제로 읽는 곳에 반영한다(검색·다시 열기·자동 복원).
     loadOffice 의 render 는 매번 doc.sourceFile 을 다시 보므로 파일만 갈아 끼우면 되고,
     PPTX 는 열 때 읽어 둔 바이트를 renderOptions 에 들고 있어 그것도 비운다. */
  function reflectSaved(doc, bytes, kind){
    let fresh = null;
    try {
      fresh = new File([bytes], (doc && doc.name) || (kind === "pptx" ? "slides.pptx" : "document.docx"),
        { type: officeReplaceMime(kind) });
      const old = doc.sourceFile;
      if (old){
        if (old.__fsHandle && typeof withFileHandle === "function") withFileHandle(fresh, old.__fsHandle);
        if (old.__fsDirHandle && typeof withDirHandle === "function") withDirHandle(fresh, old.__fsDirHandle);
      }
      doc.sourceFile = fresh;
      if (doc.renderOptions) doc.renderOptions.pptxBytes = null;
      if (typeof contentCacheDrop === "function") contentCacheDrop(doc.id);   // 통합 검색이 옛 본문을 들고 있지 않게
    } catch(_){ return null; }
    return fresh;
  }

  // 앱 재시작 복원 묶음도 최신 바이트로 갱신한다(원본 파일은 이미 저장된 뒤에 부른다).
  async function rememberSaved(doc, bytes, kind){
    if (typeof recoverySnapshotFile !== "function" || typeof rememberWorkspace !== "function") return false;
    try {
      const mime = officeReplaceMime(kind);
      const snapshot = recoverySnapshotFile(doc, new Blob([bytes], { type: mime }), mime);
      if (!snapshot) return false;
      return (await rememberWorkspace([snapshot], false, { silent: true })) === true;
    } catch(e){ console.warn("복원 묶음 갱신 실패:", e); return false; }
  }

  return { read, compute, preview, build, saveDocument, saveResultText, reflectSaved, rememberSaved,
    isBrowser, kindOf: officeReplaceKindOf, mimeOf: officeReplaceMime };
})();

if (typeof module === "object" && module.exports){
  module.exports = {
    OFFICE_REPLACE_MAX_BYTES, DOCX_MIME, PPTX_MIME, officeReplaceKindOf, officeReplaceMime,
    officeReplaceDecode, officeReplaceEscape, officeBalancedRanges, officeParagraphRanges,
    officeTextboxRanges, officeSkipRanges, officeParagraphModel,
    officeExpandReplacement, officeOpenTagFor, officeApplyRangesToSegments, officePlanParagraphEdits,
    officeParagraphTextEdits, officeInlineTextKey, officeInlineMapVerify, officeParagraphMarkerPlan,
    officeTableOutline, officeBlankTableCellXml, officeBlankTableRowXml, officeTableStructureEdit,
    officeTableCellFormat, officeTableFormatEdit, officeParagraphTextFormat, officeParagraphFormatEdit,
    officeParagraphOutline, officeNewParagraphXml, officeParagraphStructureEdits,
    officeParagraphEditPlan, officeApplyEdits,
    officeReplacePartXml, officeCountMatches, officeCountParagraphMatches, officeCountTextboxMatches,
    officePartRole, officePartLabel, officeSortParts,
    officeTargetParts, officeCountOnlyParts, officeDetectFlags, officeExclusionReason, MNOfficeReplace
  };
}
