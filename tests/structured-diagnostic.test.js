"use strict";

/* 구조화 파일(JSON·XML·YAML) 편집 진단의 계약:
   도구막대에는 길이가 변하는 것을 두지 않는다 — 통과·경고·오류는 편집기 바로 위 진단 띠 하나가 맡는다.
   도구막대에 넣으면 .run-bar 가 flex-wrap 이라 '축소보다 줄바꿈이 먼저'라 버튼이 다음 줄로 접힌다. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const viewer = read("src/js/code-viewer.js");
const styles = read("src/styles.css");

// code-viewer.js 는 통째로는 못 돌린다(브라우저 전역 의존) — 진단 구획만 떼어 실행한다.
const start = viewer.indexOf("/* ===== 구조화 파일(JSON·XML·YAML) 편집 중 유효성 진단");
const end = viewer.indexOf("/* ===== 줄 정리 메뉴");
assert.ok(start > 0 && end > start, "code-viewer.js 에서 진단 구획을 찾지 못했습니다");

// DOMParser 대역 — 브라우저가 주는 parsererror 문구를 그대로 흉내 낸다(크롬 형식).
function diagnose(ext, prof, text, parserError){
  const context = {
    DOMParser: class {
      parseFromString(){
        return { querySelector: () => (parserError ? { textContent: parserError } : null) };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(viewer.slice(start, end), context);
  return context.structuredEditDiagnostic(ext, prof, text);
}

const chromeXmlError = (line, column, reason) =>
  "This page contains the following errors:error on line " + line + " at column " + column + ": " + reason +
  "\nBelow is a rendering of the page up to the first error.";

test("XML 오류는 줄 번호까지의 요약과 한국어 풀이로 나뉘어 나온다", () => {
  const d = diagnose("xml", "xml", "<a><b></a>",
    chromeXmlError(11, 3, "Opening and ending tag mismatch: head line 3 and html"));
  assert.equal(d.level, "error");
  assert.equal(d.text, "⚠ XML 오류 · 11번째 줄");
  assert.equal(d.line, 11);
  assert.equal(d.column, 3);
  assert.match(d.detail, /여는 태그 <head> \(3번째 줄\)/);
  // 파서 원문은 요약에 절대 섞이지 않는다 — 길이를 예측할 수 없다.
  assert.doesNotMatch(d.text, /Opening and ending tag mismatch|Below is a rendering/);
});

test("띠 문구의 앞머리(배지 자리에 쓰이던 요약)는 짧게 유지된다", () => {
  const cases = [
    diagnose("xml", "xml", "<a>", chromeXmlError(1234, 7, "Premature end of data in tag note line 2")),
    diagnose("json", "c", '{\n  "a": 1\n  "b": 2\n}'),
    diagnose("yaml", "hash", "a:\n\t- 1\n"),
    diagnose("yaml", "hash", "a: 1\n"),
    diagnose("json", "c", '{"a":1}'),
    diagnose("xml", "xml", "<a/>")
  ];
  for (const d of cases) assert.ok(d.text.length <= 24, "요약이 너무 깁니다: " + d.text);
});

test("알아보지 못한 파서 문구는 풀이 대신 원문 그대로 남긴다", () => {
  const d = diagnose("xml", "xml", "<a/>", chromeXmlError(4, 2, "Some brand-new libxml message"));
  assert.equal(d.detail, "Some brand-new libxml message");
  assert.equal(d.raw, "Some brand-new libxml message");
});

test("HTML 은 XML 잣대가 아니라 HTML 규칙을 아는 태그 짝 검사로 본다", () => {
  const err = chromeXmlError(11, 3, "Opening and ending tag mismatch: head line 3 and html");
  // XML 파서였다면 둘 다 오류였을 문서 — HTML5 에서는 <meta>·<br> 을 닫지 않는 게 정상이다.
  assert.equal(diagnose("html", "xml", "<html><meta charset=\"utf-8\"></html>", err).level, "ok");
  assert.equal(diagnose("htm", "xml", "<html><br></html>", err).level, "ok");
  // XHTML 은 진짜 XML 이므로 XML 검사에 그대로 남는다.
  assert.equal(diagnose("xhtml", "xml", "<html/>", null).level, "ok");
});

// 오탐이 한 번 나면 그 경보는 그날로 무시당한다 — '정상인데 오류로 잡히는' 쪽을 특히 두껍게 지킨다.
const HTML_VALID = {
  "빈 요소가 많은 HTML5 문서": '<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8">\n'
    + '<link rel="stylesheet" href="a.css">\n</head>\n<body>\n<img src="a.png" alt="사진"><br><hr>\n'
    + '<input type="text" name="q">\n</body>\n</html>',
  "끝 태그를 생략한 <li>": "<ul><li>하나<li>둘<li>셋</ul>",
  "끝 태그를 생략한 <tr><td>": "<table><tr><td>1<td>2<tr><td>3</table>",
  "<p> 다음에 블록 요소": "<div><p>글<div>다른 칸</div></div>",
  "자기닫기 표기": '<div><br /><img src="a.png" /></div>',
  "속성값 안의 >": '<div title="a > b"><span>x</span></div>',
  "주석 안의 가짜 태그": "<div><!-- <span> 안 닫힘 --></div>",
  "본문의 부등호": "<p>3 < 5 이고 5 > 3 이다</p>",
  "대문자 태그": "<DIV><SPAN>x</SPAN></DIV>",
  "사용자 정의 태그": "<my-widget><p>x</p></my-widget>",
  "SVG 안의 자기닫기": '<div><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></div>',
  "빈 요소를 닫은 </br>": "<p>a</br>b</p>",
  // <script>·<style> 안은 markup 이 아니다 — 건너뛰지 않으면 if (a < b) 가 태그로 읽힌다.
  "script 안의 부등호와 가짜 태그": '<body>\n<script>\nif (3 < 5 && 5 > 3) { s = "<div>"; }\n</script>\n</body>',
  "style 안의 자식 선택자": "<head>\n<style>\n.a > .b { color:red; }\n</style>\n</head>"
};
for (const [label, body] of Object.entries(HTML_VALID)){
  test("HTML 태그 짝 검사가 오탐하지 않는다 — " + label, () => {
    const d = diagnose("html", "xml", body);
    assert.equal(d.level, "ok", "정상 HTML 을 오류로 잡았습니다: " + (d.detail || d.text));
  });
}

test("HTML 태그 짝 검사는 확실히 틀린 세 가지를 줄 번호와 함께 짚는다", () => {
  // 1) 안쪽을 안 닫고 바깥을 닫음
  const inner = diagnose("html", "xml", "<div>\n  <span>글\n</div>");
  assert.equal(inner.level, "error");
  assert.equal(inner.line, 2);
  assert.match(inner.detail, /<span> 이 닫히지 않았어요/);

  // 2) 열린 적 없는 닫는 태그
  const orphan = diagnose("html", "xml", "<div>x</div>\n</section>");
  assert.equal(orphan.line, 2);
  assert.match(orphan.detail, /짝이 되는 <section> 가 앞에 없어요/);

  // 3) 끝까지 안 닫힌 태그 — 가장 안쪽을 짚고, 나머지 개수도 알려 준다
  const eof = diagnose("html", "xml", "<div>\n<section>\n<article>\n<b>x");
  assert.equal(eof.line, 4);
  assert.match(eof.detail, /<b> 가 닫히지 않은 채/);
  assert.match(eof.detail, /3개 더/);

  // '>' 를 빠뜨려 다음 태그가 빨려 들어간 경우
  const noGt = diagnose("html", "xml", '<div class="a"\n<p>x</p>');
  assert.match(noGt.detail, /> 가 빠졌어요/);
});

test("템플릿 문법이 섞인 HTML 은 아예 검사하지 않는다 — 짝이 안 맞는 게 정상이다", () => {
  assert.equal(diagnose("html", "xml", "{% if a %}<div>{% endif %}<p>x</p>"), null);
});

test("<script> 끝을 찾을 때 원본을 대소문자 무시로 훑는다(소문자 사본의 인덱스를 쓰지 않는다)", () => {
  // 'İ'(U+0130)는 소문자가 두 글자라, toLowerCase() 사본의 위치를 원본에 쓰면 그 뒤가 통째로 밀린다.
  const body = "<body>\n<p>İstanbul</p>\n<script>\nvar a = 1;\n</script>\n</body>";
  assert.equal(diagnose("html", "xml", body).level, "ok");
  const viewerSrc = read("src/js/code-viewer.js");
  assert.doesNotMatch(viewerSrc, /const lower = src\.toLowerCase\(\)/);
});

test("JSON·YAML 오류에도 줄 번호와 한국어 풀이가 함께 붙는다", () => {
  const json = diagnose("json", "c", '{\n  "a": 1\n  "b": 2\n}');
  assert.equal(json.level, "error");
  assert.equal(json.line, 3);
  assert.match(json.text, /^⚠ JSON 오류 · 3번째 줄$/);
  assert.ok(json.detail);

  const yaml = diagnose("yaml", "hash", "a:\n\t- 1\n");
  assert.equal(yaml.level, "error");
  assert.equal(yaml.line, 2);
  assert.match(yaml.detail, /탭/);
});

test("진단 띠는 도구막대와 편집기 사이에 놓이고, 도구막대에는 진단 배지를 두지 않는다", () => {
  assert.match(viewer, /host\.appendChild\(bar\); host\.appendChild\(diagBar\); host\.appendChild\(editor\.host\)/);
  // 도구막대에 길이가 변하는 진단 문구를 다시 들이면 버튼 줄이 또 접힌다.
  assert.doesNotMatch(viewer, /text-edit-diag"/);
  assert.doesNotMatch(styles, /\.text-edit-diag\{/);
  // 통과·경고도 같은 띠가 맡는다 — 오류일 때만 여닫으면 편집기가 위아래로 튄다.
  assert.match(viewer, /diagBar\.hidden = false; diagBar\.dataset\.level = d\.level/);
  // 오류일 때만 '그 줄로' 버튼을 단다.
  assert.match(viewer, /diagLine = \(d\.level === "error" && typeof editor\.focusLine === "function"\)/);
  assert.match(viewer, /diagGo\.textContent = diagLine \+ "번째 줄로"/);
});

test("편집 도구막대는 편집기·진단 띠와 같은 폭으로 가운데 맞춘다", () => {
  // .run-bar 가 뒤에서 margin 을 덮어 도구막대만 왼쪽에 붙던 어긋남 — 특이도를 올려 막아 둔다.
  assert.match(styles, /\.run-bar\.text-edit-bar\{[^}]*margin:0 auto 10px/);
  const barWidth = styles.match(/\.run-bar\.text-edit-bar\{[^}]*max-width:(\d+)px/);
  const hostWidth = styles.match(/\.code-host\{[^}]*max-width:(\d+)px/);
  const barMatch = styles.match(/\.text-edit-diagbar\{[^}]*max-width:(\d+)px/);
  assert.ok(barWidth && hostWidth && barMatch, "폭 규칙을 찾지 못했습니다");
  assert.equal(barWidth[1], hostWidth[1]);
  assert.equal(barMatch[1], hostWidth[1]);
  // 파이썬·자바·JS 편집기는 줄맞춤 방식이 다르다 — 도구막대·경로·편집기를 .run-wrap 한 겹이 함께 가운데로
  // 모으므로 .run-bar 의 margin 이 무엇이든 어긋나지 않는다. 그 래퍼가 사라지면 같은 버그가 그쪽에도 생긴다.
  assert.match(styles, /\.run-wrap\{[^}]*margin:0 auto/);
});

test("진단 띠는 통과·경고·오류 세 가지 색과 어두운 테마 짝을 모두 갖춘다", () => {
  for (const level of ["ok", "warn", "error"]){
    const rule = ".text-edit-diagbar[data-level=\"" + level + "\"]{";
    assert.ok(styles.includes(rule), level + " 색이 없습니다");
    assert.ok(styles.includes("[data-theme=\"dark\"] " + rule), level + " 의 어두운 테마 색이 없습니다");
  }
});
