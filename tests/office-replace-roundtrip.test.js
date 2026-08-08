const test = require("node:test");
const assert = require("node:assert/strict");

/* zip 왕복 검증 — "바꾼 파트 말고는 아무것도 건드리지 않는다" 를 증명한다.
   zip.js 는 브라우저용이지만 Node 18+ 의 Blob·TextEncoder 만 쓰므로 그대로 올라간다.
   office-replace.js 의 브라우저 블록은 전역 zip 을 찾으므로 require 전에 심어 둔다. */
global.zip = require("../vendor/zip-full.min.js");
const { MNOfficeReplace, officePartLabel } = require("../src/js/office-replace.js");

const plain = (query) => ({ pattern: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags: "gi", regex: false });

const DOC_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>20</w:t></w:r><w:r><w:t>25학년도 계획</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>2025년 1학기</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  "</w:body></w:document>";
const HEADER_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:p><w:r><w:t>2025 만능초등학교</w:t></w:r></w:p></w:hdr>";
const COMMENTS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:comment w:id="1"><w:p><w:r><w:t>2025 확인 바랍니다</w:t></w:r></w:p></w:comment></w:comments>';
const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles/>';
const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

// 최소한의 docx 하나를 메모리에 만든다(스타일·표·머리말·메모·이미지 포함).
async function makeDocx(){
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
  await writer.add("[Content_Types].xml", new zip.TextReader("<Types/>"));
  await writer.add("word/document.xml", new zip.TextReader(DOC_XML));
  await writer.add("word/styles.xml", new zip.TextReader(STYLES_XML));
  await writer.add("word/header1.xml", new zip.TextReader(HEADER_XML));
  await writer.add("word/comments.xml", new zip.TextReader(COMMENTS_XML));
  await writer.add("word/media/image1.png", new zip.BlobReader(new Blob([IMAGE_BYTES])));
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}

// 압축을 풀어 경로 → 바이트로. 엔트리 내용이 실제로 같은지 비교하는 데 쓴다.
async function readAll(bytes){
  const reader = new zip.ZipReader(new zip.BlobReader(new Blob([bytes])));
  const out = new Map();
  for (const entry of await reader.getEntries()){
    if (entry.directory) continue;
    const blob = await entry.getData(new zip.BlobWriter());
    out.set(entry.filename, Buffer.from(await blob.arrayBuffer()));
  }
  await reader.close();
  return out;
}

const textOf = (map, path) => map.get(path).toString("utf8");

test("설정 끔 — 본문만 바뀌고 나머지 엔트리는 바이트까지 그대로다", async () => {
  const original = await makeDocx();
  const before = await readAll(original);
  const preview = await MNOfficeReplace.preview(new Blob([original]), "docx", plain("2025"), "2026", { includeAttached: false });

  assert.equal(preview.reason, undefined);
  assert.equal(preview.count, 2);                       // 본문 2곳(제목 + 표 셀)
  assert.deepEqual(preview.outside, [{ label: "머리말", count: 1 }, { label: "메모", count: 1 }]);

  const after = await readAll(await MNOfficeReplace.build(original, preview.replaced));
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const path of before.keys()){
    if (path === "word/document.xml") continue;
    assert.deepEqual(after.get(path), before.get(path), path + " 이 바뀌었다");
  }
  const doc = textOf(after, "word/document.xml");
  assert.match(doc, /<w:rPr><w:b\/><\/w:rPr><w:t>2026<\/w:t>/);   // 굵게 유지
  assert.match(doc, /<w:t>2026년 1학기<\/w:t>/);                  // 표 셀도 바뀜
  assert.match(doc, /<w:pStyle w:val="Title"\/>/);                // 스타일 그대로
  assert.equal(doc.includes("2025"), false);
});

test("설정 켬 — 머리말까지 바뀌지만 메모와 스타일·이미지는 그대로다", async () => {
  const original = await makeDocx();
  const before = await readAll(original);
  const preview = await MNOfficeReplace.preview(new Blob([original]), "docx", plain("2025"), "2026", { includeAttached: true });

  assert.equal(preview.count, 3);                       // 본문 2 + 머리말 1
  assert.deepEqual(preview.outside, [{ label: "메모", count: 1 }]);
  assert.deepEqual(preview.changes.map(c => c.label), ["문단", "문단", "머리말"]);

  const after = await readAll(await MNOfficeReplace.build(original, preview.replaced));
  assert.match(textOf(after, "word/header1.xml"), /<w:t>2026 만능초등학교<\/w:t>/);
  assert.match(textOf(after, "word/comments.xml"), /<w:t>2025 확인 바랍니다<\/w:t>/);   // 메모는 손대지 않는다
  assert.deepEqual(after.get("word/media/image1.png"), before.get("word/media/image1.png"));
  assert.deepEqual(after.get("word/styles.xml"), before.get("word/styles.xml"));
});

test("바꿀 게 없으면 아무 파트도 갈아끼우지 않는다", async () => {
  const original = await makeDocx();
  const before = await readAll(original);
  const preview = await MNOfficeReplace.preview(new Blob([original]), "docx", plain("없는말"), "X", { includeAttached: true });
  assert.equal(preview.count, 0);
  assert.deepEqual(preview.replaced, {});
  const after = await readAll(await MNOfficeReplace.build(original, preview.replaced));
  for (const path of before.keys()) assert.deepEqual(after.get(path), before.get(path), path);
});

test("read 한 번으로 여러 번 compute 한다 — zip 을 다시 풀지 않는다", async () => {
  const original = await makeDocx();
  const opts = { includeAttached: true };
  const source = await MNOfficeReplace.read(new Blob([original]), "docx", opts);
  const first = MNOfficeReplace.compute(source, plain("2025"), "2026", opts);
  const again = MNOfficeReplace.compute(source, plain("2025"), "2027", opts);
  assert.equal(again.count, first.count);
  assert.match(first.replaced["word/document.xml"], /<w:t>2026<\/w:t>/);
  assert.match(again.replaced["word/document.xml"], /<w:t>2027<\/w:t>/);
  assert.match(again.replaced["word/header1.xml"], /2027 만능초등학교/);
});

test("찾을 말이 바뀌면 '개수만 세는' 파트의 숫자도 함께 다시 센다", async () => {
  const original = await makeDocx();
  const opts = { includeAttached: false };
  const source = await MNOfficeReplace.read(new Blob([original]), "docx", opts);
  assert.deepEqual(MNOfficeReplace.compute(source, plain("2025"), "X", opts).outside,
    [{ label: "머리말", count: 1 }, { label: "메모", count: 1 }]);
  assert.deepEqual(MNOfficeReplace.compute(source, plain("확인"), "X", opts).outside,
    [{ label: "메모", count: 1 }]);
});

test("변경 이력이 있으면 기본값에서 제외되고, 설정을 켜면 통과한다", async () => {
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
  await writer.add("word/document.xml", new zip.TextReader(
    '<w:document xmlns:w="x"><w:body><w:p><w:ins w:id="1"><w:r><w:t>2025</w:t></w:r></w:ins></w:p></w:body></w:document>'));
  const blob = await writer.close();
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const blocked = await MNOfficeReplace.preview(new Blob([bytes]), "docx", plain("2025"), "2026", {});
  assert.match(blocked.reason, /변경 내용 추적/);

  const allowed = await MNOfficeReplace.preview(new Blob([bytes]), "docx", plain("2025"), "2026", { allowTrackedChanges: true });
  assert.equal(allowed.reason, undefined);
  assert.equal(allowed.count, 1);
  assert.equal(allowed.hasTrackedChanges, true);
});

test("word/document.xml 이 없으면 Word 문서로 보지 않는다", async () => {
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
  await writer.add("hello.txt", new zip.TextReader("안녕"));
  const blob = await writer.close();
  const preview = await MNOfficeReplace.preview(new Blob([new Uint8Array(await blob.arrayBuffer())]), "docx", plain("가"), "나", {});
  assert.match(preview.reason, /구조가 아니에요/);
});

test("파트 이름표는 미리보기 줄에 그대로 실린다", () => {
  assert.equal(officePartLabel("word/header1.xml", "docx").label, "머리말");
});

/* ---------- PowerPoint ---------- */

const slideXml = (body) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
  body + "</p:spTree></p:cSld></p:sld>";
const NOTES_XML = slideXml('<p:sp><p:txBody><a:p><a:r><a:t>2025 발표 순서 확인</a:t></a:r></a:p></p:txBody></p:sp>');
const LAYOUT_XML = '<p:sldLayout xmlns:a="x"><a:p><a:r><a:t>2025 제목을 입력하십시오</a:t></a:r></a:p></p:sldLayout>';

// 슬라이드 2장 + 발표자 노트 + 레이아웃 + 이미지가 든 최소 pptx.
async function makePptx(){
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
  await writer.add("[Content_Types].xml", new zip.TextReader("<Types/>"));
  await writer.add("ppt/presentation.xml", new zip.TextReader("<p:presentation/>"));
  await writer.add("ppt/slides/slide1.xml", new zip.TextReader(slideXml(
    '<p:sp><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>20</a:t></a:r><a:r><a:t>25학년도 계획</a:t></a:r></a:p></p:txBody></p:sp>')));
  await writer.add("ppt/slides/slide2.xml", new zip.TextReader(slideXml(
    '<p:sp><p:txBody><a:p><a:r><a:t>2025년 목표</a:t></a:r></a:p></p:txBody></p:sp>')));
  await writer.add("ppt/notesSlides/notesSlide1.xml", new zip.TextReader(NOTES_XML));
  await writer.add("ppt/slideLayouts/slideLayout1.xml", new zip.TextReader(LAYOUT_XML));
  await writer.add("ppt/media/image1.png", new zip.BlobReader(new Blob([IMAGE_BYTES])));
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}

test("PPTX 설정 끔 — 슬라이드만 바뀌고 노트·레이아웃·이미지는 그대로다", async () => {
  const original = await makePptx();
  const before = await readAll(original);
  const preview = await MNOfficeReplace.preview(new Blob([original]), "pptx", plain("2025"), "2026", { includeAttached: false });

  assert.equal(preview.reason, undefined);
  assert.equal(preview.count, 2);                       // 슬라이드 2장에 한 곳씩
  assert.deepEqual(preview.changes.map(c => c.label), ["슬라이드 1", "슬라이드 2"]);
  assert.equal(preview.changes.every(c => c.numbered === false), true);
  assert.deepEqual(preview.outside, [{ label: "노트 1", count: 1 }]);

  const after = await readAll(await MNOfficeReplace.build(original, preview.replaced));
  for (const path of before.keys()){
    if (path === "ppt/slides/slide1.xml" || path === "ppt/slides/slide2.xml") continue;
    assert.deepEqual(after.get(path), before.get(path), path + " 이 바뀌었다");
  }
  assert.match(textOf(after, "ppt/slides/slide1.xml"), /<a:rPr b="1"\/><a:t>2026<\/a:t>/);   // 굵게 유지
  assert.match(textOf(after, "ppt/slides/slide2.xml"), /<a:t>2026년 목표<\/a:t>/);
});

test("PPTX 설정 켬 — 발표자 노트까지 바뀌지만 레이아웃 안내문은 세지도 않는다", async () => {
  const original = await makePptx();
  const preview = await MNOfficeReplace.preview(new Blob([original]), "pptx", plain("2025"), "2026", { includeAttached: true });
  assert.equal(preview.count, 3);                       // 슬라이드 2 + 노트 1
  assert.deepEqual(preview.outside, []);                // 레이아웃의 "2025 제목을 입력하십시오" 는 화면에 보이는 글이 아니다
  const after = await readAll(await MNOfficeReplace.build(original, preview.replaced));
  assert.match(textOf(after, "ppt/notesSlides/notesSlide1.xml"), /<a:t>2026 발표 순서 확인<\/a:t>/);
  assert.match(textOf(after, "ppt/slideLayouts/slideLayout1.xml"), /2025 제목을 입력하십시오/);
});

test("슬라이드가 하나도 없으면 PowerPoint 문서로 보지 않는다", async () => {
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
  await writer.add("ppt/presentation.xml", new zip.TextReader("<p:presentation/>"));
  const blob = await writer.close();
  const preview = await MNOfficeReplace.preview(new Blob([new Uint8Array(await blob.arrayBuffer())]), "pptx", plain("가"), "나", {});
  assert.match(preview.reason, /PowerPoint 문서 구조가 아니에요/);
});

/* ---------- 문단 편집 왕복 (Phase 2) ---------- */

test("문단을 고치고 더하고 지워도 나머지 엔트리는 바이트까지 그대로다", async () => {
  const { officeParagraphOutline, officeParagraphModel, officeParagraphTextEdits,
    officeNewParagraphXml, officeParagraphStructureEdits, officeApplyEdits } = require("../src/js/office-replace.js");

  const original = await makeDocx();
  const before = await readAll(original);
  const source = await MNOfficeReplace.read(new Blob([original]), "docx", {});
  const xml = source.parts["word/document.xml"];

  const outline = officeParagraphOutline(xml);
  assert.equal(outline.length, 2);                      // 제목 문단 + 표 셀 문단

  const edits = [];
  const first = officeParagraphModel(xml.slice(outline[0].start, outline[0].end), outline[0].start);
  for (const e of officeParagraphTextEdits(first, "2025학년도 계획서").edits) edits.push(e);
  const struct = officeParagraphStructureEdits(outline, [],
    [{ afterIndex: 1, xml: officeNewParagraphXml(xml.slice(outline[0].start, outline[0].end), "덧붙인 문단") }]);
  for (const e of struct.edits) edits.push(e);

  const nextXml = officeApplyEdits(xml, edits);
  const after = await readAll(await MNOfficeReplace.build(original, { "word/document.xml": nextXml }));

  for (const path of before.keys()){
    if (path === "word/document.xml") continue;
    assert.deepEqual(after.get(path), before.get(path), path + " 이 바뀌었다");
  }
  const doc = textOf(after, "word/document.xml");
  assert.match(doc, /<w:t>25학년도 계획서<\/w:t>/);      // 끝 조각만 늘었다("서" 한 글자)
  assert.match(doc, /<w:rPr><w:b\/><\/w:rPr><w:t>20<\/w:t>/);   // 앞 조각은 굵게 그대로
  assert.match(doc, /<w:t>덧붙인 문단<\/w:t>/);
  assert.match(doc, /<w:pStyle w:val="Title"\/>[\s\S]*<w:pStyle w:val="Title"\/>/);   // 새 문단이 스타일을 물려받았다
  assert.match(doc, /<w:t>2025년 1학기<\/w:t>/);          // 표 셀은 손 안 댐
});

test("표 행을 추가해 저장해도 document.xml 밖의 엔트리는 바이트까지 그대로다", async () => {
  const { officeTableStructureEdit } = require("../src/js/office-replace.js");
  const original = await makeDocx();
  const before = await readAll(original);
  const source = await MNOfficeReplace.read(new Blob([original]), "docx", {});
  const result = officeTableStructureEdit(source.parts["word/document.xml"],
    { kind: "row-add-below", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);

  const after = await readAll(await MNOfficeReplace.build(original, { "word/document.xml": result.xml }));
  for (const path of before.keys()){
    if (path === "word/document.xml") continue;
    assert.deepEqual(after.get(path), before.get(path), path + " 이 바뀌었다");
  }
  assert.equal((textOf(after, "word/document.xml").match(/<w:tr>/g) || []).length, 2);
  assert.match(textOf(after, "word/document.xml"), /<w:tr><w:tc><w:p><\/w:p><\/w:tc><\/w:tr>/);
});
