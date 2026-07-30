/* 테스트용 최소 PDF 생성기 — 단위 테스트와 e2e 가 함께 쓴다.
 *
 * 왜: PDF 를 여는 화면(찾기·페이지 이동·서명 등)을 자동으로 확인하려면 "실제로 열리는 PDF" 가 있어야 하는데,
 *     PDF 는 바이너리 규격이라 Buffer.from("아무 글자") 로는 만들 수 없다. 그렇다고 진짜 PDF 파일을
 *     저장소에 커밋하면 바이너리가 쌓이고, 안에 무슨 글자가 있는지 테스트만 봐서는 알 수 없다.
 *     그래서 .doc 픽스처(build-doc.js)와 같은 방식으로 필요한 최소 구조만 코드로 조립한다.
 *
 * 구조: 카탈로그 → 페이지 묶음 → 페이지들 → 글꼴(Helvetica, 내장 없이 쓰는 표준 14종) → 페이지별 본문 스트림.
 *     본문은 BT/Tf/Td/Tj/ET 만 쓴다 — pdf.js 가 글자를 뽑아낼 수 있어야 '찾기'가 실제로 걸린다.
 *     글꼴을 내장하지 않으므로 본문은 ASCII 만 넣는다(한글을 쓰려면 CID 글꼴 내장이 필요해 훨씬 커진다).
 */

const PAGE_W = 595, PAGE_H = 842;      // A4(포인트)
const FONT_SIZE = 24, LINE_H = 32, MARGIN_X = 72, TOP_Y = 760;

// PDF 문자열 리터럴에서 특별한 뜻을 갖는 세 글자를 막는다.
const escapeText = (value) => String(value).replace(/([\\()])/g, "\\$1");

function contentStream(lines){
  const body = lines.map((line, index) =>
    `BT /F1 ${FONT_SIZE} Tf ${MARGIN_X} ${TOP_Y - index * LINE_H} Td (${escapeText(line)}) Tj ET`
  ).join("\n");
  return body + "\n";
}

/* pages: 페이지별 줄 목록. 예) [["hello", "world"], ["second page"]]
   문자열 배열 하나만 주면 한 페이지짜리로 본다. 반환: Buffer(.pdf 내용) */
function buildPdf(pages){
  const sheets = Array.isArray(pages) && Array.isArray(pages[0]) ? pages
    : [Array.isArray(pages) ? pages : [String(pages == null ? "" : pages)]];

  // 객체 번호: 1=카탈로그, 2=페이지 묶음, 3=글꼴, 그 뒤로 페이지·본문이 번갈아 온다.
  const pageObjNum = (i) => 4 + i * 2;
  const contentObjNum = (i) => 5 + i * 2;
  const kids = sheets.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");

  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[${kids}]/Count ${sheets.length}>>`,
    `<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>`
  ];
  sheets.forEach((lines, i) => {
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]` +
      `/Resources<</Font<</F1 3 0 R>>>>/Contents ${contentObjNum(i)} 0 R>>`
    );
    const stream = contentStream(lines);
    objects.push(`<</Length ${Buffer.byteLength(stream, "latin1")}>>\nstream\n${stream}endstream`);
  });

  // 본문을 이어 붙이면서 각 객체가 파일 어디서 시작하는지 적어 둔다(xref 표에 그대로 들어간다).
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "latin1");
    chunks.push(chunk);
    offset += chunk.length;
  });

  // xref 항목은 반드시 한 줄 20바이트여야 한다(10자리 위치 + 5자리 세대 + 표시 + 개행 2칸).
  const entry = (position, generation, kind) =>
    String(position).padStart(10, "0") + " " + String(generation).padStart(5, "0") + " " + kind + " \n";
  const xref = "xref\n0 " + (objects.length + 1) + "\n" +
    entry(0, 65535, "f") + offsets.map((position) => entry(position, 0, "n")).join("");
  chunks.push(Buffer.from(
    xref + `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));

  return Buffer.concat(chunks);
}

module.exports = { buildPdf };
