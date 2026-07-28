const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

/* office-doc-viewers.js 의 .doc 파서는 DOM 을 쓰지 않는 순수 함수라 그대로 꺼내 돌린다.
   화면 렌더(renderDocLegacy)만 브라우저 전역을 쓰므로 여기서는 부르지 않는다. */
function smartDecodeText(bytes){
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch(_){
    try { return new TextDecoder("euc-kr").decode(bytes); }
    catch(__){ return new TextDecoder("utf-8").decode(bytes); }
  }
}
const viewerSrc = read("src/js/office-doc-viewers.js");
const doc = new Function("smartDecodeText", viewerSrc + `
  return { cfbReadStreams, docLegacyTextFromCfb, docCleanText, docLegacyTextOf,
           docTextFromRtf, docLooksZip, docLooksCfb, docLooksRtf, docLegacyKindOf };
`)(smartDecodeText);

const { buildWordDoc } = require("./fixtures/build-doc");

test(".doc(Word 97) 조각표에서 유니코드 본문을 문단으로 뽑는다", () => {
  const bytes = buildWordDoc({ text: "만능파일교실\r한글 본문입니다\r" });
  const out = doc.docLegacyTextOf(bytes);
  assert.deepEqual(out.split("\n").filter(l => l.trim()), ["만능파일교실", "한글 본문입니다"]);
});

test(".doc 압축 조각(1바이트 CP1252)도 읽는다", () => {
  const bytes = buildWordDoc({ text: "Hello world\rSecond line\r", compressed: true });
  const out = doc.docLegacyTextOf(bytes);
  assert.deepEqual(out.split("\n").filter(l => l.trim()), ["Hello world", "Second line"]);
});

test(".doc 표의 셀 끝(0x07)은 문단 구분으로 바뀐다", () => {
  const bytes = buildWordDoc({ text: "머리1값가\r" });
  assert.deepEqual(doc.docLegacyTextOf(bytes).split("\n").filter(l => l.trim()), ["머리1", "값가"]);
});

test("암호로 보호된 .doc 은 doc-encrypted 로 구분해 알린다", () => {
  const bytes = buildWordDoc({ text: "secret\r", encrypted: true });
  assert.throws(() => doc.docLegacyTextOf(bytes), /doc-encrypted/);
});

test("Word 문서가 아닌 파일은 doc-not-cfb 로 걸러진다", () => {
  assert.throws(() => doc.docLegacyTextOf(new Uint8Array(Buffer.from("A1 20 A0 D5 2E 12".repeat(100)))), /doc-not-cfb/);
});

test("docCleanText: 필드 코드는 버리고 결과만, 제어문자는 줄바꿈으로", () => {
  // 0x13 필드 시작 · 0x14 구분자(뒤가 화면에 보이는 결과) · 0x15 필드 끝 · 0x0D 문단 끝 · 0x0B 줄바꿈
  const C = (n) => String.fromCharCode(n);
  const raw = "앞" + C(0x13) + 'HYPERLINK "http://x"' + C(0x14) + "보이는글자" + C(0x15) + C(0x0D) + "뒤" + C(0x0B) + "줄바꿈";
  const NL = C(10);
  assert.equal(doc.docCleanText(raw), "앞보이는글자" + NL + "뒤" + NL + "줄바꿈");
});

test("이름만 .doc 인 RTF: 글꼴표를 본문으로 착각하지 않고 한글을 살린다", () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg949{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1 \\'b8\\'ed\\'c1\\'six;}}" +
              "{\\*\\generator Riched20 10.0;}\\f0 \\'c7\\'d1\\'b1\\'db RTF\\par \\u44032 ?\\u45208 ?\\par }";
  const out = doc.docTextFromRtf(rtf);
  assert.match(out, /한글 RTF/);            // \'hh 연속 바이트를 CP949 로 묶어 디코드
  assert.match(out, /가나/);                 // \uN 유니코드 + 대체문자(?) 건너뛰기
  assert.doesNotMatch(out, /Times New Roman/);
  assert.doesNotMatch(out, /Riched20/);
});

test("확장자 .doc 의 실제 갈래를 앞부분 바이트로 가른다", () => {
  assert.equal(doc.docLegacyKindOf(new Uint8Array([0x50, 0x4B, 3, 4, 0, 0, 0, 0])), "docx");
  assert.equal(doc.docLegacyKindOf(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])), "doc");
  assert.equal(doc.docLegacyKindOf(new Uint8Array(Buffer.from("{\\rtf1\\ansi"))), "doc");
  assert.equal(doc.docLegacyKindOf(new Uint8Array(Buffer.from("A1 20 A0 D5"))), "text");
});

/* ===== 접점 배선 ===== */
const loaders = read("src/js/file-loaders.js");
const viewerBase = read("src/js/viewer-base.js");
const documents = read("src/js/documents.js");

test(".doc 은 내용을 보고 docx·doc·텍스트 통로로 나뉘어 열린다", () => {
  assert.match(loaders, /const kind = docLegacyKindOf\(head\)/);
  assert.match(loaders, /if \(kind === "text"\) made = await loadText\(file, opts\)/);
  assert.match(loaders, /kind === "docx" \? "docx" : "doc"/);
  assert.match(viewerBase, /else if \(ext === "doc"\)\s+await renderDocLegacy\(source, host, doc\)/);
});

test(".doc 은 열지 않아도 통합 검색 대상이고, 이름만 .doc 인 텍스트는 텍스트 통로가 맡는다", () => {
  assert.match(documents, /if \(ext === "doc"\) return !doc\.isTextFile && \(doc\.size \|\| 0\) <= OFFICE_SEARCH_MAX_BYTES/);
  assert.match(documents, /const t = await docLegacyExtractText\(doc\.sourceFile\)/);
  assert.match(documents, /if \(t === null\) ext = "docx"/);
  assert.match(documents, /let ext = fileExtOf\(String\(doc\.name \|\| ""\)\.toLowerCase\(\)\)/);
});

test("'탐색기에서 보기'는 디스크에 실제 파일이 있을 때만 만들어진다", () => {
  assert.match(viewerSrc, /const rel = doc && doc\.workspacePath \? String\(doc\.workspacePath\) : ""/);
  assert.match(viewerSrc, /if \(!rel\) return null/);
  // 브라우저 단독·Go 폴백 런처에서는 눌러도 실패하므로 저장 백엔드 유무까지 확인한다.
  assert.match(viewerSrc, /if \(!\(await saveFileBackendAvailable\(\)\)\) return null/);
  assert.match(viewerSrc, /const openBtn = await docExplorerButton\(doc\)/);
  assert.match(viewerSrc, /"X-Save-Path": encodeURIComponent\(rel\)/);
});
