const test = require("node:test");
const assert = require("node:assert/strict");

// 순수 코어만 검증한다. 브라우저 블록(zip·저장)은 window 가 없어 아무 일도 하지 않는다.
const api = require("../src/js/office-replace.js");

const plain = (query) => ({ pattern: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags: "gi", regex: false });
const rx = (pattern, flags) => ({ pattern, flags: flags || "g", regex: true });
const para = (inner) => "<w:p>" + inner + "</w:p>";
const run = (text, props) => "<w:r>" + (props || "") + "<w:t>" + text + "</w:t></w:r>";

/* ---------- 쪼개진 run 을 넘나드는 찾기 (이 기능의 존재 이유) ---------- */

test("한 낱말이 run 3개로 쪼개져 있어도 찾아 바꾼다", () => {
  const xml = para(run("20") + run("25") + run("학년도"));
  const result = api.officeReplacePartXml(xml, plain("2025"), "2026");
  assert.equal(result.count, 1);
  assert.match(result.out, /<w:t>2026<\/w:t>/);
  assert.match(result.out, /<w:t><\/w:t>/);          // 겹친 나머지 조각은 비워 둔다
  assert.match(result.out, /<w:t>학년도<\/w:t>/);      // 손 안 댄 조각은 그대로
});

test("치환문은 첫 조각에 들어가고 나머지 run 의 서식은 남는다", () => {
  const xml = para(run("20", "<w:rPr><w:b/></w:rPr>") + run("25년"));
  const result = api.officeReplacePartXml(xml, plain("2025"), "2026");
  assert.equal(result.count, 1);
  assert.match(result.out, /<w:rPr><w:b\/><\/w:rPr><w:t>2026<\/w:t>/);   // 굵게가 그대로 붙어 있다
  assert.match(result.out, /<w:t>년<\/w:t>/);                            // 둘째 run 은 겹친 부분만 사라진다
});

test("한 조각 안에서 일치가 여러 번이면 모두 바뀐다", () => {
  const xml = para(run("가 가 가"));
  const result = api.officeReplacePartXml(xml, plain("가"), "나");
  assert.equal(result.count, 3);
  assert.match(result.out, /<w:t>나 나 나<\/w:t>/);
});

/* ---------- XML 로 되쓸 때의 규칙 ---------- */

test("앞뒤 공백이 생기면 xml:space=preserve 를 붙인다", () => {
  const xml = para(run("가"));
  const result = api.officeReplacePartXml(xml, plain("가"), " 나 ");
  assert.match(result.out, /<w:t xml:space="preserve"> 나 <\/w:t>/);
});

test("이미 xml:space 가 있으면 두 번 붙이지 않는다", () => {
  const xml = para('<w:r><w:t xml:space="preserve"> 가 </w:t></w:r>');
  const result = api.officeReplacePartXml(xml, plain("가"), "나");
  assert.equal((result.out.match(/xml:space/g) || []).length, 1);
  assert.match(result.out, /<w:t xml:space="preserve"> 나 <\/w:t>/);
});

test("공백이 없으면 xml:space 를 붙이지 않는다", () => {
  const result = api.officeReplacePartXml(para(run("가")), plain("가"), "나");
  assert.equal(result.out.includes("xml:space"), false);
});

test("치환문의 & < > 는 이스케이프되어 XML 이 깨지지 않는다", () => {
  const result = api.officeReplacePartXml(para(run("X")), plain("X"), "A&B<C>");
  assert.match(result.out, /<w:t>A&amp;B&lt;C&gt;<\/w:t>/);
});

test("손대지 않은 조각의 엔티티는 원문 그대로 남는다", () => {
  const xml = para(run("A&amp;B") + run("바꿀것"));
  const result = api.officeReplacePartXml(xml, plain("바꿀것"), "바뀐것");
  assert.match(result.out, /<w:t>A&amp;B<\/w:t>/);     // 정규화되지 않는다
});

test("바꾼 조각의 엔티티는 디코드 후 다시 이스케이프된다", () => {
  const xml = para(run("A&amp;B"));
  const result = api.officeReplacePartXml(xml, plain("B"), "C");
  assert.match(result.out, /<w:t>A&amp;C<\/w:t>/);
});

/* ---------- 찾기 옵션 ---------- */

test("정규식 그룹 $1 을 편다", () => {
  const result = api.officeReplacePartXml(para(run("3년 5년")), rx("(\\d+)년"), "$1학년");
  assert.equal(result.count, 2);
  assert.match(result.out, /<w:t>3학년 5학년<\/w:t>/);
});

test("일반 모드에서 $ 는 그냥 글자다", () => {
  const result = api.officeReplacePartXml(para(run("값")), plain("값"), "$1");
  assert.match(result.out, /<w:t>\$1<\/w:t>/);
});

test("$$ 는 $ 하나로, $& 는 일치한 글자로 편다", () => {
  const result = api.officeReplacePartXml(para(run("금액")), rx("금액"), "$$[$&]");
  assert.match(result.out, /<w:t>\$\[금액\]<\/w:t>/);
});

test("대소문자 구분 옵션이 flags 로 전달된다", () => {
  const insensitive = { pattern: "cat", flags: "gi", regex: false };
  const sensitive = { pattern: "cat", flags: "g", regex: false };
  assert.equal(api.officeReplacePartXml(para(run("Cat cat CAT")), insensitive, "dog").count, 3);
  assert.equal(api.officeReplacePartXml(para(run("Cat cat CAT")), sensitive, "dog").count, 1);
});

/* ---------- 바꿀 수 없는 자리 ---------- */

test("탭을 넘나드는 일치는 건너뛰고 skipped 로 센다", () => {
  const xml = para("<w:r><w:t>가</w:t><w:tab/><w:t>나</w:t></w:r>");
  const result = api.officeReplacePartXml(xml, rx("가\\t나"), "다");
  assert.equal(result.count, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.out, xml);                       // 글자 하나 안 바뀐다
});

test("줄바꿈(<w:br/>)도 같은 규칙으로 건너뛴다", () => {
  const xml = para("<w:r><w:t>가</w:t><w:br/><w:t>나</w:t></w:r>");
  const result = api.officeReplacePartXml(xml, rx("가\\n나"), "다");
  assert.equal(result.count, 0);
  assert.equal(result.skipped, 1);
});

test("탭 옆 글자는 정상적으로 바뀐다", () => {
  const xml = para("<w:r><w:t>가</w:t><w:tab/><w:t>나</w:t></w:r>");
  const result = api.officeReplacePartXml(xml, plain("나"), "다");
  assert.equal(result.count, 1);
  assert.match(result.out, /<w:t>다<\/w:t>/);
});

/* ---------- 문단·태그 구분 ---------- */

test("문단 번호는 표 셀 안 문단까지 순서대로 매긴다", () => {
  const xml = "<w:body>" + para(run("가")) +
    "<w:tbl><w:tr><w:tc>" + para(run("가")) + "</w:tc></w:tr></w:tbl>" +
    para(run("가")) + "</w:body>";
  const result = api.officeReplacePartXml(xml, plain("가"), "나");
  assert.equal(result.count, 3);
  assert.deepEqual(result.changes.map(c => c.para), [1, 2, 3]);
});

test("pPr 의 탭 정의(<w:tab w:pos>)를 본문 탭으로 세지 않는다", () => {
  const xml = para('<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' + run("가나"));
  const model = api.officeParagraphModel(xml, 0);
  assert.equal(model.text, "가나");                     // 없는 탭이 끼어들지 않는다
  assert.equal(api.officeReplacePartXml(xml, plain("가나"), "다라").count, 1);
});

test("<w:pPr>·<w:tbl>·<w:tc>·<w:tabs> 는 문단·글자 태그로 오인되지 않는다", () => {
  const xml = "<w:tbl><w:tr><w:tc><w:tcPr/>" + para("<w:pPr/>" + run("값")) + "</w:tc></w:tr></w:tbl>";
  const result = api.officeReplacePartXml(xml, plain("값"), "새값");
  assert.equal(result.count, 1);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].before, "값");
});

test("일치가 없으면 원본 문자열을 글자 하나 안 바꾸고 돌려준다", () => {
  const xml = para(run("가나다"));
  const result = api.officeReplacePartXml(xml, plain("없는말"), "X");
  assert.equal(result.count, 0);
  assert.equal(result.out, xml);
  assert.equal(result.changes.length, 0);
});

test("미리보기 before/after 는 문단 평문이다", () => {
  const xml = para(run("20") + run("25학년도"));
  const result = api.officeReplacePartXml(xml, plain("2025"), "2026");
  assert.equal(result.changes[0].before, "2025학년도");
  assert.equal(result.changes[0].after, "2026학년도");
  assert.equal(result.changes[0].count, 1);
});

/* ---------- 개수만 세기 ---------- */

test("officeCountMatches 는 바꾸지 않고 개수만 센다", () => {
  const xml = para(run("가 가")) + para(run("가"));
  assert.equal(api.officeCountMatches(xml, plain("가")), 3);
});

/* ---------- 파트 갈래 ---------- */

test("Word 파트를 제 갈래로 나눈다", () => {
  assert.equal(api.officePartRole("word/document.xml", "docx"), "body");
  assert.equal(api.officePartRole("word/header1.xml", "docx"), "attached");
  assert.equal(api.officePartRole("word/footer2.xml", "docx"), "attached");
  assert.equal(api.officePartRole("word/footnotes.xml", "docx"), "attached");
  assert.equal(api.officePartRole("word/endnotes.xml", "docx"), "attached");
  assert.equal(api.officePartRole("word/comments.xml", "docx"), "countOnly");
  assert.equal(api.officePartRole("word/styles.xml", "docx"), null);
  assert.equal(api.officePartRole("word/media/image1.png", "docx"), null);
});

test("PowerPoint 파트를 제 갈래로 나눈다 — 마스터·레이아웃은 아예 보지 않는다", () => {
  assert.equal(api.officePartRole("ppt/slides/slide1.xml", "pptx"), "body");
  assert.equal(api.officePartRole("ppt/notesSlides/notesSlide1.xml", "pptx"), "attached");
  assert.equal(api.officePartRole("ppt/comments/comment1.xml", "pptx"), "countOnly");
  assert.equal(api.officePartRole("ppt/charts/chart1.xml", "pptx"), "countOnly");
  assert.equal(api.officePartRole("ppt/diagrams/data1.xml", "pptx"), "countOnly");
  // "제목을 입력하십시오" 는 화면에 보이는 글이 아니라 빈 자리 안내문이라 세지도 않는다.
  assert.equal(api.officePartRole("ppt/slideMasters/slideMaster1.xml", "pptx"), null);
  assert.equal(api.officePartRole("ppt/slideLayouts/slideLayout3.xml", "pptx"), null);
  assert.equal(api.officePartRole("ppt/presentation.xml", "pptx"), null);
  // 형식이 다르면 같은 경로도 갈래가 없다.
  assert.equal(api.officePartRole("ppt/slides/slide1.xml", "docx"), null);
  assert.equal(api.officePartRole("word/document.xml", "pptx"), null);
});

test("설정을 끄면 본문만, 켜면 딸린 글까지 바꾼다 — 메모는 어느 쪽에서도 안 바꾼다", () => {
  const paths = ["word/document.xml", "word/header1.xml", "word/footnotes.xml", "word/comments.xml", "word/styles.xml"];
  assert.deepEqual(api.officeTargetParts(paths, "docx", { includeAttached: false }), ["word/document.xml"]);
  assert.deepEqual(api.officeTargetParts(paths, "docx", { includeAttached: true }),
    ["word/document.xml", "word/footnotes.xml", "word/header1.xml"]);
  assert.equal(api.officeTargetParts(paths, "docx", { includeAttached: true }).includes("word/comments.xml"), false);
});

test("슬라이드는 번호 순서로 정렬한다(slide2 가 slide10 보다 먼저)", () => {
  const paths = ["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/slide1.xml",
    "ppt/notesSlides/notesSlide2.xml", "ppt/slideLayouts/slideLayout1.xml"];
  assert.deepEqual(api.officeTargetParts(paths, "pptx", { includeAttached: false }),
    ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"]);
  assert.deepEqual(api.officeTargetParts(paths, "pptx", { includeAttached: true }),
    ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml", "ppt/notesSlides/notesSlide2.xml"]);
});

test("설정이 꺼졌을 때의 딸린 글과 메모는 '개수만 세는' 쪽으로 간다", () => {
  const paths = ["word/document.xml", "word/header1.xml", "word/comments.xml"];
  // 딸린 글이 먼저, 메모가 나중 — 결과 문구가 읽히는 순서와 같다.
  assert.deepEqual(api.officeCountOnlyParts(paths, "docx", { includeAttached: false }), ["word/header1.xml", "word/comments.xml"]);
  assert.deepEqual(api.officeCountOnlyParts(paths, "docx", { includeAttached: true }), ["word/comments.xml"]);

  const slides = ["ppt/slides/slide1.xml", "ppt/notesSlides/notesSlide1.xml", "ppt/charts/chart1.xml"];
  assert.deepEqual(api.officeCountOnlyParts(slides, "pptx", { includeAttached: false }),
    ["ppt/notesSlides/notesSlide1.xml", "ppt/charts/chart1.xml"]);
  assert.deepEqual(api.officeCountOnlyParts(slides, "pptx", { includeAttached: true }), ["ppt/charts/chart1.xml"]);
});

test("Word 이름표는 문단 번호를 함께 쓰고, PowerPoint 이름표는 번호를 이미 품고 있다", () => {
  assert.deepEqual(api.officePartLabel("word/document.xml", "docx"), { label: "문단", numbered: true });
  assert.deepEqual(api.officePartLabel("word/header3.xml", "docx"), { label: "머리말", numbered: true });
  assert.deepEqual(api.officePartLabel("word/footer1.xml", "docx"), { label: "꼬리말", numbered: true });
  assert.deepEqual(api.officePartLabel("word/footnotes.xml", "docx"), { label: "각주", numbered: true });
  assert.deepEqual(api.officePartLabel("word/endnotes.xml", "docx"), { label: "미주", numbered: true });
  assert.deepEqual(api.officePartLabel("word/comments.xml", "docx"), { label: "메모", numbered: true });
  // "슬라이드 3 · 문단 2" 는 읽는 사람에게 쓸모가 없어 문단 번호를 붙이지 않는다.
  assert.deepEqual(api.officePartLabel("ppt/slides/slide3.xml", "pptx"), { label: "슬라이드 3", numbered: false });
  assert.deepEqual(api.officePartLabel("ppt/notesSlides/notesSlide3.xml", "pptx"), { label: "노트 3", numbered: false });
  assert.deepEqual(api.officePartLabel("ppt/charts/chart1.xml", "pptx"), { label: "차트", numbered: false });
});

test("파일 이름으로 형식을 가른다", () => {
  assert.equal(api.officeReplaceKindOf("안내문.docx"), "docx");
  assert.equal(api.officeReplaceKindOf("수업.PPTX"), "pptx");
  assert.equal(api.officeReplaceKindOf("옛문서.doc"), null);
  assert.equal(api.officeReplaceKindOf("표.xlsx"), null);
  assert.equal(api.officeReplaceKindOf(""), null);
});

/* ---------- PowerPoint 본문 (DrawingML) ---------- */

test("슬라이드의 <a:p>/<a:r>/<a:t> 도 같은 규칙으로 바뀐다", () => {
  const slide = '<p:sp><p:txBody><a:bodyPr/><a:p>' +
    '<a:r><a:rPr lang="ko-KR" b="1"/><a:t>20</a:t></a:r><a:r><a:t>25학년도</a:t></a:r>' +
    "</a:p></p:txBody></p:sp>";
  const result = api.officeReplacePartXml(slide, plain("2025"), "2026");
  assert.equal(result.count, 1);
  assert.match(result.out, /<a:rPr lang="ko-KR" b="1"\/><a:t>2026<\/a:t>/);   // 굵게 유지
  assert.match(result.out, /<a:t>학년도<\/a:t>/);
});

test("<p:pic>·<p:sp>·<a:prstGeom> 은 문단 태그로 오인되지 않는다", () => {
  const slide = '<p:pic><p:spPr><a:prstGeom prst="rect"/></p:spPr></p:pic>' +
    "<p:sp><p:txBody><a:p><a:r><a:t>값</a:t></a:r></a:p></p:txBody></p:sp>";
  const result = api.officeReplacePartXml(slide, plain("값"), "새값");
  assert.equal(result.count, 1);
  assert.equal(result.changes.length, 1);
});

test("슬라이드 번호 필드(<a:fld>) 안 글자는 건드리지 않는다", () => {
  const slide = '<a:p><a:fld id="{x}" type="slidenum"><a:t>3</a:t></a:fld>' +
    "<a:r><a:t>3학년 3반</a:t></a:r></a:p>";
  const result = api.officeReplacePartXml(slide, plain("3"), "4");
  assert.equal(result.count, 2);                       // "3학년 3반" 의 3 두 개만
  assert.match(result.out, /<a:fld id="\{x\}" type="slidenum"><a:t>3<\/a:t><\/a:fld>/);
  assert.match(result.out, /<a:t>4학년 4반<\/a:t>/);
});

test("<a:br/> 를 넘나드는 일치는 슬라이드에서도 건너뛴다", () => {
  const slide = "<a:p><a:r><a:t>가</a:t><a:br/><a:t>나</a:t></a:r></a:p>";
  const result = api.officeReplacePartXml(slide, rx("가\\n나"), "다");
  assert.equal(result.count, 0);
  assert.equal(result.skipped, 1);
});

/* ---------- 제외 규칙 ---------- */

const okInfo = { encrypted: false, size: 1000, hasBody: true, hasTrackedChanges: false, hasDataBinding: false };

test("설정과 무관하게 언제나 제외되는 사유들", () => {
  const on = { allowTrackedChanges: true };
  assert.match(api.officeExclusionReason({ ...okInfo, encrypted: true }, on), /암호/);
  assert.match(api.officeExclusionReason({ ...okInfo, size: 50 * 1024 * 1024 }, on), /너무 커요/);
  assert.match(api.officeExclusionReason({ ...okInfo, hasBody: false }, on), /구조가 아니에요/);
  assert.match(api.officeExclusionReason({ ...okInfo, hasDataBinding: true }, on), /되돌아가요/);
});

test("변경 이력은 설정에 따라 제외되기도, 통과하기도 한다", () => {
  const tracked = { ...okInfo, hasTrackedChanges: true };
  assert.match(api.officeExclusionReason(tracked, { allowTrackedChanges: false }), /변경 내용 추적/);
  assert.equal(api.officeExclusionReason(tracked, { allowTrackedChanges: true }), null);
});

test("멀쩡한 문서는 사유가 없다", () => {
  assert.equal(api.officeExclusionReason(okInfo, {}), null);
});

test("officeDetectFlags 가 변경 이력·데이터 바인딩을 찾아낸다", () => {
  assert.equal(api.officeDetectFlags(para(run("가"))).hasTrackedChanges, false);
  assert.equal(api.officeDetectFlags('<w:ins w:id="1">' + run("가") + "</w:ins>").hasTrackedChanges, true);
  assert.equal(api.officeDetectFlags('<w:del w:id="1"/>').hasTrackedChanges, true);
  assert.equal(api.officeDetectFlags('<w:dataBinding w:xpath="/a"/>').hasDataBinding, true);
});

/* ---------- 문단 편집 (Phase 2) ---------- */

const editText = (xml, newText) => {
  const model = api.officeParagraphModel(xml, 0);
  const plan = api.officeParagraphTextEdits(model, newText);
  return { out: api.officeApplyEdits(xml, plan.edits), plan };
};

test("문단 끝에 글자를 더해도 앞 run 들의 XML 은 글자 하나 안 바뀐다", () => {
  const xml = para(run("2025", "<w:rPr><w:b/></w:rPr>") + run("학년도"));
  const { out, plan } = editText(xml, "2025학년도 계획");
  assert.equal(plan.changed, true);
  assert.match(out, /<w:rPr><w:b\/><\/w:rPr><w:t>2025<\/w:t>/);       // 첫 조각 그대로
  assert.match(out, /<w:t>학년도 계획<\/w:t>/);                        // 마지막 조각만 늘었다
});

test("문단 앞에 글자를 더하면 첫 조각만 바뀐다", () => {
  const xml = para(run("가") + run("나"));
  const { out } = editText(xml, "새가나");
  assert.match(out, /<w:t>새가<\/w:t>/);
  assert.match(out, /<w:t>나<\/w:t>/);
});

test("문단 중간을 고치면 걸친 조각만 바뀐다", () => {
  const xml = para(run("가나") + run("다라") + run("마바"));
  const { out } = editText(xml, "가나XX마바");
  assert.match(out, /<w:t>가나<\/w:t>/);       // 손 안 댐
  assert.match(out, /<w:t>XX<\/w:t>/);         // 걸친 조각만
  assert.match(out, /<w:t>마바<\/w:t>/);       // 손 안 댐
});

test("문단을 통째로 새로 쓰면 첫 조각에 전부 들어가고 나머지는 빈다", () => {
  const xml = para(run("가나") + run("다라"));
  const { out } = editText(xml, "완전히 다른 글");
  assert.match(out, /<w:t>완전히 다른 글<\/w:t>/);
  assert.match(out, /<w:t><\/w:t>/);
});

test("문단을 비우면 모든 조각이 빈다", () => {
  const { out } = editText(para(run("가") + run("나")), "");
  assert.equal((out.match(/<w:t><\/w:t>/g) || []).length, 2);
});

test("고친 글자에 앞뒤 공백이 생기면 xml:space 가 붙는다", () => {
  const { out } = editText(para(run("가")), "가 ");
  assert.match(out, /<w:t xml:space="preserve">가 <\/w:t>/);
});

test("바뀐 게 없으면 편집 목록이 비어 있다", () => {
  const xml = para(run("그대로"));
  const { out, plan } = editText(xml, "그대로");
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.edits, []);
  assert.equal(out, xml);
});

test("탭 자리를 건드리는 편집은 거부되고 이유를 남긴다", () => {
  const xml = para("<w:r><w:t>가</w:t><w:tab/><w:t>나</w:t></w:r>");
  const { out, plan } = editText(xml, "가나");           // 탭을 지우려는 편집
  assert.equal(plan.changed, false);
  assert.equal(plan.skipped, 1);
  assert.equal(out, xml);                                // 글자 하나 안 바뀐다
});

test("탭이 있어도 그 밖 자리 편집은 정상 동작한다", () => {
  const xml = para("<w:r><w:t>가</w:t><w:tab/><w:t>나</w:t></w:r>");
  const { out, plan } = editText(xml, "가\t나다");
  assert.equal(plan.changed, true);
  assert.match(out, /<w:t>나다<\/w:t>/);
});

/* ---------- 문단 목록 ---------- */

const OUTLINE_XML = "<w:body>" +
  '<w:p><w:pPr><w:pStyle w:val="제목1"/></w:pPr>' + run("계획") + "</w:p>" +
  "<w:tbl><w:tr><w:tc>" + para(run("셀 안")) + "</w:tc></w:tr></w:tbl>" +
  para("<w:r><w:t>탭</w:t><w:tab/><w:t>뒤</w:t></w:r>") +
  '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr>' + run("끝") + "</w:p>" +
  "</w:body>";

test("문단 목록이 스타일·표 여부·쪽설정·잠김을 함께 알려준다", () => {
  const outline = api.officeParagraphOutline(OUTLINE_XML);
  assert.equal(outline.length, 4);
  assert.deepEqual(outline.map(p => p.style), ["제목1", "", "", ""]);
  assert.deepEqual(outline.map(p => p.inTable), [false, true, false, false]);
  assert.deepEqual(outline.map(p => p.hasSectPr), [false, false, false, true]);
  assert.deepEqual(outline.map(p => p.locked), [false, false, true, false]);
  assert.equal(outline[2].text, "탭\t뒤");
});

/* ---------- 문단 추가·삭제 ---------- */

test("새 문단은 문단 서식을 물려받되 쪽 설정은 복제하지 않는다", () => {
  const withStyle = '<w:p><w:pPr><w:pStyle w:val="제목1"/></w:pPr>' + run("계획") + "</w:p>";
  const made = api.officeNewParagraphXml(withStyle, "새 줄");
  assert.match(made, /<w:pStyle w:val="제목1"\/>/);       // 스타일은 이어받는다
  assert.match(made, /<w:t>새 줄<\/w:t>/);
  assert.equal(made.includes("계획"), false);             // 원래 글자는 안 따라온다

  const withSect = '<w:p><w:pPr><w:pStyle w:val="본문"/><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr></w:p>';
  const fromSect = api.officeNewParagraphXml(withSect, "");
  assert.match(fromSect, /<w:pStyle w:val="본문"\/>/);
  assert.equal(fromSect.includes("sectPr"), false);       // 쪽 나눔이 하나 더 생기지 않는다
});

test("쪽 설정이 든 문단과 표 안 문단은 지울 수 없다", () => {
  const outline = api.officeParagraphOutline(OUTLINE_XML);
  const plan = api.officeParagraphStructureEdits(outline, [1, 2, 4], []);
  assert.equal(plan.removed, 1);                          // 1번만 지워진다
  assert.deepEqual(plan.refused.map(r => r.index), [2, 4]);
  assert.match(plan.refused[0].reason, /표 안 문단/);
  assert.match(plan.refused[1].reason, /쪽 설정/);
});

test("지운 문단은 XML 에서 통째로 사라진다", () => {
  const outline = api.officeParagraphOutline(OUTLINE_XML);
  const plan = api.officeParagraphStructureEdits(outline, [1], []);
  const out = api.officeApplyEdits(OUTLINE_XML, plan.edits);
  assert.equal(out.includes("계획"), false);
  assert.match(out, /<w:t>셀 안<\/w:t>/);                 // 나머지는 그대로
  assert.match(out, /<w:t>끝<\/w:t>/);
});

test("문단은 쪽 설정 문단 '앞'에 들어간다", () => {
  const outline = api.officeParagraphOutline(OUTLINE_XML);
  const made = api.officeNewParagraphXml("<w:p></w:p>", "새 문단");
  const plan = api.officeParagraphStructureEdits(outline, [], [{ afterIndex: 4, xml: made }]);
  const out = api.officeApplyEdits(OUTLINE_XML, plan.edits);
  assert.ok(out.indexOf("새 문단") < out.indexOf("sectPr"), "쪽 설정보다 뒤로 밀리면 안 된다");
});

test("표 안에는 문단을 더할 수 없다", () => {
  const outline = api.officeParagraphOutline(OUTLINE_XML);
  const plan = api.officeParagraphStructureEdits(outline, [], [{ afterIndex: 2, xml: "<w:p/>" }]);
  assert.equal(plan.inserted, 0);
  assert.match(plan.refused[0].reason, /표 안에는/);
});

test("편집·추가·삭제를 한 번에 적용해도 오프셋이 엉키지 않는다", () => {
  const outline = api.officeParagraphOutline(OUTLINE_XML);
  const edits = [];
  // ① 1번 문단 글자 고치기
  const first = api.officeParagraphModel(OUTLINE_XML.slice(outline[0].start, outline[0].end), outline[0].start);
  for (const e of api.officeParagraphTextEdits(first, "새 계획").edits) edits.push(e);
  // ② 1번 뒤에 문단 추가 + ③ 3번 문단 삭제
  const struct = api.officeParagraphStructureEdits(outline, [3],
    [{ afterIndex: 1, xml: api.officeNewParagraphXml("<w:p/>", "덧붙임") }]);
  for (const e of struct.edits) edits.push(e);

  const out = api.officeApplyEdits(OUTLINE_XML, edits);
  assert.match(out, /<w:t>새 계획<\/w:t>/);
  assert.match(out, /<w:t>덧붙임<\/w:t>/);
  assert.equal(out.includes("<w:t>탭</w:t>"), false);     // 3번은 지워졌다
  assert.match(out, /<w:t>셀 안<\/w:t>/);
  assert.match(out, /<w:pgSz w:w="11906"\/>/);            // 쪽 설정 그대로
});

/* ---------- 편집 화면의 행 목록 → XML 편집 (2b) ---------- */

const PLAN_XML = "<w:body>" +
  '<w:p><w:pPr><w:pStyle w:val="제목1"/></w:pPr>' + run("첫 문단") + "</w:p>" +
  para(run("둘째 문단")) +
  '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr>' + run("끝 문단") + "</w:p>" +
  "</w:body>";
const planRows = () => api.officeParagraphOutline(PLAN_XML).map(item => ({
  index: item.index, text: item.text, original: item.text, removed: false, after: 0
}));

test("고치지 않으면 편집 목록이 비어 있다", () => {
  const plan = api.officeParagraphEditPlan(PLAN_XML, planRows());
  assert.deepEqual(plan.edits, []);
  assert.equal(plan.changed, 0);
  assert.equal(api.officeApplyEdits(PLAN_XML, plan.edits), PLAN_XML);
});

test("행 글자를 고치면 그 문단만 되쓴다", () => {
  const rows = planRows();
  rows[1].text = "둘째 문단 고침";
  const plan = api.officeParagraphEditPlan(PLAN_XML, rows);
  assert.equal(plan.changed, 1);
  const out = api.officeApplyEdits(PLAN_XML, plan.edits);
  assert.match(out, /<w:t>둘째 문단 고침<\/w:t>/);
  assert.match(out, /<w:t>첫 문단<\/w:t>/);
  assert.match(out, /<w:pStyle w:val="제목1"\/>/);
});

test("같은 자리에 새 문단이 여럿이면 순서대로 한 번에 들어간다", () => {
  const rows = planRows();
  rows.splice(1, 0,
    { index: 0, text: "새A", original: null, removed: false, after: 1 },
    { index: 0, text: "새B", original: null, removed: false, after: 1 });
  const plan = api.officeParagraphEditPlan(PLAN_XML, rows);
  assert.equal(plan.inserted, 1);                      // 한 편집으로 합쳐진다
  const out = api.officeApplyEdits(PLAN_XML, plan.edits);
  assert.ok(out.indexOf("새A") < out.indexOf("새B"), "넣은 순서가 유지돼야 한다");
  assert.ok(out.indexOf("첫 문단") < out.indexOf("새A"));
  assert.ok(out.indexOf("새B") < out.indexOf("둘째 문단"));
  assert.match(out, /<w:pStyle w:val="제목1"\/>[\s\S]*새A/);   // 앞 문단 스타일을 물려받는다
});

test("행을 지움 표시하면 문단이 사라지고, 쪽 설정 문단은 거부된다", () => {
  const rows = planRows();
  rows[1].removed = true;
  rows[2].removed = true;
  const plan = api.officeParagraphEditPlan(PLAN_XML, rows);
  assert.equal(plan.removed, 1);
  assert.equal(plan.refused.length, 1);
  const out = api.officeApplyEdits(PLAN_XML, plan.edits);
  assert.equal(out.includes("둘째 문단"), false);
  assert.match(out, /<w:t>끝 문단<\/w:t>/);
  assert.match(out, /<w:pgSz w:w="11906"\/>/);
});

test("지운 문단은 글자를 고쳐 두었어도 되쓰지 않는다", () => {
  const rows = planRows();
  rows[1].text = "안 쓰일 글";
  rows[1].removed = true;
  const plan = api.officeParagraphEditPlan(PLAN_XML, rows);
  assert.equal(plan.changed, 0);
  assert.equal(api.officeApplyEdits(PLAN_XML, plan.edits).includes("안 쓰일 글"), false);
});

test("고치기·추가·삭제를 한 행 목록에 섞어도 결과가 맞는다", () => {
  const rows = planRows();
  rows[0].text = "첫 문단 고침";
  rows[1].removed = true;
  rows.push({ index: 0, text: "맨 뒤", original: null, removed: false, after: 1 });
  const plan = api.officeParagraphEditPlan(PLAN_XML, rows);
  assert.equal(plan.changed, 1);
  assert.equal(plan.removed, 1);
  assert.equal(plan.inserted, 1);
  const out = api.officeApplyEdits(PLAN_XML, plan.edits);
  assert.match(out, /<w:t>첫 문단 고침<\/w:t>/);
  assert.equal(out.includes("둘째 문단"), false);
  assert.match(out, /<w:t>맨 뒤<\/w:t>/);
  assert.match(out, /<w:pgSz w:w="11906"\/>/);
});

test("저장 뒤 새 XML 로 기준을 다시 잡으면 두 번째 편집도 제자리에 들어간다", () => {
  // 저장이 끝난 뒤 옛 문단 위치를 그대로 쓰면 두 번째 저장이 엉뚱한 자리에 적용된다.
  // docx-editor 가 저장 직후 outline 을 새 XML 로 다시 잡는 이유를 여기서 못 박는다.
  let xml = PLAN_XML;
  let rows = planRows();
  rows[0].text = "첫 문단 고침";
  rows.push({ index: 0, text: "새 문단", original: null, removed: false, after: 1 });
  xml = api.officeApplyEdits(xml, api.officeParagraphEditPlan(xml, rows).edits);

  // ← 저장. 여기서 기준을 다시 잡는다.
  rows = api.officeParagraphOutline(xml).map(item => ({
    index: item.index, text: item.text, original: item.text, removed: false, after: 0
  }));
  assert.deepEqual(rows.map(r => r.text), ["첫 문단 고침", "새 문단", "둘째 문단", "끝 문단"]);

  rows[1].text = "새 문단 또 고침";
  const out = api.officeApplyEdits(xml, api.officeParagraphEditPlan(xml, rows).edits);
  assert.match(out, /<w:t>새 문단 또 고침<\/w:t>/);
  assert.match(out, /<w:t>첫 문단 고침<\/w:t>/);
  assert.match(out, /<w:t>둘째 문단<\/w:t>/);
  assert.match(out, /<w:pgSz w:w="11906"\/>/);
});

/* ---------- 텍스트 상자(중첩 문단) ---------- */

// Word 는 문단 안에 도형을 넣고 그 도형 안에 다시 문단을 둔다. 정규식 한 방으로 <w:p>…</w:p> 를
// 잡으면 바깥 문단이 안쪽 </w:p> 에서 끊겨, 상자 뒤 글자를 놓치고 그 문단을 지우면 XML 이 깨진다.
const textbox = (inner) => "<w:r><w:pict><v:textbox><w:txbxContent>" + inner + "</w:txbxContent></v:textbox></w:pict></w:r>";
const BOX_XML = "<w:body><w:p>" + run("앞2025") + textbox(para(run("상자속2025"))) + run("뒤2025") + "</w:p></w:body>";

test("텍스트 상자가 든 문단은 상자 뒤 글자까지 바꾼다", () => {
  const result = api.officeReplacePartXml(BOX_XML, plain("2025"), "2026");
  assert.equal(result.count, 2);                          // 앞2025 · 뒤2025 (상자 안은 제외)
  assert.match(result.out, /<w:t>앞2026<\/w:t>/);
  assert.match(result.out, /<w:t>뒤2026<\/w:t>/);
});

test("텍스트 상자 안 글자는 바꾸지 않고 개수만 센다", () => {
  const result = api.officeReplacePartXml(BOX_XML, plain("2025"), "2026");
  assert.match(result.out, /<w:t>상자속2025<\/w:t>/);      // 도형 안은 손대지 않는다
  assert.equal(result.boxed, 1);
  assert.equal(api.officeCountTextboxMatches(BOX_XML, plain("2025")), 1);
});

test("문단 평문에 상자 안 글자가 섞이지 않는다", () => {
  const outline = api.officeParagraphOutline(BOX_XML);
  assert.equal(outline.length, 1);                        // 상자 안 문단은 따로 세지 않는다
  assert.equal(outline[0].text, "앞2025뒤2025");
  assert.equal(outline[0].hasTextbox, true);
});

test("상자가 든 문단을 지워도 XML 짝이 맞는다", () => {
  const rows = api.officeParagraphOutline(BOX_XML)
    .map(item => ({ index: item.index, text: item.text, original: item.text, removed: true }));
  const out = api.officeApplyEdits(BOX_XML, api.officeParagraphEditPlan(BOX_XML, rows).edits);
  assert.equal(out, "<w:body></w:body>");                 // 열린 태그가 남지 않는다
  assert.equal((out.match(/<w:txbxContent>/g) || []).length, (out.match(/<\/w:txbxContent>/g) || []).length);
});

test("셀 안에 표가 또 있어도 안쪽 표 뒤 문단을 '표 밖' 으로 보지 않는다", () => {
  const inner = "<w:tbl><w:tr><w:tc>" + para(run("안쪽")) + "</w:tc></w:tr></w:tbl>";
  const xml = "<w:body>" +
    "<w:tbl><w:tr><w:tc>" + para(run("바깥앞")) + inner + para(run("바깥뒤")) + "</w:tc></w:tr></w:tbl>" +
    para(run("본문")) + "</w:body>";
  const outline = api.officeParagraphOutline(xml);
  assert.deepEqual(outline.map(p => p.text), ["바깥앞", "안쪽", "바깥뒤", "본문"]);
  assert.deepEqual(outline.map(p => p.inTable), [true, true, true, false]);
});

test("빈 문단(<w:p/>)도 한 문단으로 세고 범위가 자기 태그에서 끝난다", () => {
  const xml = "<w:body><w:p/>" + para(run("글자")) + "</w:body>";
  const ranges = api.officeParagraphRanges(xml);
  assert.equal(ranges.length, 2);
  assert.equal(xml.slice(ranges[0].start, ranges[0].end), "<w:p/>");
});

test("PowerPoint 슬라이드에는 중첩이 없어 결과가 그대로다", () => {
  const xml = "<a:p><a:r><a:t>2025 계획</a:t></a:r></a:p>";
  const result = api.officeReplacePartXml(xml, plain("2025"), "2026");
  assert.equal(result.count, 1);
  assert.equal(result.boxed, 0);
  assert.match(result.out, /<a:t>2026 계획<\/a:t>/);
});

/* ---------- 미리보기 제자리 편집: 화면 ↔ XML 대조 ---------- */

// 화면 문단과 XML 문단이 어긋난 채 저장하면 사용자가 고친 것과 다른 문단이 바뀌고,
// 화면상으로는 멀쩡해 보여 알아채지도 못한다. 그래서 붙일 때 전부 맞춰 본다.
const outlineOf = (texts) => texts.map((text, i) => ({ index: i + 1, text }));

test("공백 표현이 달라도 글자가 같으면 대응으로 인정한다", () => {
  // docx-preview 는 <w:tab/> 을 &emsp;(U+2003) 로, <w:br/> 을 <br>(글자 없음) 으로 그린다.
  const dom = ["제목 본문", "첫째 줄둘째 줄"];
  const outline = outlineOf(["제목\t본문", "첫째 줄\n둘째 줄"]);
  assert.equal(api.officeInlineMapVerify(dom, outline).ok, true);
});

test("문단 수가 다르면 대응을 거부한다", () => {
  const check = api.officeInlineMapVerify(["가", "나"], outlineOf(["가", "나", "다"]));
  assert.equal(check.ok, false);
  assert.match(check.reason, /2개와 문서 문단 3개/);
});

test("한 문단이라도 글자가 어긋나면 그 자리를 짚어 거부한다", () => {
  const check = api.officeInlineMapVerify(["가", "틀림", "다"], outlineOf(["가", "나", "다"]));
  assert.equal(check.ok, false);
  assert.equal(check.at, 1);
  assert.match(check.reason, /2번째 문단/);
});

test("빈 문단끼리도 짝이 맞는다", () => {
  assert.equal(api.officeInlineMapVerify(["", "본문"], outlineOf(["", "본문"])).ok, true);
});

test("대조 열쇠는 공백을 다 지운 글자다", () => {
  assert.equal(api.officeInlineTextKey(" 가 \t나\n다 "), "가나다");
  assert.equal(api.officeInlineTextKey(null), "");
});

test("임시 문단 표시는 본문 문단마다 고유 북마크를 넣고 원문 글자는 그대로 둔다", () => {
  const xml = "<w:body>" + para(run("첫째")) + "<w:tbl><w:tr><w:tc>" + para(run("셀")) +
    "</w:tc></w:tr></w:tbl></w:body>";
  const plan = api.officeParagraphMarkerPlan(xml, "_test_para_");
  assert.deepEqual(plan.markers.map(item => item.name), ["_test_para_1", "_test_para_2"]);
  assert.equal(api.officeParagraphOutline(plan.xml).map(item => item.text).join("|"), "첫째|셀");
  assert.equal((plan.xml.match(/bookmarkStart/g) || []).length, 2);
  assert.equal((plan.xml.match(/bookmarkEnd/g) || []).length, 2);
});

test("임시 문단 표시는 빈 축약 문단을 안전한 여닫는 태그로 편다", () => {
  const plan = api.officeParagraphMarkerPlan("<w:body><w:p w:rsidR=\"1\"/></w:body>", "_empty_");
  assert.match(plan.xml, /<w:p w:rsidR="1"><w:bookmarkStart/);
  assert.match(plan.xml, /<w:bookmarkEnd[^>]*\/><\/w:p>/);
  assert.equal(api.officeParagraphOutline(plan.xml).length, 1);
});

test("임시 문단 표시는 기존 북마크 다음 id를 써서 충돌하지 않는다", () => {
  const xml = "<w:body>" + para('<w:bookmarkStart w:id="41" w:name="old"/>' + run("본문") + '<w:bookmarkEnd w:id="41"/>') + "</w:body>";
  const plan = api.officeParagraphMarkerPlan(xml, "_next_");
  assert.match(plan.xml, /bookmarkStart w:id="42" w:name="_next_1"/);
});

/* ---------- Word 표 행·열 구조 편집 ---------- */

const tableCell = (text, pr = "") => "<w:tc>" + (pr ? "<w:tcPr>" + pr + "</w:tcPr>" : "") + para(run(text)) + "</w:tc>";
const tableRow = (cells, pr = "") => "<w:tr>" + (pr ? "<w:trPr>" + pr + "</w:trPr>" : "") + cells.join("") + "</w:tr>";
const SIMPLE_TABLE = "<w:body><w:tbl><w:tblGrid><w:gridCol w:w=\"1000\"/><w:gridCol w:w=\"2000\"/></w:tblGrid>" +
  tableRow([tableCell("A", '<w:shd w:fill="FFFF00"/>'), tableCell("B")], "<w:tblHeader/>") +
  tableRow([tableCell("C"), tableCell("D")]) + "</w:tbl></w:body>";

test("표 윤곽이 문단에 표·행·셀 좌표를 정확히 붙인다", () => {
  const tables = api.officeTableOutline(SIMPLE_TABLE);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].rows.map(row => row.cells.length), [2, 2]);
  assert.equal(tables[0].rectangular, true);
  assert.deepEqual(api.officeParagraphOutline(SIMPLE_TABLE).map(p => [p.tableIndex, p.tableRow, p.tableCell]),
    [[1, 1, 1], [1, 1, 2], [1, 2, 1], [1, 2, 2]]);
});

test("행을 추가하면 셀 모양은 물려받고 글자와 반복 머리글은 비운다", () => {
  const result = api.officeTableStructureEdit(SIMPLE_TABLE,
    { kind: "row-add-below", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);
  assert.deepEqual(api.officeParagraphOutline(result.xml).map(p => p.text), ["A", "B", "", "", "C", "D"]);
  assert.equal((result.xml.match(/tblHeader/g) || []).length, 1);      // 원래 머리글에만 남는다
  assert.equal((result.xml.match(/w:shd w:fill="FFFF00"/g) || []).length, 2);
  assert.deepEqual(result.selection, { tableIndex: 1, rowIndex: 2, cellIndex: 1 });
});

test("행 삭제는 선택한 행만 지우고 마지막 행 삭제는 막는다", () => {
  const result = api.officeTableStructureEdit(SIMPLE_TABLE,
    { kind: "row-delete", tableIndex: 1, rowIndex: 1, cellIndex: 2 });
  assert.deepEqual(api.officeParagraphOutline(result.xml).map(p => p.text), ["C", "D"]);
  const oneRow = "<w:body><w:tbl>" + tableRow([tableCell("한 칸")]) + "</w:tbl></w:body>";
  assert.match(api.officeTableStructureEdit(oneRow,
    { kind: "row-delete", tableIndex: 1, rowIndex: 1, cellIndex: 1 }).reason, /마지막 행/);
});

test("열을 추가·삭제하면 모든 행과 tblGrid가 함께 바뀐다", () => {
  const added = api.officeTableStructureEdit(SIMPLE_TABLE,
    { kind: "column-add-right", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.deepEqual(api.officeParagraphOutline(added.xml).map(p => p.text), ["A", "", "B", "C", "", "D"]);
  assert.equal((added.xml.match(/gridCol/g) || []).length, 3);
  assert.deepEqual(added.selection, { tableIndex: 1, rowIndex: 1, cellIndex: 2 });

  const removed = api.officeTableStructureEdit(SIMPLE_TABLE,
    { kind: "column-delete", tableIndex: 1, rowIndex: 2, cellIndex: 2 });
  assert.deepEqual(api.officeParagraphOutline(removed.xml).map(p => p.text), ["A", "C"]);
  assert.equal((removed.xml.match(/gridCol/g) || []).length, 1);
});

test("병합 표와 중첩 표는 기존 구조를 보존하며 위험한 축 편집을 거부한다", () => {
  const vertical = "<w:body><w:tbl>" + tableRow([tableCell("위", '<w:vMerge w:val="restart"/>'), tableCell("옆")]) +
    tableRow([tableCell("", "<w:vMerge/>"), tableCell("아래")]) + "</w:tbl></w:body>";
  assert.match(api.officeTableStructureEdit(vertical,
    { kind: "row-add-below", tableIndex: 1, rowIndex: 1, cellIndex: 2 }).reason, /세로 병합/);

  const horizontal = "<w:body><w:tbl>" + tableRow([tableCell("합침", '<w:gridSpan w:val="2"/>')]) + "</w:tbl></w:body>";
  assert.match(api.officeTableStructureEdit(horizontal,
    { kind: "column-add-right", tableIndex: 1, rowIndex: 1, cellIndex: 1 }).reason, /병합된 셀/);

  const nested = "<w:body><w:tbl>" + tableRow(["<w:tc>" + para(run("바깥")) + "<w:tbl>" +
    tableRow([tableCell("안쪽")]) + "</w:tbl></w:tc>"]) + "</w:tbl></w:body>";
  assert.match(api.officeTableStructureEdit(nested,
    { kind: "row-delete", tableIndex: 1, rowIndex: 1, cellIndex: 1 }).reason, /다른 표/);
});

test("오른쪽 셀 병합은 gridSpan과 두 셀의 문단을 보존하고 다시 나눌 수 있다", () => {
  const table = "<w:body><w:tbl><w:tblGrid><w:gridCol w:w=\"1000\"/><w:gridCol w:w=\"1000\"/></w:tblGrid>" +
    tableRow(["<w:tc><w:tcPr><w:tcW w:w=\"2000\" w:type=\"dxa\"/></w:tcPr>" + para(run("왼쪽")) + "</w:tc>",
      tableCell("오른쪽")]) + "</w:tbl></w:body>";
  let result = api.officeTableCellMergeEdit(table,
    { kind: "cell-merge-right", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);
  assert.match(result.xml, /<w:gridSpan w:val="2"\/>/);
  assert.match(result.xml, /왼쪽[\s\S]*오른쪽/);
  assert.equal(api.officeTableOutline(result.xml)[0].rows[0].cells.length, 1);

  result = api.officeTableCellMergeEdit(result.xml,
    { kind: "cell-split", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);
  const cells = api.officeTableOutline(result.xml)[0].rows[0].cells;
  assert.equal(cells.length, 2);
  assert.equal(cells[0].gridSpan, 1);
  assert.doesNotMatch(result.xml, /<w:gridSpan/);
  assert.match(result.xml, /<w:tcW w:w="1000" w:type="dxa"\/>/);
});

test("선택 셀의 가로·세로 정렬만 바꾸고 다른 셀 문단은 그대로 둔다", () => {
  let result = api.officeTableFormatEdit(SIMPLE_TABLE,
    { kind: "horizontal", value: "center", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 1 }).horizontal, "center");
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 2 }).horizontal, "left");
  assert.match(result.xml, /<w:pPr><w:jc w:val="center"\/><\/w:pPr><w:r><w:t>A/);

  result = api.officeTableFormatEdit(result.xml,
    { kind: "vertical", value: "bottom", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 1 }).vertical, "bottom");
});

test("셀 배경과 네 면 테두리를 적용하고 다시 지울 수 있다", () => {
  let xml = api.officeTableFormatEdit(SIMPLE_TABLE,
    { kind: "fill", value: "#A1B2C3", tableIndex: 1, rowIndex: 2, cellIndex: 2 }).xml;
  xml = api.officeTableFormatEdit(xml,
    { kind: "border", value: "112233", tableIndex: 1, rowIndex: 2, cellIndex: 2 }).xml;
  let format = api.officeTableCellFormat(xml, { tableIndex: 1, rowIndex: 2, cellIndex: 2 });
  assert.equal(format.fill, "A1B2C3");
  assert.equal(format.borderColor, "112233");
  assert.equal((xml.match(/w:color="112233"/g) || []).length, 4);

  xml = api.officeTableFormatEdit(xml,
    { kind: "fill", value: "", tableIndex: 1, rowIndex: 2, cellIndex: 2 }).xml;
  xml = api.officeTableFormatEdit(xml,
    { kind: "border", value: "", tableIndex: 1, rowIndex: 2, cellIndex: 2 }).xml;
  format = api.officeTableCellFormat(xml, { tableIndex: 1, rowIndex: 2, cellIndex: 2 });
  assert.equal(format.fill, "FFFFFF");
  assert.equal(format.borderColor, "000000");
});

test("열 너비는 모든 행의 tcW와 tblGrid를 함께 바꾸고 행 높이는 선택 행만 바꾼다", () => {
  let result = api.officeTableFormatEdit(SIMPLE_TABLE,
    { kind: "column-width", delta: 240, tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 1 }).width, 1240);
  assert.equal((result.xml.match(/w:tcW w:w="1240"/g) || []).length, 2);
  assert.match(result.xml, /w:gridCol w:w="1240"/);

  result = api.officeTableFormatEdit(result.xml,
    { kind: "row-height", delta: 120, tableIndex: 1, rowIndex: 2, cellIndex: 1 });
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 2, cellIndex: 1 }).height, 480);
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 1 }).height, 360);
});

test("병합 표의 열 너비와 중첩 표의 셀 서식은 안전하게 제한한다", () => {
  const merged = "<w:body><w:tbl>" + tableRow([tableCell("합침", '<w:gridSpan w:val="2"/>')]) + "</w:tbl></w:body>";
  assert.match(api.officeTableFormatEdit(merged,
    { kind: "column-width", delta: 240, tableIndex: 1, rowIndex: 1, cellIndex: 1 }).reason, /병합/);

  const nested = "<w:body><w:tbl>" + tableRow(["<w:tc>" + para(run("바깥")) + "<w:tbl>" +
    tableRow([tableCell("안쪽")]) + "</w:tbl></w:tc>"]) + "</w:tbl></w:body>";
  assert.match(api.officeTableFormatEdit(nested,
    { kind: "fill", value: "FFFF00", tableIndex: 1, rowIndex: 1, cellIndex: 1 }).reason, /다른 표/);
});

test("선택 셀의 모든 글자 조각에 글꼴·크기·굵게를 적용하고 기존 run 서식을 보존한다", () => {
  const richCell = "<w:tc><w:p>" + run("가", "<w:rPr><w:i/></w:rPr>") + run("나") + "</w:p></w:tc>";
  const table = "<w:body><w:tbl>" + tableRow([richCell, tableCell("다")]) + "</w:tbl></w:body>";
  let result = api.officeTableFormatEdit(table,
    { kind: "font", value: "맑은 고딕", tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  result = api.officeTableFormatEdit(result.xml,
    { kind: "font-size", value: 14, tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  result = api.officeTableFormatEdit(result.xml,
    { kind: "bold", value: true, tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  const format = api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(format.font, "맑은 고딕");
  assert.equal(format.fontSize, 14);
  assert.equal(format.bold, true);
  assert.equal((result.xml.match(/w:eastAsia="맑은 고딕"/g) || []).length, 2);
  assert.equal((result.xml.match(/<w:sz w:val="28"\/>/g) || []).length, 2);
  assert.equal((result.xml.match(/<w:b\/>/g) || []).length, 2);
  assert.match(result.xml, /<w:rPr><w:i\/><w:rFonts/); // 기존 기울임은 남는다
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 2 }).font, "");
});

test("굵게 해제는 상속에 다시 켜지지 않도록 명시적인 0으로 기록한다", () => {
  const boldTable = "<w:body><w:tbl>" + tableRow([
    "<w:tc><w:p>" + run("굵게", "<w:rPr><w:b/><w:bCs/></w:rPr>") + "</w:p></w:tc>"
  ]) + "</w:tbl></w:body>";
  const result = api.officeTableFormatEdit(boldTable,
    { kind: "bold", value: false, tableIndex: 1, rowIndex: 1, cellIndex: 1 });
  assert.equal(result.changed, true);
  assert.equal(api.officeTableCellFormat(result.xml, { tableIndex: 1, rowIndex: 1, cellIndex: 1 }).bold, false);
  assert.match(result.xml, /<w:b w:val="0"\/>/);
  assert.match(result.xml, /<w:bCs w:val="0"\/>/);
});

test("표 밖의 선택 문단에도 글꼴·크기·굵게를 적용한다", () => {
  const xml = "<w:body>" + para(run("제목", "<w:rPr><w:u/></w:rPr>")) + para(run("본문")) + "</w:body>";
  let result = api.officeParagraphFormatEdit(xml,
    { kind: "font", value: "바탕", paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml,
    { kind: "font-size", value: 18, paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml,
    { kind: "bold", value: true, paragraphIndex: 1 });
  assert.deepEqual(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 }),
    { font: "바탕", fontSize: 18, bold: true, italic: false, underline: true,
      textColor: "000000", highlight: "FFFFFF", strike: false, baseline: "baseline" });
  assert.deepEqual(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 2 }),
    { font: "", fontSize: 11, bold: false, italic: false, underline: false,
      textColor: "000000", highlight: "FFFFFF", strike: false, baseline: "baseline" });
  assert.match(result.xml, /<w:rPr><w:u\/><w:rFonts/); // 밑줄은 보존한다
});

test("기울임·밑줄·글자색·형광펜을 적용하고 끌 수 있다", () => {
  const xml = "<w:body>" + para(run("서식", '<w:rPr><w:lang w:val="ko-KR"/></w:rPr>')) + "</w:body>";
  let result = api.officeParagraphFormatEdit(xml, { kind: "italic", value: true, paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml, { kind: "underline", value: true, paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml, { kind: "text-color", value: "#123ABC", paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml, { kind: "highlight", value: "FFF2CC", paragraphIndex: 1 });
  assert.deepEqual(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 }), {
    font: "", fontSize: 11, bold: false, italic: true, underline: true,
    textColor: "123ABC", highlight: "FFF2CC", strike: false, baseline: "baseline"
  });
  assert.match(result.xml, /<w:i\/>/);
  assert.match(result.xml, /<w:iCs\/>/);
  assert.match(result.xml, /<w:u w:val="single"\/>/);

  result = api.officeParagraphFormatEdit(result.xml, { kind: "italic", value: false, paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml, { kind: "underline", value: false, paragraphIndex: 1 });
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 }).italic, false);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 }).underline, false);
  assert.match(result.xml, /<w:i w:val="0"\/>/);
  assert.match(result.xml, /<w:u w:val="none"\/>/);
});

test("서식 지우기는 편집 가능한 글자 속성만 걷고 언어 속성은 보존한다", () => {
  const rich = '<w:rPr><w:lang w:val="ko-KR"/><w:noProof/><w:rFonts w:eastAsia="굴림"/>' +
    '<w:sz w:val="28"/><w:szCs w:val="28"/><w:b/><w:i/><w:u w:val="single"/>' +
    '<w:color w:val="FF0000"/><w:shd w:fill="FFFF00"/><w:strike/><w:vertAlign w:val="superscript"/></w:rPr>';
  const xml = "<w:body>" + para(run("초기화", rich)) + "</w:body>";
  const result = api.officeParagraphFormatEdit(xml, { kind: "clear-format", paragraphIndex: 1 });
  assert.equal(result.changed, true);
  assert.deepEqual(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 }), {
    font: "", fontSize: 11, bold: false, italic: false, underline: false,
    textColor: "000000", highlight: "FFFFFF", strike: false, baseline: "baseline"
  });
  assert.match(result.xml, /<w:lang w:val="ko-KR"\/>/);
  assert.match(result.xml, /<w:noProof\/>/);
  assert.doesNotMatch(result.xml, /<w:(?:rFonts|sz|szCs|b|i|u|color|shd|strike|dstrike|vertAlign)(?:\s|\/|>)/);
});

test("취소선과 위·아래 첨자를 적용하고 정상 글자로 되돌린다", () => {
  const xml = "<w:body>" + para(run("수식")) + "</w:body>";
  let result = api.officeParagraphFormatEdit(xml, { kind: "strike", value: true, paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml, { kind: "baseline", value: "superscript", paragraphIndex: 1 });
  let format = api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 });
  assert.equal(format.strike, true);
  assert.equal(format.baseline, "superscript");
  assert.match(result.xml, /<w:strike\/>/);
  assert.match(result.xml, /<w:vertAlign w:val="superscript"\/>/);

  result = api.officeParagraphFormatEdit(result.xml, { kind: "strike", value: false, paragraphIndex: 1 });
  result = api.officeParagraphFormatEdit(result.xml, { kind: "baseline", value: "subscript", paragraphIndex: 1 });
  format = api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 });
  assert.equal(format.strike, false);
  assert.equal(format.baseline, "subscript");
  assert.match(result.xml, /<w:strike w:val="0"\/>/);

  result = api.officeParagraphFormatEdit(result.xml, { kind: "baseline", value: "baseline", paragraphIndex: 1 });
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1 }).baseline, "baseline");
});

test("선택한 글자 범위만 run을 나눠 서식을 적용하고 앞뒤 서식은 보존한다", () => {
  const xml = "<w:body>" + para(run("가나다라마바사", "<w:rPr><w:i/></w:rPr>")) + "</w:body>";
  const result = api.officeParagraphFormatEdit(xml,
    { kind: "bold", value: true, paragraphIndex: 1, rangeStart: 2, rangeEnd: 5 });
  assert.equal(result.changed, true);
  assert.equal((result.xml.match(/<w:r>/g) || []).length, 3);
  assert.match(result.xml, /<w:t>가나<\/w:t>/);
  assert.match(result.xml, /<w:i\/><w:b\/><w:bCs\/><\/w:rPr><w:t>다라마<\/w:t>/);
  assert.match(result.xml, /<w:t>바사<\/w:t>/);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1, offset: 0 }).bold, false);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1, offset: 3 }).bold, true);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1, offset: 6 }).bold, false);
});

test("선택 범위가 여러 run에 걸리면 양끝만 나누고 가운데 run 전체를 서식 처리한다", () => {
  const xml = "<w:body>" + para(run("가나") + run("다라") + run("마바")) + "</w:body>";
  const result = api.officeParagraphFormatEdit(xml,
    { kind: "underline", value: true, paragraphIndex: 1, rangeStart: 1, rangeEnd: 5 });
  assert.equal(result.changed, true);
  assert.equal((result.xml.match(/<w:u w:val="single"\/>/g) || []).length, 3);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1, offset: 0 }).underline, false);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1, offset: 2 }).underline, true);
  assert.equal(api.officeParagraphTextFormat(result.xml, { paragraphIndex: 1, offset: 5 }).underline, false);
});

test("글머리표·번호 정의를 패키지에 만들고 문단에 연결하거나 해제한다", () => {
  const parts = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "word/_rels/document.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  };
  const bullet = api.officeEnsureNumbering(parts, "bullet");
  assert.equal(bullet.numId, 1);
  assert.match(bullet.replacements["word/numbering.xml"], /w:numFmt w:val="bullet"/);
  assert.match(bullet.replacements["word/_rels/document.xml.rels"], /relationships\/numbering/);
  assert.match(bullet.replacements["[Content_Types].xml"], /word\/numbering\.xml/);

  const xml = "<w:body>" + para(run("항목")) + "</w:body>";
  let result = api.officeParagraphListEdit(xml,
    { kind: "bullet", numId: bullet.numId, paragraphIndex: 1 });
  assert.equal(result.changed, true);
  assert.deepEqual(api.officeParagraphListFormat(result.xml, { paragraphIndex: 1 }), { numId: 1, level: 0 });
  assert.match(result.xml, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/);
  result = api.officeParagraphListEdit(result.xml, { kind: "none", paragraphIndex: 1 });
  assert.equal(api.officeParagraphListFormat(result.xml, { paragraphIndex: 1 }).numId, 0);
});

test("기존 사용자 번호 정의와 관계를 보존하며 앱 번호 정의를 한 번만 추가한다", () => {
  const base = api.officeEnsureNumbering({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "word/_rels/document.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  }, "number");
  const again = api.officeEnsureNumbering({ ...base.replacements }, "number");
  assert.equal(again.numId, base.numId);
  assert.equal((again.replacements["word/numbering.xml"].match(/4D4E4E55/g) || []).length, 2);
  assert.equal((again.replacements["word/_rels/document.xml.rels"].match(/relationships\/numbering/g) || []).length, 1);
});

test("페이지 방향과 여백 프리셋은 마지막 구역 설정만 바꾼다", () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    para(run("본문")) + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr>' +
    '</w:body></w:document>';
  let result = api.officeDocumentPageEdit(xml, { kind: "orientation", value: "landscape" });
  assert.equal(result.changed, true);
  assert.deepEqual(api.officeDocumentPageFormat(result.xml), {
    orientation: "landscape", width: 16838, height: 11906, top: 1000, right: 1000, bottom: 1000, left: 1000
  });
  result = api.officeDocumentPageEdit(result.xml, { kind: "margins", value: "narrow" });
  const format = api.officeDocumentPageFormat(result.xml);
  assert.equal(format.top, 720);
  assert.equal(format.left, 720);
});

test("머리글·바닥글이 없으면 파트·관계·참조를 만들고 기존 것이 있으면 글자만 고친다", () => {
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "word/_rels/document.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  };
  const documentXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    para(run("본문")) + '<w:sectPr/></w:body></w:document>';
  const made = api.officeHeaderFooterEdit(parts, documentXml, "header", "학교 문서");
  assert.equal(made.changed, true);
  assert.match(made.documentXml, /w:headerReference[^>]*r:id=/);
  assert.match(made.replacements[made.path], /<w:t>학교 문서<\/w:t>/);
  assert.match(made.replacements["word/_rels/document.xml.rels"], /relationships\/header/);
  const mergedParts = { ...parts, ...made.replacements };
  assert.equal(api.officeHeaderFooterInfo(mergedParts, made.documentXml, "header").text, "학교 문서");
  const changed = api.officeHeaderFooterEdit(mergedParts, made.documentXml, "header", "새 머리글");
  assert.match(changed.replacements[made.path], /<w:t>새 머리글<\/w:t>/);
  assert.equal((changed.replacements["word/_rels/document.xml.rels"] || "").length, 0);
});

test("문단에 그림을 추가하고 같은 관계의 파일을 교체한 뒤 비율대로 크기를 바꾼다", () => {
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "word/_rels/document.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
    "word/media/image1.png": null
  };
  const documentXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    para(run("그림 아래")) + '<w:sectPr/></w:body></w:document>';
  const added = api.officeImagePackageEdit(parts, documentXml, {
    kind: "add", paragraphIndex: 1, bytes: new Uint8Array([1, 2, 3]), mime: "image/png",
    widthPx: 400, heightPx: 200, name: "사진.png"
  });
  assert.equal(added.changed, true);
  assert.equal(added.mediaPath, "word/media/image2.png");
  assert.match(added.documentXml, /<w:drawing>/);
  assert.match(added.documentXml, /r:embed="rId1"/);
  assert.equal(api.officeParagraphImageInfo(added.documentXml, { paragraphIndex: 1 }).count, 1);
  assert.match(added.replacements["word/_rels/document.xml.rels"], /Target="media\/image2.png"/);

  const mergedParts = { ...parts, ...added.replacements };
  const replaced = api.officeImagePackageEdit(mergedParts, added.documentXml, {
    kind: "replace", paragraphIndex: 1, bytes: new Uint8Array([4, 5]), mime: "image/jpeg"
  });
  assert.equal(replaced.changed, true);
  assert.match(replaced.replacements["word/_rels/document.xml.rels"], /Target="media\/image3.jpg"/);
  const resized = api.officeImagePackageEdit({ ...mergedParts, ...replaced.replacements }, replaced.documentXml,
    { kind: "resize", paragraphIndex: 1, scale: 0.5 });
  const before = api.officeParagraphImageInfo(replaced.documentXml, { paragraphIndex: 1 });
  const after = api.officeParagraphImageInfo(resized.documentXml, { paragraphIndex: 1 });
  assert.equal(after.cx, Math.round(before.cx * 0.5));
  assert.equal(after.cy, Math.round(before.cy * 0.5));
});

test("문단 정렬·줄 간격·앞뒤 간격을 바꿔도 서로의 속성과 스타일은 보존한다", () => {
  const xml = '<w:body><w:p><w:pPr><w:pStyle w:val="Body"/>' +
    '<w:spacing w:before="120" w:after="240"/></w:pPr>' + run("본문") + '</w:p></w:body>';
  let result = api.officeParagraphLayoutEdit(xml,
    { kind: "alignment", value: "both", paragraphIndex: 1 });
  result = api.officeParagraphLayoutEdit(result.xml,
    { kind: "line-spacing", value: 1.5, paragraphIndex: 1 });
  result = api.officeParagraphLayoutEdit(result.xml,
    { kind: "space-before", value: 8, paragraphIndex: 1 });
  result = api.officeParagraphLayoutEdit(result.xml,
    { kind: "space-after", value: 10, paragraphIndex: 1 });
  assert.deepEqual(api.officeParagraphLayoutFormat(result.xml, { paragraphIndex: 1 }), {
    alignment: "both", lineSpacing: 1.5, before: 8, after: 10,
    left: 0, right: 0, firstLine: 0, hanging: 0
  });
  assert.match(result.xml, /<w:pStyle w:val="Body"\/>/);
  assert.match(result.xml, /<w:spacing[^>]*w:before="160"/);
  assert.match(result.xml, /<w:spacing[^>]*w:after="200"/);
  assert.match(result.xml, /<w:spacing[^>]*w:line="360"/);
  assert.match(result.xml, /<w:spacing[^>]*w:lineRule="auto"/);
});

test("좌우 들여쓰기와 첫 줄·내어쓰기를 독립적으로 조절한다", () => {
  const xml = "<w:body>" + para(run("들여쓰기")) + "</w:body>";
  let result = api.officeParagraphLayoutEdit(xml,
    { kind: "indent-left", delta: 360, paragraphIndex: 1 });
  result = api.officeParagraphLayoutEdit(result.xml,
    { kind: "indent-right", delta: 720, paragraphIndex: 1 });
  result = api.officeParagraphLayoutEdit(result.xml,
    { kind: "special-indent", value: "first-line", paragraphIndex: 1 });
  let format = api.officeParagraphLayoutFormat(result.xml, { paragraphIndex: 1 });
  assert.deepEqual([format.left, format.right, format.firstLine, format.hanging], [360, 720, 360, 0]);

  result = api.officeParagraphLayoutEdit(result.xml,
    { kind: "special-indent", value: "hanging", paragraphIndex: 1 });
  format = api.officeParagraphLayoutFormat(result.xml, { paragraphIndex: 1 });
  assert.deepEqual([format.left, format.right, format.firstLine, format.hanging], [360, 720, 0, 360]);
});

test("문단 서식 지우기는 배치 속성만 걷고 스타일과 쪽 설정은 보존한다", () => {
  const xml = '<w:body><w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/>' +
    '<w:spacing w:line="360"/><w:ind w:left="720"/><w:sectPr><w:pgSz w:w="11906"/></w:sectPr>' +
    '</w:pPr>' + run("제목") + '</w:p></w:body>';
  const result = api.officeParagraphLayoutEdit(xml,
    { kind: "clear-layout", paragraphIndex: 1 });
  assert.equal(result.changed, true);
  assert.deepEqual(api.officeParagraphLayoutFormat(result.xml, { paragraphIndex: 1 }), {
    alignment: "left", lineSpacing: 1, before: 0, after: 0,
    left: 0, right: 0, firstLine: 0, hanging: 0
  });
  assert.match(result.xml, /<w:pStyle w:val="Title"\/>/);
  assert.match(result.xml, /<w:sectPr><w:pgSz w:w="11906"\/><\/w:sectPr>/);
});
