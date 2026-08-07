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
