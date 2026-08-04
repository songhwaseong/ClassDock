"use strict";

/* MNDataConvert — 형식 변환 (설계: docs/형식변환-설계.md)

   이 파일에서 가장 중요한 검사는 두 번째 것이다.
     1) 무손실이라고 표시한 경로는 왕복 결과가 원본과 같아야 한다.
     2) 손실이 있는 경로는 loss 배열이 절대 비면 안 된다.
   "손실이 났는데 리포트가 조용한" 경우가 이 기능의 유일한 진짜 버그라서, 그걸 직접 잡는다. */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const MNDataConvert = require(path.join(__dirname, "..", "src", "js", "data-convert.js"));
const { LOSS } = MNDataConvert;

const codes = (result) => result.loss.map(item => item.code);
const hasCode = (result, code) => codes(result).indexOf(code) >= 0;
const roundTrip = (value, to, opts) => {
  const out = MNDataConvert.convert(JSON.stringify(value), Object.assign({ from:"json", to }, opts || {}));
  const back = MNDataConvert.convert(out.text, Object.assign({ from:to, to:"json" }, opts || {}));
  return { out, back, value:JSON.parse(back.text) };
};

// ── 1. 무손실 왕복 ────────────────────────────────────

const FLAT_RECORDS = [
  { 이름:"홍길동", 부서:"영업", 연차:3, 재직:true },
  { 이름:"김철수", 부서:"개발", 연차:5, 재직:false }
];

for (const to of ["csv", "tsv", "md", "jsonl"]){
  test(`평평한 객체 배열은 json ↔ ${to} 왕복에서 값이 그대로다`, () => {
    const { back, value } = roundTrip(FLAT_RECORDS, to);
    assert.deepEqual(value, FLAT_RECORDS);
    assert.deepEqual(back.loss, []);
  });
}

test("중첩 구조도 경로 평탄화(기본값)로 왕복하면 원본으로 되돌아온다", () => {
  const source = [
    { 이름:"홍길동", 주소:{ 시:"서울", 구:"강남" }, 태그:["신입", "우수"] },
    { 이름:"김철수", 주소:{ 시:"부산", 구:"해운대" }, 태그:["경력"] }
  ];
  const { value } = roundTrip(source, "csv");
  assert.equal(value[0].주소.시, "서울");
  assert.deepEqual(value[0].태그, ["신입", "우수"]);
  assert.equal(value[1].주소.구, "해운대");
  // 두 번째 행에는 태그[1] 이 없으므로 그 칸은 비고, 되돌릴 때 키를 만들지 않는다.
  assert.deepEqual(value[1].태그, ["경력"]);
});

test("키에 점이 들어 있어도 대괄호 표기로 왕복한다", () => {
  const source = [{ "a.b":{ c:1 }, normal:2 }];
  const { out, value } = roundTrip(source, "csv");
  // 컬럼 이름 자체에 따옴표가 들어가 CSV 인용까지 겹치므로 원문이 아니라 되읽은 컬럼으로 확인한다.
  assert.deepEqual(MNDataConvert.parse(out.text, "csv", {}).table.columns, ['["a.b"].c', "normal"]);
  assert.deepEqual(value, source);
});

test("빈 칸 처리 방식은 emptyAs 로 고를 수 있다", () => {
  const csv = "a,b\n1,";
  const omitted = MNDataConvert.convert(csv, { from:"csv", to:"json" });
  assert.deepEqual(JSON.parse(omitted.text), [{ a:1 }]);
  assert.ok(hasCode(omitted, LOSS.NULL_AMBIGUOUS), codes(omitted).join(", "));
  assert.deepEqual(JSON.parse(MNDataConvert.convert(csv, { from:"csv", to:"json", emptyAs:"string" }).text), [{ a:1, b:"" }]);
  assert.deepEqual(JSON.parse(MNDataConvert.convert(csv, { from:"csv", to:"json", emptyAs:"null" }).text), [{ a:1, b:null }]);
});

test("표 입력을 타입 추론하며 숫자 표기를 바꾸면 보고한다", () => {
  const result = MNDataConvert.convert("버전\n1.10", { from:"csv", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ 버전:1.1 }]);
  assert.ok(hasCode(result, LOSS.NUMBER_REFORMATTED), codes(result).join(", "));
});

test("타입 추론을 끄면 모든 값이 문자열이 된다", () => {
  const result = MNDataConvert.convert("이름,연차\n홍길동,3", { from:"csv", to:"json", inferTypes:false });
  assert.deepEqual(JSON.parse(result.text), [{ 이름:"홍길동", 연차:"3" }]);
});

test("타입 추론이 기본으로 켜져 숫자·불리언·null 을 살린다", () => {
  const result = MNDataConvert.convert("수,참,빔\n3,true,null", { from:"csv", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ 수:3, 참:true, 빔:null }]);
});

// ── 2. 손실 경로는 반드시 리포트가 있어야 한다 ─────────

test("중첩 구조를 표로 펴면 nested-flattened 를 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ 주소:{ 시:"서울" } }]), { from:"json", to:"csv" });
  assert.ok(hasCode(result, LOSS.NESTED_FLATTENED), codes(result).join(", "));
});

test("배열 합치기(join)는 되돌릴 수 없다고 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ 태그:["가", "나"] }]), { from:"json", to:"csv", flatten:"join" });
  assert.ok(hasCode(result, LOSS.ARRAY_JOINED));
  assert.ok(result.text.indexOf("가, 나") >= 0);
});

test("행 복제(explode)는 배열 원소마다 행을 만들고 그 사실을 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ 이름:"홍길동", 태그:["가", "나"] }]), { from:"json", to:"csv", flatten:"explode" });
  assert.ok(hasCode(result, LOSS.ARRAY_EXPLODED));
  const rows = result.text.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(rows.length, 3, "헤더 1줄 + 복제된 2줄");
});

test("null 과 없는 키는 빈 칸이 되며 null-ambiguous 로 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ a:1, b:null }, { a:2 }]), { from:"json", to:"csv" });
  assert.ok(hasCode(result, LOSS.NULL_AMBIGUOUS), codes(result).join(", "));
});

test("객체 하나를 표로 바꾸면 root-wrapped 를 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify({ 이름:"홍길동" }), { from:"json", to:"csv" });
  assert.ok(hasCode(result, LOSS.ROOT_WRAPPED));
});

test("값 목록은 value 컬럼으로 담기며 scalar-wrapped 를 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([1, 2, 3]), { from:"json", to:"csv" });
  assert.ok(hasCode(result, LOSS.SCALAR_WRAPPED));
  assert.ok(result.text.indexOf("value") >= 0);
});

test("안전 정수 범위를 넘는 숫자는 precision 으로 보고한다", () => {
  const result = MNDataConvert.convert('[{"n":9007199254740993}]', { from:"json", to:"csv" });
  assert.ok(hasCode(result, LOSS.PRECISION), codes(result).join(", "));
});

test("엑셀이 날짜로 삼킬 수 있는 값은 date-coerced 로 미리 알린다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ 구간:"1-2" }]), { from:"json", to:"csv" });
  assert.ok(hasCode(result, LOSS.DATE_COERCED));
});

test("TSV 는 칸 안 줄바꿈을 담지 못하므로 text-flattened 로 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ 메모:"첫 줄\n둘째 줄" }]), { from:"json", to:"tsv" });
  assert.ok(hasCode(result, LOSS.TEXT_FLATTENED));
  assert.ok(result.text.indexOf("\n둘째") < 0, "줄바꿈이 눕혀져야 한다");
});

test("헤더가 없는 격자를 마크다운 표로 내보내면 header-synthesized 를 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([["가", "나"], ["1", "2"]]), { from:"json", to:"md" });
  assert.ok(hasCode(result, LOSS.HEADER_SYNTHESIZED));
});

test("컬럼 이름이 겹치면 duplicate-key 로 보고하고 이름을 분리한다", () => {
  const result = MNDataConvert.convert("a,a\n1,2", { from:"csv", to:"json" });
  assert.ok(hasCode(result, LOSS.DUPLICATE_KEY));
  assert.deepEqual(JSON.parse(result.text), [{ a:1, a_2:2 }]);
});

// ── 3. 앞자리 0 · 원문 보존 ───────────────────────────

test("앞자리 0 은 타입 추론을 켜도 문자열로 남는다", () => {
  const result = MNDataConvert.convert("사번\n00123", { from:"csv", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ 사번:"00123" }]);
  assert.deepEqual(result.loss, []);
});

test("숫자 표기가 바뀌면 원문을 살리고 number-reformatted 로 보고한다", () => {
  const result = MNDataConvert.convert(JSON.stringify([{ 버전:1.10 }]), { from:"json", to:"csv" });
  assert.equal(result.text.replace(/^﻿/, ""), "버전\r\n1.1");
  assert.deepEqual(result.loss, [], "1.10 은 JSON 파싱 단계에서 이미 1.1 이라 변환 손실은 아니다");
});

test("셀에 담긴 원문은 표로 나갈 때 그대로 쓰인다", () => {
  const table = MNDataConvert.fromRows([["사번"], ["00123"]], true);
  assert.equal(table.rows[0][0].v, "00123");
  assert.equal(table.rows[0][0].raw, "00123");
});

// ── 4. 이스케이프 · 엣지 케이스 ───────────────────────

test("쉼표·따옴표·줄바꿈이 든 칸은 CSV 규칙대로 인용하고 되읽는다", () => {
  const source = [{ 값:'쉼표, 따옴표" 그리고\n줄바꿈' }];
  const { value } = roundTrip(source, "csv");
  assert.deepEqual(value, source);
});

test("마크다운 표는 파이프를 이스케이프하고 줄바꿈을 <br> 로 담는다", () => {
  const source = [{ 값:"파이프 | 포함\n둘째 줄" }];
  const out = MNDataConvert.convert(JSON.stringify(source), { from:"json", to:"md" });
  assert.ok(out.text.indexOf("\\|") >= 0);
  assert.ok(out.text.indexOf("<br>") >= 0);
  const back = MNDataConvert.convert(out.text, { from:"md", to:"json" });
  assert.deepEqual(JSON.parse(back.text), source);
});

test("BOM 과 CRLF 가 섞인 CSV 도 그대로 읽는다", () => {
  const result = MNDataConvert.convert("﻿이름,연차\r\n홍길동,3\r\n", { from:"csv", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ 이름:"홍길동", 연차:3 }]);
});

test("행 길이가 들쭉날쭉해도 직사각형으로 맞춘다", () => {
  const table = MNDataConvert.parse("a,b,c\n1\n2,3", "csv", {}).table;
  assert.equal(table.columns.length, 3);
  for (const row of table.rows) assert.equal(row.length, 3);
});

test("빈 입력은 빈 배열이 된다", () => {
  const result = MNDataConvert.convert("", { from:"csv", to:"json" });
  assert.equal(result.text, "[]");
});

test("헤더만 있는 표는 행이 없는 배열이 된다", () => {
  const result = MNDataConvert.convert("a,b", { from:"csv", to:"json" });
  assert.equal(result.text, "[]");
});

// ── 5. 경로 문법 ──────────────────────────────────────

test("경로를 만들고 되읽는 규칙이 대칭이다", () => {
  const cases = [
    ["주소", ["주소"]],
    ["a.b", ["a", "b"]]
  ];
  for (const [text, keys] of cases){
    assert.deepEqual(MNDataConvert.parsePath(text).map(seg => seg.key), keys);
  }
  assert.deepEqual(MNDataConvert.parsePath("태그[0]"), [{ key:"태그" }, { index:0 }]);
  assert.deepEqual(MNDataConvert.parsePath('["a.b"].c'), [{ key:"a.b" }, { key:"c" }]);
  assert.equal(MNDataConvert.joinPath("", "a.b"), '["a.b"]');
  assert.equal(MNDataConvert.joinPath("주소", "시"), "주소.시");
  assert.equal(MNDataConvert.joinPath("주소", "a.b"), '주소["a.b"]');
});

test("겹치는 컬럼 경로는 값을 조용히 덮지 않고 보고한다", () => {
  const result = MNDataConvert.convert("a,a.b\nx,y", { from:"csv", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ a:{ b:"y" } }]);
  assert.ok(hasCode(result, LOSS.PATH_COLLISION), codes(result).join(", "));
});

test("위험한 컬럼 경로도 Object prototype을 건드리지 않는다", () => {
  delete Object.prototype.polluted;
  try {
    const result = MNDataConvert.convert("__proto__.polluted\nyes", { from:"csv", to:"json" });
    const value = JSON.parse(result.text);
    assert.equal(({}).polluted, undefined);
    assert.equal(value[0].__proto__.polluted, "yes");
  } finally {
    delete Object.prototype.polluted;
  }
});

// ── 6. 포맷 판별 ──────────────────────────────────────

test("확장자와 내용으로 포맷을 알아낸다", () => {
  assert.equal(MNDataConvert.detectFormat("{}", "a.json"), "json");
  assert.equal(MNDataConvert.detectFormat("a,b\n1,2", "a.csv"), "csv");
  assert.equal(MNDataConvert.detectFormat("a\tb\n1\t2", ""), "tsv");
  assert.equal(MNDataConvert.detectFormat('[{"a":1}]', ""), "json");
  assert.equal(MNDataConvert.detectFormat('{"a":1}\n{"a":2}', ""), "jsonl");
  assert.equal(MNDataConvert.detectFormat("| a |\n| --- |\n| 1 |", ""), "md");
});

// ── 7. XML ────────────────────────────────────────────

test("같은 이름 자식이 2개 이상이면 배열로 꺼내 표로 쓸 수 있게 한다", () => {
  const xml = "<직원들><직원><이름>홍길동</이름><연차>3</연차></직원>" +
              "<직원><이름>김철수</이름><연차>5</연차></직원></직원들>";
  const result = MNDataConvert.convert(xml, { from:"xml", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [
    { 이름:"홍길동", 연차:3 },
    { 이름:"김철수", 연차:5 }
  ]);
});

test("자식이 하나뿐이면 배열로 꺼내지 않고 그 모호함을 보고한다", () => {
  const result = MNDataConvert.convert("<직원들><직원><이름>홍길동</이름></직원></직원들>", { from:"xml", to:"json" });
  assert.ok(hasCode(result, LOSS.SINGLE_ELEMENT_ARRAY), codes(result).join(", "));
  assert.deepEqual(JSON.parse(result.text), { 직원:{ 이름:"홍길동" } });
});

test("원소가 하나인 배열을 XML 로 내보낼 때도 같은 모호함을 미리 알린다", () => {
  const result = MNDataConvert.convert('[{"a":1}]', { from:"json", to:"xml" });
  assert.ok(hasCode(result, LOSS.SINGLE_ELEMENT_ARRAY));
});

test("속성과 섞인 글자는 @·# 규약으로 왕복한다", () => {
  const xml = '<쪽지 id="7" 급함="예">읽어 주세요</쪽지>';
  const asJson = MNDataConvert.convert(xml, { from:"xml", to:"json" });
  assert.deepEqual(JSON.parse(asJson.text), { "@id":7, "@급함":"예", "#text":"읽어 주세요" });
  const back = MNDataConvert.convert(asJson.text, { from:"json", to:"xml", xmlRoot:"쪽지" });
  assert.ok(back.text.indexOf('id="7"') >= 0, back.text);
  assert.ok(back.text.indexOf("읽어 주세요") >= 0);
});

test("XML ↔ JSON 은 원소가 2개 이상이면 값이 그대로 왕복한다", () => {
  const source = [{ 이름:"홍길동", 연차:3 }, { 이름:"김철수", 연차:5 }];
  const toXml = MNDataConvert.convert(JSON.stringify(source), { from:"json", to:"xml" });
  const back = MNDataConvert.convert(toXml.text, { from:"xml", to:"json" });
  assert.deepEqual(JSON.parse(back.text), source);
  assert.deepEqual(back.loss, []);
});

test("XML 왕복은 바깥·항목 요소 이름을 기억한다", () => {
  const xml = "<직원들><직원><이름>홍</이름></직원><직원><이름>김</이름></직원></직원들>";
  const same = MNDataConvert.convert(xml, { from:"xml", to:"xml" });
  assert.ok(same.text.indexOf("<직원들>") >= 0, same.text);
  assert.ok(same.text.indexOf("<직원>") >= 0);
});

test("엔티티와 CDATA 를 읽고, 내보낼 때 다시 이스케이프한다", () => {
  const xml = "<a><b>&lt;태그&gt; &amp; 그리고</b><c><![CDATA[원문 <그대로>]]></c></a>";
  const result = MNDataConvert.convert(xml, { from:"xml", to:"json" });
  assert.deepEqual(JSON.parse(result.text), { b:"<태그> & 그리고", c:"원문 <그대로>" });
  const back = MNDataConvert.convert(result.text, { from:"json", to:"xml", xmlRoot:"a" });
  assert.ok(back.text.indexOf("&lt;태그&gt;") >= 0, back.text);
});

test("주석은 옮기지 않고 그 사실을 보고한다", () => {
  const result = MNDataConvert.convert("<a><!-- 설명 --><b>1</b></a>", { from:"xml", to:"json" });
  assert.ok(hasCode(result, LOSS.COMMENT_DROPPED));
});

test("잘못된 XML은 일부만 변환하지 않고 거부한다", () => {
  assert.throws(
    () => MNDataConvert.convert("<a>1</a><b>2</b>", { from:"xml", to:"json" }),
    /바깥 요소가 하나/
  );
  assert.throws(
    () => MNDataConvert.convert("<a><b>1</a>", { from:"xml", to:"json" }),
    /닫는 태그가 맞지 않아요/
  );
});

test("XML 혼합 콘텐츠의 순서를 보존할 수 없으면 보고한다", () => {
  const xml = "<p>before<b>B</b>middle<i>I</i>after</p>";
  const result = MNDataConvert.convert(xml, { from:"xml", to:"xml" });
  assert.ok(hasCode(result, LOSS.MIXED_CONTENT), codes(result).join(", "));
});

test("XML 요소 이름으로 못 쓰는 컬럼 이름은 바꾸고 보고한다", () => {
  const result = MNDataConvert.convert('[{"이 름":1},{"이 름":2}]', { from:"json", to:"xml" });
  assert.ok(hasCode(result, LOSS.NAME_SANITIZED));
  assert.ok(result.text.indexOf("<이_름>") >= 0, result.text);
});

test("XML 은 타입이 없어 추론을 끄면 전부 문자열이 된다", () => {
  const xml = "<r><i><n>3</n></i><i><n>5</n></i></r>";
  assert.deepEqual(JSON.parse(MNDataConvert.convert(xml, { from:"xml", to:"json" }).text), [{ n:3 }, { n:5 }]);
  assert.deepEqual(JSON.parse(MNDataConvert.convert(xml, { from:"xml", to:"json", inferTypes:false }).text), [{ n:"3" }, { n:"5" }]);
});

test("XML 을 표로 바꾸면 평탄화 규칙이 그대로 적용된다", () => {
  const xml = "<r><i><이름>홍</이름><주소><시>서울</시></주소></i>" +
              "<i><이름>김</이름><주소><시>부산</시></주소></i></r>";
  const result = MNDataConvert.convert(xml, { from:"xml", to:"csv" });
  assert.ok(result.text.indexOf("주소.시") >= 0, result.text);
  assert.ok(hasCode(result, LOSS.NESTED_FLATTENED));
});

// ── 8. HTML 표 ────────────────────────────────────────

test("HTML 표를 읽어 헤더와 값을 가려낸다", () => {
  const html = "<table><thead><tr><th>이름</th><th>연차</th></tr></thead>" +
               "<tbody><tr><td>홍길동</td><td>3</td></tr></tbody></table>";
  const result = MNDataConvert.convert(html, { from:"html", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ 이름:"홍길동", 연차:3 }]);
});

test("닫는 태그를 생략한 HTML 표도 읽는다", () => {
  const html = "<table><tr><th>a<th>b<tr><td>1<td>2</table>";
  const table = MNDataConvert.parse(html, "html", {}).table;
  assert.deepEqual(table.columns, ["a", "b"]);
  assert.deepEqual(table.rows[0].map(cell => cell.v), [1, 2]);
});

test("칸 안의 태그는 글자만 남기고, <br> 은 줄바꿈으로 살린다", () => {
  const html = "<table><tr><th>메모</th></tr><tr><td><b>굵게</b><br>둘째 줄</td></tr></table>";
  const result = MNDataConvert.convert(html, { from:"html", to:"json" });
  assert.deepEqual(JSON.parse(result.text), [{ 메모:"굵게\n둘째 줄" }]);
  assert.ok(hasCode(result, LOSS.MARKUP_DROPPED));
});

test("병합된 칸은 펴지 않고 그 사실을 보고한다", () => {
  const html = '<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">합침</td></tr></table>';
  const result = MNDataConvert.convert(html, { from:"html", to:"json" });
  assert.ok(hasCode(result, LOSS.MERGED_CELLS));
});

test("JSON ↔ HTML 표는 값이 그대로 왕복한다", () => {
  const source = [{ 이름:"홍길동", 연차:3 }, { 이름:"김철수", 연차:5 }];
  const { back, value } = roundTrip(source, "html");
  assert.deepEqual(value, source);
  assert.deepEqual(back.loss, []);
});

test("HTML 표 안의 &amp; 같은 엔티티를 되살리고 다시 이스케이프한다", () => {
  const source = [{ 값:"토끼 & 거북 <경주>" }, { 값:"둘째" }];
  const { out, value } = roundTrip(source, "html");
  assert.ok(out.text.indexOf("&amp;") >= 0 && out.text.indexOf("&lt;경주&gt;") >= 0, out.text);
  assert.deepEqual(value, source);
});

test("표가 없는 HTML 은 빈 결과가 된다", () => {
  const result = MNDataConvert.convert("<div><p>표가 없어요</p></div>", { from:"html", to:"json" });
  assert.equal(result.text, "[]");
});

// ── 9. 마크업 토크나이저 ──────────────────────────────

test("토크나이저는 속성·자기닫음·중첩을 읽는다", () => {
  const { root } = MNDataConvert.parseMarkup('<a x="1"><b/><c>글</c></a>', {});
  const a = root.children[0];
  assert.equal(a.name, "a");
  assert.deepEqual(a.attrs, { x:"1" });
  assert.deepEqual(a.children.map(child => child.name), ["b", "c"]);
  assert.equal(a.children[1].children[0], "글");
});

test("숫자 엔티티도 되살린다", () => {
  assert.equal(MNDataConvert.decodeEntities("&#54620;&#xAE00;"), "한글");
});

test("XML 선언과 처리 명령은 건너뛴다", () => {
  const { root } = MNDataConvert.parseMarkup('<?xml version="1.0"?><a>1</a>', {});
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].name, "a");
});

// ── 10. YAML ──────────────────────────────────────────
// 브라우저에서는 MNLazy 가 vendor/js-yaml.min.js 를 그때 싣는다. node 에서는 같은 파일을
// 직접 넣어(setYaml) 검증한다 — 앱이 실제로 쓰는 것과 같은 바이트다.

test("라이브러리를 넣기 전에는 YAML 을 쓸 수 없다고 분명히 말한다", () => {
  MNDataConvert.setYaml(null);
  assert.equal(MNDataConvert.yamlReady(), false);
  assert.throws(() => MNDataConvert.convert("a: 1", { from:"yaml", to:"json" }), /YAML/);
});

test("vendor 의 js-yaml 을 넣으면 준비된 것으로 본다", () => {
  MNDataConvert.setYaml(require(path.join(__dirname, "..", "vendor", "js-yaml.min.js")));
  assert.equal(MNDataConvert.yamlReady(), true);
});

test("YAML ↔ JSON 은 값이 그대로 왕복한다", () => {
  const source = { 이름:"홍길동", 연차:3, 재직:true, 태그:["신입", "우수"], 주소:{ 시:"서울" }, 비고:null };
  const toYaml = MNDataConvert.convert(JSON.stringify(source), { from:"json", to:"yaml" });
  const back = MNDataConvert.convert(toYaml.text, { from:"yaml", to:"json" });
  assert.deepEqual(JSON.parse(back.text), source);
  assert.deepEqual(back.loss, []);
});

test("YAML 을 표로 펴면 다른 계층형과 같은 규칙을 따른다", () => {
  const yaml = "- 이름: 홍길동\n  주소:\n    시: 서울\n- 이름: 김철수\n  주소:\n    시: 부산\n";
  const result = MNDataConvert.convert(yaml, { from:"yaml", to:"csv" });
  assert.ok(result.text.indexOf("주소.시") >= 0, result.text);
  assert.ok(hasCode(result, LOSS.NESTED_FLATTENED));
});

test("YAML 주석은 옮기지 않고 그 사실을 보고한다", () => {
  const result = MNDataConvert.convert("# 설명\n이름: 홍길동\n", { from:"yaml", to:"json" });
  assert.ok(hasCode(result, LOSS.COMMENT_DROPPED), codes(result).join(", "));
  assert.deepEqual(JSON.parse(result.text), { 이름:"홍길동" });
});

test("YAML 인라인 주석도 보고하되 문자열과 블록 안의 #은 주석으로 보지 않는다", () => {
  const inline = MNDataConvert.convert("이름: 홍길동 # 설명\n", { from:"yaml", to:"json" });
  assert.ok(hasCode(inline, LOSS.COMMENT_DROPPED), codes(inline).join(", "));

  const quoted = MNDataConvert.convert('이름: "홍 # 길동"\n', { from:"yaml", to:"json" });
  assert.ok(!hasCode(quoted, LOSS.COMMENT_DROPPED), codes(quoted).join(", "));

  const block = MNDataConvert.convert("설명: |\n  # 이것은 글자\n", { from:"yaml", to:"json" });
  assert.ok(!hasCode(block, LOSS.COMMENT_DROPPED), codes(block).join(", "));
});

test("--- 로 나뉜 여러 문서는 배열 하나로 합치고 보고한다", () => {
  const result = MNDataConvert.convert("a: 1\n---\na: 2\n", { from:"yaml", to:"json" });
  assert.ok(hasCode(result, LOSS.MULTI_DOCUMENT));
  assert.deepEqual(JSON.parse(result.text), [{ a:1 }, { a:2 }]);
});

test("노르웨이 문제: YAML 1.1 의 NO 는 js-yaml 4 에서 문자열로 남는다", () => {
  const result = MNDataConvert.convert("나라: NO\n켬: true\n", { from:"yaml", to:"json" });
  assert.deepEqual(JSON.parse(result.text), { 나라:"NO", 켬:true });
});

test("YAML 로 내보낸 문자열은 다시 읽어도 타입이 유지된다", () => {
  const source = [{ 사번:"00123", 수:3, 글:"1.10" }];
  const toYaml = MNDataConvert.convert(JSON.stringify(source), { from:"json", to:"yaml" });
  const back = MNDataConvert.convert(toYaml.text, { from:"yaml", to:"json" });
  assert.deepEqual(JSON.parse(back.text), source);
});

test("확장자 없이도 --- 로 시작하면 YAML 로 본다", () => {
  assert.equal(MNDataConvert.detectFormat("---\na: 1\n", ""), "yaml");
  assert.equal(MNDataConvert.detectFormat("a: 1\n", "설정.yml"), "yaml");
  // 평범한 글은 YAML 문법에 맞아도 추측하지 않는다
  assert.notEqual(MNDataConvert.detectFormat("메모: 오늘 할 일\n", ""), "yaml");
});

// ── 11. 표 블록(MNTableExport)과의 다리 ───────────────

test("표 블록 rows 와 Table 사이를 오간다", () => {
  const rows = [["이름", "연차"], ["홍길동", "3"]];
  const table = MNDataConvert.fromRows(rows, true);
  assert.deepEqual(table.columns, ["이름", "연차"]);
  assert.deepEqual(MNDataConvert.toRows(table), rows);
});

test("표 블록을 곧바로 JSON 으로 바꾼다", () => {
  const table = MNDataConvert.fromRows([["이름", "연차"], ["홍길동", "3"]], true);
  const out = MNDataConvert.serialize({ table, value:undefined }, "json", {});
  assert.deepEqual(JSON.parse(out.text), [{ 이름:"홍길동", 연차:3 }]);
});
