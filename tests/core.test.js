const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeWorkspace, encodeWorkspace, fingerprintBytes, formatZipOpenSummary, inferPythonLocalImportRoots, inferPythonProjectRunContext, markdownToHtml,
  htmlTagAllowed, htmlAttrAllowed, htmlSanitizeUrl, htmlSanitizeStyle,
  indexWorkspacePathsByFolder,
  pythonRunScopeIncludesPath, resolveProjectRelativePath, resolveRuntimeOutputPath, resolveSiblingPath, safeArchivePath, safeLink,
  windowsAbsolutePathLiterals, windowsAbsolutePathTouchesFolder,
  transformEditorLines, pythonCompletionCandidates, pythonMemberCompletionCandidates, completionWordsForProfile, pythonImportCompletionCandidates, pythonWorkspaceImportCompletionCandidates, pythonCompletionInferenceSource, normalizeIdentifierSelection, findNextIdentifierOccurrence, identifierOccurrences,
  diffTextEdit, remapTextRangesAfterEdit, editorHistoryCaretState, applyLinkedIdentifierEdit, pythonLineOpensBlock, pythonOpenClosePlan, completionReplacementRange, completionInsertionPlan, completionApplicationPlan, closingBracketTabPlan,
  lineNumberAtOffset, lineStartOffset, findPythonLocalDefinition, resolvePythonImportedDefinition, parsePythonTracebackLocation, classifyPythonStderr,
  detectCsvDelimiter, detectTextEncoding, indexCsvRows, parseCsvRecord, explainPythonError, contentMatchSnippet,
  suggestRegexPatterns, countRegexMatches, normalizeShortcut, shortcutFromEventLike, shortcutMatchesEvent, pythonOutputShortcutCommand,
  normalizePythonVariables, normalizeAssignmentTests, normalizeGradingOutput, assignmentGradingErrorText,
  normalizePythonDiagnostics, normalizePythonUnusedRanges, normalizePythonTraceReport, latexToMathML, prettyPrintJsonText, jsonTreeNodeInfo,
  orderHwpxSections, officeXmlTextRuns, officeXmlParagraphLines, renderedTextMatchSegments,
  workspaceFolderMarkerPath, workspaceFolderPathFromMarker, workspaceImageSkipMarkerPath, workspaceImageSkipFolderPath,
  workspaceOriginalSaveMarkerPath, workspaceOriginalSaveFolderPath, dataTransferHasFileItems, captureDroppedFileItems,
  droppedTransferNeedsFolderPicker
} = require("../src/js/core.js");

test("텍스트 파일의 BOM·UTF-8·CP949·ASCII 인코딩을 구분한다", () => {
  assert.equal(detectTextEncoding(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])).label, "UTF-8 (BOM 있음)");
  assert.equal(detectTextEncoding(new TextEncoder().encode("한글 UTF-8")).label, "UTF-8");
  assert.equal(detectTextEncoding(new Uint8Array([0xB0, 0xA1])).label, "CP949 / EUC-KR");
  const damagedCp949 = detectTextEncoding(new Uint8Array([0xB0, 0xA1, 0xFF]));
  assert.equal(damagedCp949.encoding, "euc-kr");
  assert.equal(damagedCp949.lossy, true);
  const utf8Korean = new TextEncoder().encode("한글");
  const damagedUtf8 = new Uint8Array(utf8Korean.length + 1);
  damagedUtf8.set(utf8Korean);
  damagedUtf8[damagedUtf8.length - 1] = 0xFF;
  assert.equal(detectTextEncoding(damagedUtf8).encoding, "utf-8");
  assert.equal(detectTextEncoding(new TextEncoder().encode("plain ascii")).shortLabel, "ASCII");
  assert.equal(detectTextEncoding(new Uint8Array([0xFF, 0xFE, 0x61, 0x00])).shortLabel, "UTF-16 LE");
  assert.equal(detectTextEncoding(new Uint8Array()).shortLabel, "빈 파일");
});

test("JSON 표시용 정렬은 유효한 JSON만 들여쓰기로 바꾸고 실패 이유를 돌려준다", () => {
  const pretty = prettyPrintJsonText('{"b":[1,2],"한글":"값"}');
  assert.equal(pretty.ok, true);
  assert.equal(pretty.text, '{\n  "b": [\n    1,\n    2\n  ],\n  "한글": "값"\n}');
  assert.equal(prettyPrintJsonText("[1, 2, 3]").text, "[\n  1,\n  2,\n  3\n]");
  assert.equal(prettyPrintJsonText('"문자열 하나"').ok, true);   // 스칼라도 유효한 JSON
  assert.equal(prettyPrintJsonText("{broken").ok, false);
  assert.equal(prettyPrintJsonText("   ").ok, false);
  assert.equal(prettyPrintJsonText(null).ok, false);
});

test("HWPX 본문 섹션은 숫자 순서로 고르고 다른 압축 항목은 제외한다", () => {
  assert.deepEqual(orderHwpxSections([
    "mimetype", "Contents/header.xml", "Contents/section10.xml", "Contents/section2.xml",
    "Contents\\section0.xml", "BinData/image1.png", "Preview/PrvText.txt", "Contents/section1.xml.bak"
  ]), ["Contents/section0.xml", "Contents/section2.xml", "Contents/section10.xml"]);
  assert.deepEqual(orderHwpxSections([]), []);
  assert.deepEqual(orderHwpxSections(null), []);
});

test("Office XML 본문은 접두사와 서식 실행이 달라도 문단 단위로 합친다", () => {
  const xml = [
    '<x:p xmlns:x="urn:test"><x:t>중요</x:t><x:t>문장 &amp; 표</x:t></x:p>',
    '<p><t>둘째</t><t> 문단</t></p>'
  ].join("");
  assert.deepEqual(officeXmlParagraphLines(xml, 100).lines, ["중요문장 & 표", "둘째 문단"]);
  assert.equal(officeXmlTextRuns('<a:t>첫째</a:t><z:t>둘째</z:t>', " ", 100).text, "첫째 둘째");
  const limited = officeXmlParagraphLines('<w:p><w:t>' + "가".repeat(30) + '</w:t></w:p>', 10);
  assert.equal(limited.chars, 10);
  assert.equal(limited.truncated, true);
});

test("렌더된 본문 검색은 여러 텍스트 노드에 걸친 일치 구간을 계산한다", () => {
  assert.deepEqual(renderedTextMatchSegments(["앞 ", "중요", "문장", " 뒤"], "중요문장"), [
    { index:1, start:0, end:2 },
    { index:2, start:0, end:2 }
  ]);
  assert.deepEqual(renderedTextMatchSegments(["Alpha", "Beta"], "hab"), [
    { index:0, start:3, end:5 },
    { index:1, start:0, end:1 }
  ]);
  assert.deepEqual(renderedTextMatchSegments(["없음"], "검색"), []);
});

test("JSON 트리 노드 정보는 타입·자식 수·잘린 문자열을 구분한다", () => {
  assert.deepEqual(jsonTreeNodeInfo({ a: 1, b: 2, c: 3 }), { kind: "object", container: true, count: 3, summary: "{ 3개 }" });
  assert.deepEqual(jsonTreeNodeInfo([10, 20]), { kind: "array", container: true, count: 2, summary: "[ 2개 ]" });
  assert.deepEqual(jsonTreeNodeInfo({}), { kind: "object", container: true, count: 0, summary: "{ }" });
  assert.deepEqual(jsonTreeNodeInfo([]), { kind: "array", container: true, count: 0, summary: "[ ]" });
  assert.deepEqual(jsonTreeNodeInfo(null), { kind: "null", container: false, text: "null" });
  assert.deepEqual(jsonTreeNodeInfo(true), { kind: "boolean", container: false, text: "true" });
  assert.deepEqual(jsonTreeNodeInfo(3.5), { kind: "number", container: false, text: "3.5" });
  assert.deepEqual(jsonTreeNodeInfo("짧은 값"), { kind: "string", container: false, text: '"짧은 값"' });
  const long = jsonTreeNodeInfo("x".repeat(1500), 200);
  assert.equal(long.kind, "string");
  assert.match(long.text, /^"x{200}" … \(1,500자\)$/);
});

test("CSV 행과 필드를 따옴표 규칙에 맞게 파싱한다", () => {
  const text = 'name,note\r\n"홍,길동","1행\n2행"\r\n"quote ""ok""",done\r\n';
  const starts = indexCsvRows(text);
  assert.equal(starts.length, 3);
  assert.equal(detectCsvDelimiter(text.slice(0, starts[1])), ",");
  assert.deepEqual(parseCsvRecord(text.slice(starts[1], starts[2]), ","), ["홍,길동", "1행\n2행"]);
  assert.deepEqual(parseCsvRecord(text.slice(starts[2]), ","), ['quote "ok"', "done"]);
  assert.equal(detectCsvDelimiter("a\tb\tc"), "\t");
});

test("작업공간 바이너리를 손실 없이 왕복한다", () => {
  const input = [
    { path: "수업/예제.py", bytes: Uint8Array.from([1, 2, 3]) },
    { path: "memo.txt", bytes: new TextEncoder().encode("안녕") }
  ];
  const decoded = decodeWorkspace(encodeWorkspace(input, 1024));
  assert.deepEqual(decoded.map((row) => row.path), input.map((row) => row.path));
  assert.deepEqual([...decoded[0].bytes], [1, 2, 3]);
  assert.equal(new TextDecoder().decode(decoded[1].bytes), "안녕");
});

test("대량 이미지 생략 표식은 폴더 경로와 안전하게 왕복한다", () => {
  const marker = workspaceImageSkipMarkerPath("사진/2026/");
  assert.equal(workspaceImageSkipFolderPath(marker), "사진/2026");
  assert.equal(workspaceImageSkipFolderPath("사진/2026/a.jpg"), "");
});

test("빈 폴더 표시는 작업공간의 숨김 마커로 손실 없이 왕복한다", () => {
  const folder = "수업/dataOut/빈 폴더";
  const marker = workspaceFolderMarkerPath(folder);
  const decoded = decodeWorkspace(encodeWorkspace([{ path:marker, bytes:new Uint8Array(0) }], 1024));
  assert.equal(decoded[0].path, marker);
  assert.equal(decoded[0].bytes.length, 0);
  assert.equal(workspaceFolderPathFromMarker(decoded[0].path), folder);
  assert.equal(workspaceFolderPathFromMarker("수업/data.csv"), "");
});

test("작업공간 크기 제한과 손상된 입력을 거부한다", () => {
  assert.throws(() => encodeWorkspace([{ path: "a", bytes: new Uint8Array(20) }], 10), /workspace-too-large/);
  assert.throws(() => decodeWorkspace(Uint8Array.from([1, 0, 0, 0, 8])), /bad-workspace/);
  assert.throws(() => decodeWorkspace(Uint8Array.from([0, 0, 0, 0, 1])), /bad-workspace/);
});

test("Python 대표 오류를 학생용 도움말로 바꾼다", () => {
  const syntax = explainPythonError('File "<exec>", line 2\nSyntaxError: invalid syntax');
  assert.equal(syntax.type, "SyntaxError");
  assert.match(syntax.tip, /괄호|콜론/);
  assert.equal(explainPythonError("SyntaxError: positional argument follows keyword argument").title, "함수에 넣은 값의 순서가 맞지 않아요");
  assert.equal(explainPythonError("SyntaxError: '(' was never closed").title, "괄호나 따옴표가 닫히지 않았어요");
  assert.equal(explainPythonError("IndentationError: expected an indented block after 'if' statement on line 1").title, "들여쓴 코드 블록이 필요해요");
  const name = explainPythonError("NameError: name 'score' is not defined");
  assert.equal(name.title, "아직 만든 적 없는 이름이에요");
  assert.equal(explainPythonError("UnboundLocalError: cannot access local variable 'count' where it is not associated with a value").title, "함수 안에서 값을 넣기 전에 읽고 있어요");
  assert.equal(explainPythonError("ValueError: invalid literal for int() with base 10: 'abc'").title, "정수로 바꿀 수 없는 값이에요");
  assert.equal(explainPythonError("ValueError: could not convert string to float: '3점'").title, "실수로 바꿀 수 없는 값이에요");
  assert.equal(explainPythonError("ValueError: math domain error").title, "수학 함수에 넣을 수 없는 값이에요");
  assert.equal(explainPythonError("ValueError: list.remove(x): x not in list").title, "찾으려는 값이 안에 없어요");
  assert.equal(explainPythonError("ValueError: not enough values to unpack (expected 2, got 1)").title, "나눠 담을 변수 개수가 맞지 않아요");
  const missingArg = explainPythonError("TypeError: add() missing 1 required positional argument: 'second'");
  assert.equal(missingArg.title, "함수에 넣은 값 개수가 맞지 않아요");
  assert.match(missingArg.tip, /매개변수|인자/);
  assert.equal(explainPythonError("TypeError: unsupported operand type(s) for +: 'int' and 'str'").title, "서로 맞지 않는 값끼리 계산하고 있어요");
  assert.equal(explainPythonError('TypeError: can only concatenate str (not "int") to str').title, "문자열과 다른 값은 바로 붙일 수 없어요");
  assert.equal(explainPythonError("TypeError: 'int' object is not callable").title, "함수처럼 부를 수 없는 값이에요");
  assert.equal(explainPythonError("TypeError: 'int' object is not subscriptable").title, "대괄호로 꺼낼 수 없는 값이에요");
  assert.equal(explainPythonError("TypeError: list indices must be integers or slices, not str").title, "순서 번호는 정수로 써야 해요");
  assert.equal(explainPythonError("TypeError: object of type 'int' has no len()").title, "길이를 셀 수 없는 값이에요");
  assert.equal(explainPythonError("TypeError: '<' not supported between instances of 'str' and 'int'").title, "서로 다른 종류의 값은 비교할 수 없어요");
  assert.equal(explainPythonError("TypeError: argument of type 'int' is not iterable").title, "여러 값처럼 다룰 수 없는 값이에요");
  assert.equal(explainPythonError("IndexError: list index out of range").title, "없는 순서 번호를 꺼내고 있어요");
  assert.equal(explainPythonError("KeyError: 'name'").title, "딕셔너리에 없는 키를 찾고 있어요");
  assert.equal(explainPythonError("AttributeError: 'str' object has no attribute 'append'").title, "이 값에는 그런 기능이 없어요");
  assert.equal(explainPythonError("AttributeError: module 'random' has no attribute 'randit'").title, "모듈에서 해당 이름을 찾지 못했어요");
  assert.equal(explainPythonError("ModuleNotFoundError: No module named 'pandas'").title, "설치되지 않았거나 이름이 다른 모듈이에요");
  assert.equal(explainPythonError("ImportError: cannot import name 'mean' from 'math'").title, "모듈 안에서 가져올 이름을 찾지 못했어요");
  assert.equal(explainPythonError("FileNotFoundError: [Errno 2] No such file or directory: 'data.csv'").title, "지정한 파일 경로가 없어요");
  assert.equal(explainPythonError("PermissionError: [Errno 13] Permission denied: 'data.csv'").title, "파일이나 폴더를 사용할 권한이 없어요");
  assert.equal(explainPythonError("UnicodeDecodeError: 'utf-8' codec can't decode byte 0xb0 in position 0").title, "파일의 문자 인코딩을 해석하지 못했어요");
  assert.equal(explainPythonError("json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes").title, "JSON 문법이 올바르지 않아요");
  assert.equal(explainPythonError("RecursionError: maximum recursion depth exceeded").title, "함수가 너무 깊게 반복 호출됐어요");
  assert.equal(explainPythonError("KeyboardInterrupt").title, "사용자가 실행을 중단했어요");
  assert.equal(explainPythonError("ZeroDivisionError: division by zero").title, "0으로 나누고 있어요");
  assert.equal(explainPythonError("plain output"), null);
});

test("내용 검색 일치 줄과 미리보기를 만든다", () => {
  const hit = contentMatchSnippet("첫 줄\nScore = 95\n마지막 줄", "score");
  assert.deepEqual(hit, { line: 2, text: "Score = 95" });
  assert.equal(contentMatchSnippet("abc", "없음"), null);
});

test("압축 엔트리 경로를 정규화하고 상위 폴더 탈출을 거부한다", () => {
  assert.equal(safeArchivePath("\\수업\\.\\코드\\main.py"), "수업/코드/main.py");
  assert.equal(safeArchivePath("수업/../비밀.txt"), null);
  assert.equal(safeArchivePath("../outside.py"), null);
  assert.equal(safeArchivePath(""), null);
});

test("작업공간 경로를 하위 폴더별로 한 번에 색인한다", () => {
  const index = indexWorkspacePathsByFolder([
    "수업/파이썬/main.py",
    "수업/파이썬/data/input.txt",
    "수업/문서/안내.pdf",
    "단일.txt"
  ]);
  assert.deepEqual(index.get("수업/파이썬"), [
    "수업/파이썬/main.py",
    "수업/파이썬/data/input.txt"
  ]);
  assert.deepEqual(index.get("수업/파이썬/data"), ["수업/파이썬/data/input.txt"]);
  assert.deepEqual(index.get("수업/문서"), ["수업/문서/안내.pdf"]);
  assert.equal(index.has("수업"), false);
});

test("ZIP 열기 결과에서 형식·용량·실패 사유를 구분한다", () => {
  assert.equal(
    formatZipOpenSummary({ opened: 7, unsupported: 2, oversized: 1, failed: 3 }),
    "7개 열기 · 2개 형식 미지원 · 1개 용량 제한 제외 · 3개 열기 실패"
  );
  assert.equal(formatZipOpenSummary({ opened: 4 }), "4개 열기");
});

test("예시 문자열에서 학습용 정규식 후보를 만든다", () => {
  const suggestions = suggestRegexPatterns("abc43");
  assert.deepEqual(suggestions.map((item) => item.pattern), [
    "abc43",
    "[a-z]{3}[0-9]{2}",
    "[A-Za-z]{3}[0-9]{2}",
    "[a-z]{3,}[0-9]{2,}",
    "[a-z]+[0-9]+",
    "([a-z]+)([0-9]+)"
  ]);
  assert.match(suggestions[1].description, /소문자 3개/);
  assert.deepEqual(suggestRegexPatterns("가나-12").map((item) => item.pattern).slice(0, 2), [
    "가나-12",
    "[가-힣]{2}-[0-9]{2}"
  ]);
  assert.deepEqual(suggestRegexPatterns(""), []);
});

test("추천 정규식의 일치 개수를 안전하게 계산한다", () => {
  assert.equal(countRegexMatches("abc43 ABC43 abc999", "[a-z]{3}[0-9]{2}"), 2);
  assert.equal(countRegexMatches("abc43 ABC43 abc999", "[A-Za-z]+[0-9]+"), 3);
  assert.equal(countRegexMatches("abc", "["), 0);
});

test("사용자 단축키를 일관된 형식으로 정규화하고 키 이벤트와 비교한다", () => {
  assert.equal(normalizeShortcut("shift + ctrl + o"), "Ctrl+Shift+O");
  assert.equal(normalizeShortcut("alt+left"), "Alt+ArrowLeft");
  assert.equal(shortcutFromEventLike({ key:"O", ctrlKey:true, shiftKey:true }), "Ctrl+Shift+O");
  assert.equal(shortcutFromEventLike({ key:"ArrowRight", ctrlKey:true }), "Ctrl+ArrowRight");
  assert.equal(shortcutFromEventLike({ key:"Control", ctrlKey:true }), "");
  assert.equal(shortcutFromEventLike({ key:"a", ctrlKey:true, isComposing:true }), "");
  assert.equal(shortcutMatchesEvent({ key:"Enter", ctrlKey:true }, "Ctrl+Enter"), true);
  assert.equal(shortcutMatchesEvent({ key:"Enter", altKey:true }, "Ctrl+Enter"), false);
  assert.equal(shortcutMatchesEvent({ key:"Enter", ctrlKey:true, shiftKey:true }, "Ctrl+Shift+Enter"), true);
});

test("Python 결과 패널 방향 단축키는 Alt+Shift+방향키만 허용한다", () => {
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowLeft", altKey:true, shiftKey:true }), "show-right");
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowUp", altKey:true, shiftKey:true }), "show-below");
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowRight", altKey:true, shiftKey:true }), "hide-right");
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowDown", altKey:true, shiftKey:true }), "hide-below");
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowRight", altKey:true }), "");
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowRight", altKey:true, shiftKey:true, ctrlKey:true }), "");
  assert.equal(pythonOutputShortcutCommand({ key:"ArrowRight", altKey:true, shiftKey:true, isComposing:true }), "");
});

test("아카이브 안의 상대 경로를 문서 기준으로 계산한다", () => {
  assert.equal(resolveSiblingPath("pages/index.html", "../assets/logo.png#main"), "assets/logo.png");
  assert.equal(resolveSiblingPath("index.html", "한글%20파일.css"), "한글 파일.css");
});

test("PDF 파일 지문은 내용과 길이를 구분하며 같은 입력에는 안정적이다", () => {
  const a = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(fingerprintBytes("a.pdf", a), fingerprintBytes("a.pdf", a));
  assert.notEqual(fingerprintBytes("a.pdf", a), fingerprintBytes("a.pdf", Uint8Array.from([1, 2, 3, 5])));
  assert.notEqual(fingerprintBytes("a.pdf", a), fingerprintBytes("b.pdf", a));
});

test("Markdown은 HTML과 위험한 링크를 이스케이프한다", () => {
  const html = markdownToHtml("# 제목\n\n<script>alert(1)</script> [실행](javascript:alert(1)) [문서](https://example.com)");
  assert.match(html, /<h1>제목<\/h1>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.equal(safeLink("data:text/html,test"), "");
});

test("HTML 살균: 허용 태그·위험 태그 판별", () => {
  assert.equal(htmlTagAllowed("h1"), true);
  assert.equal(htmlTagAllowed("FONT"), true);
  assert.equal(htmlTagAllowed("span"), true);
  assert.equal(htmlTagAllowed("script"), false);
  assert.equal(htmlTagAllowed("iframe"), false);
});

test("HTML 살균: 속성 화이트리스트와 이벤트 핸들러 차단", () => {
  assert.equal(htmlAttrAllowed("font", "color"), true);
  assert.equal(htmlAttrAllowed("a", "href"), true);
  assert.equal(htmlAttrAllowed("span", "class"), true);
  assert.equal(htmlAttrAllowed("img", "onerror"), false);   // 이벤트 핸들러는 금지
  assert.equal(htmlAttrAllowed("div", "onclick"), false);
  assert.equal(htmlAttrAllowed("font", "href"), false);     // 태그에 맞지 않는 속성 금지
});

test("HTML 살균: URL 값은 안전한 스킴만 통과", () => {
  assert.equal(htmlSanitizeUrl("https://example.com"), "https://example.com");
  assert.equal(htmlSanitizeUrl("mailto:a@b.com"), "mailto:a@b.com");
  assert.equal(htmlSanitizeUrl("./img.png"), "./img.png");
  assert.equal(htmlSanitizeUrl("#section"), "#section");
  assert.equal(htmlSanitizeUrl("file.png"), "file.png");
  assert.equal(htmlSanitizeUrl("javascript:alert(1)"), "");
  assert.equal(htmlSanitizeUrl("vbscript:msgbox(1)"), "");
  assert.equal(htmlSanitizeUrl("data:text/html,<script>"), "");
  assert.equal(htmlSanitizeUrl("data:image/png;base64,AAAA", { image: true }), "data:image/png;base64,AAAA");
  assert.equal(htmlSanitizeUrl("data:image/svg+xml,<svg>", { image: true }), "");   // svg 데이터 거부
});

test("HTML 살균: style 값에서 위험 패턴 제거", () => {
  assert.equal(htmlSanitizeStyle("color: blue; font-size: 20px"), "color: blue; font-size: 20px");
  assert.equal(htmlSanitizeStyle("background: url(javascript:alert(1))"), "");
  assert.equal(htmlSanitizeStyle("width: expression(alert(1))"), "");
  assert.equal(htmlSanitizeStyle("x: url(http://a)"), "");   // url() 통째 거부
});

test("Markdown 표와 코드 블록을 렌더링한다", () => {
  const html = markdownToHtml("A | B\n--- | ---\n1 | **2**\n\n```js\nconst x = '<tag>';\n```");
  assert.match(html, /<table>/);
  assert.match(html, /<strong>2<\/strong>/);
  assert.match(html, /class="language-js"/);
  assert.match(html, /&lt;tag&gt;/);
});

test("LaTeX 수식을 MathML 로 변환한다(첨자·분수·근호·합·기호)", () => {
  assert.match(latexToMathML("x^2 + y_i"), /<msup><mi>x<\/mi><mn>2<\/mn><\/msup>/);
  assert.match(latexToMathML("x^2 + y_i"), /<msub><mi>y<\/mi><mi>i<\/mi><\/msub>/);
  assert.match(latexToMathML(String.raw`\frac{a}{b}`), /<mfrac><mrow><mi>a<\/mi><\/mrow><mrow><mi>b<\/mi><\/mrow><\/mfrac>/);
  assert.match(latexToMathML(String.raw`\sqrt{x}`), /<msqrt>/);
  assert.match(latexToMathML(String.raw`\sqrt[3]{x}`), /<mroot>/);
  assert.match(latexToMathML(String.raw`\alpha \leq \beta`), /<mo>α<\/mo>[\s\S]*<mo>≤<\/mo>[\s\S]*<mo>β<\/mo>/);
  // 디스플레이 모드에서 합은 위·아래(under/over)로, 인라인은 옆(sub/sup)으로 붙는다.
  assert.match(latexToMathML(String.raw`\sum_{i=1}^{n}`, true), /<munderover><mo>∑<\/mo>/);
  assert.match(latexToMathML(String.raw`\sum_{i=1}^{n}`, false), /<msubsup><mo>∑<\/mo>/);
  // \text 안 공백은 보존한다.
  assert.match(latexToMathML(String.raw`\text{두 단어}`), /<mtext>두 단어<\/mtext>/);
  // 해석 불가여도 절대 예외로 죽지 않는다.
  assert.doesNotThrow(() => latexToMathML(String.raw`\frac{`));
});

test("마크다운의 $…$ 수식을 렌더하되 코드 안 $ 는 건드리지 않는다", () => {
  // allowHtml:true 경로의 sanitize 는 브라우저 DOMParser 를 쓰므로 여기선 보호/복원 로직만 검증한다.
  const html = markdownToHtml("에너지 $E=mc^2$ 와 `$x$` 코드", { allowHtml: false });
  assert.match(html, /<math[^>]*>[\s\S]*<mi>E<\/mi>[\s\S]*<\/math>/);
  assert.match(html, /<code>\$x\$<\/code>/);
});

test("코드 편집 줄 삭제는 현재 줄과 선택한 여러 줄을 제거한다", () => {
  assert.deepEqual(transformEditorLines("one\ntwo\nthree", 5, 5, "delete"), {
    value: "one\nthree", selectionStart: 5, selectionEnd: 5
  });
  assert.deepEqual(transformEditorLines("one\ntwo\nthree", 0, 8, "delete"), {
    value: "three", selectionStart: 0, selectionEnd: 0
  });
});

test("코드 편집 줄 이동과 아래 복사는 선택 영역을 함께 옮긴다", () => {
  assert.deepEqual(transformEditorLines("one\ntwo\nthree", 4, 7, "move-up"), {
    value: "two\none\nthree", selectionStart: 0, selectionEnd: 3
  });
  assert.deepEqual(transformEditorLines("one\ntwo\nthree", 4, 7, "move-down"), {
    value: "one\nthree\ntwo", selectionStart: 10, selectionEnd: 13
  });
  assert.deepEqual(transformEditorLines("one\ntwo\nthree", 4, 7, "duplicate-down"), {
    value: "one\ntwo\ntwo\nthree", selectionStart: 8, selectionEnd: 11
  });
});

test("Python 줄 주석은 들여쓰기와 선택 범위를 유지하며 토글된다", () => {
  const commented = transformEditorLines("if ok:\n    run()\n    save()", 8, 26, "toggle-comment");
  assert.deepEqual(commented, {
    value: "if ok:\n    # run()\n    # save()", selectionStart: 8, selectionEnd: 30
  });
  assert.deepEqual(transformEditorLines(commented.value, commented.selectionStart, commented.selectionEnd, "toggle-comment"), {
    value: "if ok:\n    run()\n    save()", selectionStart: 8, selectionEnd: 26
  });
  assert.deepEqual(transformEditorLines("", 0, 0, "toggle-comment"), {
    value: "# ", selectionStart: 2, selectionEnd: 2
  });
});

test("Python 자동완성은 현재 코드 식별자와 기본 단어를 접두어로 제안한다", () => {
  const suggestions = pythonCompletionCandidates("def process_data():\n    project_name = ''\n    pro", "pro");
  assert.deepEqual(suggestions.slice(0, 3), ["process_data", "project_name", "property"]);
  assert.ok(pythonCompletionCandidates("", "pri").includes("print"));
  assert.doesNotMatch(pythonCompletionCandidates("print", "print").join(" "), /\bprint\b/);
});

test("언어별 자동완성: 프로파일 키워드로 바꾸면 파이썬 키워드가 섞이지 않는다", () => {
  // 기본(키워드 미지정)은 파이썬 키워드 유지 — 기존 동작 보존
  assert.ok(pythonCompletionCandidates("", "de").includes("def"));
  // JS(C계열) 키워드를 넘기면 파이썬 전용 키워드는 빠지고 JS 키워드가 나온다
  const js = pythonCompletionCandidates("const myVar = 1", "fun", completionWordsForProfile("c", "js"));
  assert.ok(js.includes("function"));
  assert.ok(!pythonCompletionCandidates("", "el", completionWordsForProfile("c", "js")).includes("elif"));
  // 버퍼 식별자는 언제나 키워드보다 먼저 제안된다
  const ranked = pythonCompletionCandidates("myFunction other", "my", completionWordsForProfile("c", "js"));
  assert.equal(ranked[0], "myFunction");
  // 순수 텍스트/알 수 없는 형식은 키워드 없이 버퍼 단어만
  assert.deepEqual(completionWordsForProfile("text"), []);
  assert.deepEqual(pythonCompletionCandidates("alpha beta", "al", []), ["alpha"]);
  // 같은 구문강조 프로파일을 공유해도 확장자 기준으로 다른 언어 키워드만 제안한다.
  assert.ok(!completionWordsForProfile("hash", "yaml").includes("def"));
  assert.ok(!completionWordsForProfile("c", "json").includes("function"));
  assert.ok(completionWordsForProfile("hash", "ps1").includes("foreach"));
});

test("DataFrame fallback completion exposes the pandas member catalog without Jedi", () => {
  const source = [
    "import pandas as pd",
    "ft_frame = pd.DataFrame(most_importances, index=train_features, columns=['Importance'])",
    "ft_frame.sort_"
  ].join("\n");
  assert.deepEqual(pythonMemberCompletionCandidates(source, "ft_frame", "sort_v"), [{
    name:"sort_values",
    type:"function",
    signature:"sort_values(by, ascending=True, inplace=False, na_position='last', ignore_index=False)"
  }]);
  const allMembers = pythonMemberCompletionCandidates(source, "ft_frame", "");
  assert.ok(allMembers.length > 150);
  for (const name of ["groupby", "dropna", "reset_index", "merge", "to_csv", "value_counts"]) {
    assert.ok(allMembers.some(item => item.name === name && item.type === "function"), name);
  }
  assert.ok(allMembers.some(item => item.name === "shape" && item.type === "property"));
  assert.deepEqual(pythonMemberCompletionCandidates("items = []\nitems.sort_", "items", "sort_"), []);
});

test("import completion suggestions carry their import statement", () => {
  assert.deepEqual(pythonImportCompletionCandidates("Pa", "Pa"), [{
    name:"Path", type:"class", importText:"from pathlib import Path"
  }]);
  assert.ok(pythonImportCompletionCandidates("", "p").some(item => item.importText === "import pandas as pd"));
  assert.ok(pythonImportCompletionCandidates("MLP", "MLP").some(item => item.importText === "from sklearn.neural_network import MLPClassifier"));
  assert.ok(pythonImportCompletionCandidates("Count", "Count").some(item => item.importText === "from sklearn.feature_extraction.text import CountVectorizer"));
  assert.ok(pythonImportCompletionCandidates("Sequential", "Sequential").some(item => item.importText === "from tensorflow.keras.models import Sequential"));
  assert.ok(pythonImportCompletionCandidates("word_", "word_").some(item => item.importText === "from nltk.tokenize import word_tokenize"));
  assert.deepEqual(pythonImportCompletionCandidates("External", "External", [{ name:"ExternalTool", type:"class", importText:"from custom_package import ExternalTool" }]), [{
    name:"ExternalTool", type:"class", importText:"from custom_package import ExternalTool"
  }]);
  assert.equal(pythonImportCompletionCandidates("from pathlib import Path\nPa", "Pa").length, 0);
  assert.equal(pythonImportCompletionCandidates("class Path:\n    pass\nPa", "Pa").length, 0);
});

test("workspace import completion indexes Python modules and top-level symbols in other folders", () => {
  const candidates = pythonWorkspaceImportCompletionCandidates(
    "m_project/h.softmax/main.py",
    [{
      path:"m_project/Utility/keras_graph_util.py",
      source:[
        "def model_information(model):",
        "    pass",
        "",
        "class GraphBuilder:",
        "    def render(self):",
        "        pass",
        "",
        "def _private_helper():",
        "    pass"
      ].join("\n")
    }]
  );
  assert.ok(candidates.some(item => item.name === "Utility" && item.importText === "import Utility"));
  assert.ok(candidates.some(item => item.name === "keras_graph_util" && item.importText === "from Utility import keras_graph_util"));
  assert.ok(candidates.some(item => item.name === "model_information" && item.type === "function"
    && item.importText === "from Utility.keras_graph_util import model_information"));
  assert.ok(candidates.some(item => item.name === "GraphBuilder" && item.type === "class"
    && item.importText === "from Utility.keras_graph_util import GraphBuilder"));
  assert.ok(!candidates.some(item => item.name === "render" || item.name === "_private_helper"));
});

test("workspace import completion prefers the nearest valid module path and skips the current file", () => {
  const candidates = pythonWorkspaceImportCompletionCandidates("project/app/main.py", [
    { path:"project/app/main.py", source:"def current_only():\n    pass" },
    { path:"project/app/helper.py", source:"async def load_data():\n    pass" },
    { path:"project/shared/__init__.py", source:"class SharedValue:\n    pass" }
  ]);
  assert.ok(candidates.some(item => item.name === "helper" && item.importText === "import helper"));
  assert.ok(candidates.some(item => item.name === "load_data" && item.importText === "from helper import load_data"));
  assert.ok(candidates.some(item => item.name === "SharedValue" && item.importText === "from shared import SharedValue"));
  assert.ok(!candidates.some(item => item.name === "current_only"));
});

test("workspace auto-import candidates take precedence over the installed-package catalog", () => {
  const result = pythonImportCompletionCandidates("Pa", "Pa", [{
    name:"Path", type:"class", importText:"from local_paths import Path", priority:-1
  }]);
  assert.deepEqual(result, [{
    name:"Path", type:"class", importText:"from local_paths import Path", priority:-1
  }]);
});

test("Class.load 대입은 Jedi 분석용 반환 타입을 보강하되 실제 입력 줄은 바꾸지 않는다", () => {
  const source = [
    "from gensim.models import word2vec",
    "model = word2vec.Word2Vec.load(filename)",
    "model.wv.get_"
  ].join("\n");
  assert.equal(pythonCompletionInferenceSource(source, 3), [
    "from gensim.models import word2vec",
    "model: word2vec.Word2Vec = word2vec.Word2Vec.load(filename)",
    "model.wv.get_"
  ].join("\n"));
  assert.equal(pythonCompletionInferenceSource(source, 2), source);
  assert.equal(
    pythonCompletionInferenceSource("value = loader.load(path)\nvalue.", 2),
    "value = loader.load(path)\nvalue."
  );
});

test("더블클릭 변수 선택은 옆 공백을 제외하고 식별자 전체로 보정한다", () => {
  assert.deepEqual(normalizeIdentifierSelection("total_count = 3", 0, 12), {
    selectionStart: 0, selectionEnd: 11
  });
  assert.deepEqual(normalizeIdentifierSelection("값_합계 = 3", 0, 5), {
    selectionStart: 0, selectionEnd: 4
  });
  assert.deepEqual(normalizeIdentifierSelection("print(total_count)", 8, 10), {
    selectionStart: 6, selectionEnd: 17
  });
});

test("F3 단어 이동은 같은 식별자를 순환하며 부분 단어는 건너뛴다", () => {
  const source = "foo = 1\nfoobar = 2\nprint(foo)\nfoo";
  assert.deepEqual(findNextIdentifierOccurrence(source, 0, 3), {
    selectionStart: 25, selectionEnd: 28
  });
  assert.deepEqual(findNextIdentifierOccurrence(source, 25, 28), {
    selectionStart: 30, selectionEnd: 33
  });
  assert.deepEqual(findNextIdentifierOccurrence(source, 30, 33), {
    selectionStart: 0, selectionEnd: 3
  });
  assert.deepEqual(findNextIdentifierOccurrence(source, 25, 28, true), {
    selectionStart: 0, selectionEnd: 3
  });
  assert.equal(findNextIdentifierOccurrence(source, 4, 4), null);
});

test("Ctrl+클릭 정의 이동은 현재 파일의 Python 함수와 클래스를 찾는다", () => {
  const source = "class Student:\n    pass\n\ndef make_student():\n    return Student()\n\nstudent = Student()";
  assert.deepEqual(findPythonLocalDefinition(source, "Student", source.lastIndexOf("Student")), {
    line: 1, kind: "class", offset: 0
  });
  assert.deepEqual(findPythonLocalDefinition(source, "make_student", source.length), {
    line: 4, kind: "def", offset: 25
  });
  assert.equal(findPythonLocalDefinition(source, "Missing", source.length), null);
});

test("Ctrl+클릭 정의 이동은 작업공간의 from import 로컬 모듈을 찾는다", () => {
  const source = "from Utility.keras_graph_util import model_information\nmodel_information(model)";
  const paths = ["수업자료/main.py", "수업자료/Utility/keras_graph_util.py", "다른반/Utility/keras_graph_util.py"];
  assert.deepEqual(resolvePythonImportedDefinition(source, "model_information", "수업자료/main.py", paths), {
    path:"수업자료/Utility/keras_graph_util.py", importedName:"model_information"
  });
  assert.deepEqual(resolvePythonImportedDefinition("from .Utility.keras_graph_util import model_information as info", "info", "수업자료/main.py", paths), {
    path:"수업자료/Utility/keras_graph_util.py", importedName:"model_information"
  });
  assert.equal(resolvePythonImportedDefinition(source, "missing", "수업자료/main.py", paths), null);
});

test("자동완성 수락은 현재 입력 중인 접두어를 덮어쓴다", () => {
  const source = "items.ap";
  const range = completionReplacementRange(source, source.length, source.length, 6, 6, "append");
  assert.deepEqual(range, { start: 6, end: 8 });
  assert.equal(source.slice(0, range.start) + "append" + source.slice(range.end), "items.append");
});

test("함수 자동완성은 괄호를 넣고 커서를 인수 위치로 옮긴다", () => {
  const source = "json.lo";
  const range = completionReplacementRange(source, source.length, source.length, 5, 7, "loads");
  const insertion = completionInsertionPlan(source, range, { name: "loads", type: "function" });
  assert.deepEqual(insertion, { text: "loads()", caret: 11 });
  assert.equal(source.slice(0, range.start) + insertion.text + source.slice(range.end), "json.loads()");
});

test("함수 자동완성은 기존 여는 괄호를 중복 삽입하지 않는다", () => {
  const source = "json.lo()";
  const range = completionReplacementRange(source, 7, 7, 5, 7, "loads");
  const insertion = completionInsertionPlan(source, range, { name: "loads", type: "function" });
  assert.deepEqual(insertion, { text: "loads", caret: 11 });
  assert.equal(source.slice(0, range.start) + insertion.text + source.slice(range.end), "json.loads()");
});

test("import 줄에서는 함수 자동완성도 괄호를 붙이지 않는다", () => {
  const source = "from math import sqr";
  const range = completionReplacementRange(source, source.length, source.length, 17, source.length, "sqrt");
  const insertion = completionInsertionPlan(source, range, { name: "sqrt", type: "function" });
  assert.deepEqual(insertion, { text: "sqrt", caret: 21 });
  assert.equal(source.slice(0, range.start) + insertion.text + source.slice(range.end), "from math import sqrt");
  // 들여쓴 import(함수 안 지역 import)도 같게 다룬다.
  const indented = "def load():\n    from json import loa";
  const indentedRange = completionReplacementRange(indented, indented.length, indented.length, 32, indented.length, "loads");
  const indentedInsertion = completionInsertionPlan(indented, indentedRange, { name: "loads", type: "function" });
  assert.equal(indentedInsertion.text, "loads");
  // 같은 후보라도 본문에서는 괄호와 인수 위치 커서를 유지한다.
  const body = "value = sqr";
  const bodyRange = completionReplacementRange(body, body.length, body.length, 8, body.length, "sqrt");
  const bodyInsertion = completionInsertionPlan(body, bodyRange, { name: "sqrt", type: "function" });
  assert.deepEqual(bodyInsertion, { text: "sqrt()", caret: 13 });
});

test("변수 자동완성은 이름만 삽입한다", () => {
  const source = "student_na";
  const range = completionReplacementRange(source, source.length, source.length, 0, source.length, "student_name");
  const insertion = completionInsertionPlan(source, range, { name: "student_name", type: "statement" });
  assert.deepEqual(insertion, { text: "student_name", caret: 12 });
});

test("import completion adds one top-level import and keeps the caret at the completed name", () => {
  const source = "#!/usr/bin/env python\n\"\"\"example\"\"\"\nfrom __future__ import annotations\n\nbase = Pa";
  const plan = completionApplicationPlan(source, { start:source.length - 2, end:source.length }, {
    name:"Path", type:"class", importText:"from pathlib import Path"
  });
  assert.equal(plan.value, "#!/usr/bin/env python\n\"\"\"example\"\"\"\nfrom __future__ import annotations\nfrom pathlib import Path\n\nbase = Path");
  assert.equal(plan.caret, plan.value.length);
  const existingSource = "from pathlib import Path\nbase = Pa";
  const existing = completionApplicationPlan(existingSource, { start:existingSource.length - 2, end:existingSource.length }, {
    name:"Path", type:"class", importText:"from pathlib import Path"
  });
  assert.equal(existing.value, "from pathlib import Path\nbase = Path");
});

test("같은 모듈의 import 자동완성은 기존 from 문에 쉼표로 합친다", () => {
  const source = "from sklearn.metrics import accuracy_score\nmatrix = confusion_mat";
  const plan = completionApplicationPlan(source, { start:source.length - "confusion_mat".length, end:source.length }, {
    name:"confusion_matrix", type:"function", importText:"from sklearn.metrics import confusion_matrix"
  });
  assert.equal(
    plan.value,
    "from sklearn.metrics import accuracy_score, confusion_matrix\nmatrix = confusion_matrix()"
  );
  assert.equal(plan.caret, plan.value.length - 1);
});

test("같은 모듈 import 병합은 주석과 별칭을 보존한다", () => {
  const source = "from selenium.webdriver.support.ui import WebDriverWait  # 대기 도구\ncondition = E";
  const plan = completionApplicationPlan(source, { start:source.length - 1, end:source.length }, {
    name:"EC", type:"module", importText:"from selenium.webdriver.support.ui import expected_conditions as EC"
  });
  assert.equal(
    plan.value,
    "from selenium.webdriver.support.ui import WebDriverWait, expected_conditions as EC  # 대기 도구\ncondition = EC"
  );
});

test("괄호형 여러 줄 import 자동완성은 기존 형식 안에 항목을 추가한다", () => {
  const source = "from sklearn.metrics import (\n    accuracy_score,\n)\nmatrix = confusion_mat";
  const plan = completionApplicationPlan(source, { start:source.length - "confusion_mat".length, end:source.length }, {
    name:"confusion_matrix", type:"function", importText:"from sklearn.metrics import confusion_matrix"
  });
  assert.equal(
    plan.value,
    "from sklearn.metrics import (\n    accuracy_score,\n    confusion_matrix,\n)\nmatrix = confusion_matrix()"
  );
});

test("쉼표 목록과 import star는 같은 자동 import 후보를 중복 제안하지 않는다", () => {
  assert.equal(
    pythonImportCompletionCandidates("from sklearn.metrics import accuracy_score, confusion_matrix\nconf", "conf")
      .some((item) => item.name === "confusion_matrix"),
    false
  );
  assert.equal(
    pythonImportCompletionCandidates("from sklearn.metrics import *\nconf", "conf")
      .some((item) => item.name === "confusion_matrix"),
    false
  );
});

test("실행 결과 파일을 논리 프로젝트 경로에 이어 붙인다", () => {
  assert.equal(resolveRuntimeOutputPath("lesson/main.py", "result.txt", "", false), "lesson/result.txt");
  assert.equal(resolveRuntimeOutputPath("course/pkg/main.py", "pkg/result.txt", "course", true), "course/pkg/result.txt");
  assert.equal(resolveRuntimeOutputPath("main.py", "data/out.csv", "", true), "data/out.csv");
  assert.equal(resolveRuntimeOutputPath("course/lesson.ipynb", "dataIn/result01.csv", "course", true), "course/dataIn/result01.csv");
  assert.equal(
    resolveRuntimeOutputPath(
      "m_project/e.class.decision_tree/lesson.py",
      "m_project/dataOut/chart.png",
      "m_project",
      true
    ),
    "m_project/dataOut/chart.png"
  );
});

test("Python 자동 실행 기준은 파일 폴더를 유지하고 상위 상대경로를 해석한다", () => {
  const paths = [
    "09_Python/PythonProject/python_project/ch12_database_sqlite/FromXmlToDatabase.py",
    "09_Python/PythonProject/python_project/dataIn/shopList.xml",
    "09_Python/PythonProject/python_project/dataIn/customerList.xml"
  ];
  const context = inferPythonProjectRunContext(
    paths[0],
    "tree = parse('../dataIn/shopList.xml')\ncon = sqlite3.connect('../sqlite3.db')",
    [...paths, "09_Python/PythonProject/python_project/sqlite3.db"]
  );
  assert.equal(context.cwd, "09_Python/PythonProject/python_project/ch12_database_sqlite");
  assert.deepEqual(context.references, [
    { ref:"../dataIn/shopList.xml", path:"09_Python/PythonProject/python_project/dataIn/shopList.xml" },
    { ref:"../sqlite3.db", path:"09_Python/PythonProject/python_project/sqlite3.db" }
  ]);
});

test("자동 실행 기준은 일치하는 파일을 찾아 상위 프로젝트 폴더로 이동하지 않는다", () => {
  const target = "m_project/a.basic/corr_heatmap.py";
  const context = inferPythonProjectRunContext(
    target,
    "pd.read_csv('dataIn/auto-mpg.csv')",
    [target, "m_project/dataIn/auto-mpg.csv"]
  );
  assert.equal(context.cwd, "m_project/a.basic");
  assert.deepEqual(context.references, []);
});

test("Python 실행 기준 폴더를 직접 선택하면 새 출력 경로도 그 기준으로 계산한다", () => {
  const target = "09_Python/PythonProject/python_project/ch11_xml&json/XmlExam01.py";
  const context = inferPythonProjectRunContext(target, "xmlFile = 'dataOut/xmlEx_01.xml'", [
    target,
    "09_Python/dataOut/기존파일.xml"
  ], { preferredCwd:"09_Python" });
  assert.equal(context.cwd, "09_Python");
  assert.equal(context.preferred, true);
  assert.equal(resolveProjectRelativePath(context.cwd, "dataOut/xmlEx_01.xml"), "09_Python/dataOut/xmlEx_01.xml");
});

test("존재하는 상위 출력 폴더도 파일 폴더 기준 상대경로로 계산한다", () => {
  const target = "test/09_Python/PythonProject/python_project/ch11_xml&json/XmlEx01.py";
  const context = inferPythonProjectRunContext(target, "xmlFile = '../../../dataOut/xmlEx_01.xml'", [target], {
    availableDirs:[
      "test/09_Python",
      "test/09_Python/dataOut",
      "test/09_Python/PythonProject/python_project/ch11_xml&json"
    ]
  });
  assert.equal(context.cwd, "test/09_Python/PythonProject/python_project/ch11_xml&json");
  assert.deepEqual(context.outputDirectories, [{
    ref:"../../../dataOut/xmlEx_01.xml",
    path:"test/09_Python/dataOut/xmlEx_01.xml",
    directory:"test/09_Python/dataOut"
  }]);
});

test("하위 폴더의 노트북도 파일 폴더 기준으로 상위 dataIn 경로를 찾는다", () => {
  const target = "09_Python/ch13_pandas/Chap03.InputOutput.ipynb";
  const context = inferPythonProjectRunContext(
    target,
    "filename = '../dataIn/result01_copy.csv'\npd.read_csv(filename)",
    [target, "09_Python/dataIn/result01_copy.csv"],
    { availableDirs:["09_Python", "09_Python/dataIn", "09_Python/ch13_pandas"] }
  );
  assert.equal(context.cwd, "09_Python/ch13_pandas");
  assert.deepEqual(context.references, [{
    ref:"../dataIn/result01_copy.csv",
    path:"09_Python/dataIn/result01_copy.csv"
  }]);
});

test("Python 실행 묶음은 참조한 데이터 파일만 포함하고 같은 데이터 폴더 전체를 끌어오지 않는다", () => {
  const target = "09_Python/python_project/ch11_xml&json/XmlTest03.py";
  const references = ["09_Python/dataIn/Car_Info.xml"];
  assert.equal(pythonRunScopeIncludesPath(target, target, references), true);
  assert.equal(pythonRunScopeIncludesPath("09_Python/dataIn/Car_Info.xml", target, references), true);
  assert.equal(pythonRunScopeIncludesPath("09_Python/dataIn/large-dataset.csv", target, references), false);
});

test("Python 실행 묶음은 상위 폴더의 로컬 import 패키지를 포함한다", () => {
  const target = "m_project/h.softmax/fashionMnistExam.py";
  const paths = [
    target,
    "m_project/h.softmax/fashionMnistInfo.py",
    "m_project/Utility/keras_graph_util.py",
    "m_project/dataIn/input.csv"
  ];
  const roots = inferPythonLocalImportRoots(
    target,
    "from Utility.keras_graph_util import plot_gray_image\nimport fashionMnistInfo",
    paths,
    { cwd:"m_project/h.softmax", availableDirs:["m_project/Utility"] }
  );
  assert.deepEqual([...roots].sort(), ["m_project/Utility", "m_project/h.softmax/fashionMnistInfo.py"].sort());
  assert.equal(pythonRunScopeIncludesPath("m_project/Utility/keras_graph_util.py", target, [], roots), true);
  assert.equal(pythonRunScopeIncludesPath("m_project/dataIn/input.csv", target, [], roots), false);
});

test("Python 실행 묶음은 상위 폴더의 .env 계열을 포함한다(dotenv 상향 탐색)", () => {
  const target = "09_Python/PythonProject/api_test.py";
  assert.equal(pythonRunScopeIncludesPath("09_Python/.env", target), true);                 // 상위 폴더
  assert.equal(pythonRunScopeIncludesPath(".env", target), true);                           // 최상위
  assert.equal(pythonRunScopeIncludesPath("09_Python/PythonProject/.env", target), true);   // 같은 폴더
  assert.equal(pythonRunScopeIncludesPath("09_Python/.env.local", target), true);           // 변형
  assert.equal(pythonRunScopeIncludesPath("09_Python/other/.env", target), false);          // 무관한 형제 폴더
  assert.equal(pythonRunScopeIncludesPath("09_Python/.environment.txt", target), false);
});

test("프로젝트 상대경로가 없으면 Python 파일 폴더를 실행 기준으로 유지한다", () => {
  const target = "lesson/ch09_file_io/FileIo02.py";
  const context = inferPythonProjectRunContext(target, "open('test.txt')", [
    target,
    "lesson/ch09_file_io/test.txt",
    "lesson/dataIn/shopList.xml"
  ]);
  assert.equal(context.cwd, "lesson/ch09_file_io");
  assert.deepEqual(context.references, [
    { ref:"test.txt", path:"lesson/ch09_file_io/test.txt" }
  ]);
});

test("Python 문자열 변수 결합은 필요한 프로젝트 파일만 정확히 찾는다", () => {
  const target = "09_Python/PythonProject/python_project/ch17_textMining/speechTextMining01.py";
  const source = [
    "dataInFolder = '../../../dataIn/'",
    "filename = dataInFolder + '윤석열 제20대 대통령 취임사.txt'",
    "user_dict = dataInFolder + 'user_dict.txt'",
    "stopword = dataInFolder + 'stopword.txt'"
  ].join("\n");
  const context = inferPythonProjectRunContext(target, source, [
    target,
    "09_Python/dataIn/윤석열 제20대 대통령 취임사.txt",
    "09_Python/dataIn/user_dict.txt",
    "09_Python/dataIn/stopword.txt",
    "09_Python/dataIn/large-unrelated.csv"
  ]);
  assert.equal(context.cwd, "09_Python/PythonProject/python_project/ch17_textMining");
  assert.deepEqual(context.references, [
    { ref:"../../../dataIn/윤석열 제20대 대통령 취임사.txt", path:"09_Python/dataIn/윤석열 제20대 대통령 취임사.txt" },
    { ref:"../../../dataIn/user_dict.txt", path:"09_Python/dataIn/user_dict.txt" },
    { ref:"../../../dataIn/stopword.txt", path:"09_Python/dataIn/stopword.txt" }
  ]);
});

test("Python 다중 변수 경로 대입도 뒤 문자열 결합까지 추적한다", () => {
  const target = "m_project/d.clsss.knn/knn_likelyhood.py";
  const source = [
    "dataIn, dataOut = '../dataIn/', '../dataOut/'",
    "filename = dataIn + 'likelyhood.csv'",
    "myframe = pd.read_csv(filename)"
  ].join("\n");
  const context = inferPythonProjectRunContext(target, source, [
    target,
    "m_project/dataIn/likelyhood.csv"
  ]);
  assert.equal(context.cwd, "m_project/d.clsss.knn");
  assert.deepEqual(context.references, [{
    ref:"../dataIn/likelyhood.csv",
    path:"m_project/dataIn/likelyhood.csv"
  }]);
});

test("Python 함수 인수 안의 경로 변수 결합도 필요한 파일을 찾는다", () => {
  const target = "m_project/k.national/toji-word2vec.py";
  const source = [
    "dataIn, dataOut = '../dataIn/', '../dataOut/'",
    "fp = codecs.open(filename=dataIn + 'BEXX0003.txt', mode='r', encoding='utf-8')"
  ].join("\n");
  const context = inferPythonProjectRunContext(target, source, [
    target,
    "m_project/dataIn/BEXX0003.txt"
  ]);
  assert.deepEqual(context.references, [{
    ref:"../dataIn/BEXX0003.txt",
    path:"m_project/dataIn/BEXX0003.txt"
  }]);
});

test("같은 식별자들을 한 번의 편집으로 함께 바꾼다", () => {
  const source = "score = 1\nprint(score)\nscore2 = score\n# score\nlabel = 'score'";
  const selected = identifierOccurrences(source, 0, 5);
  assert.equal(selected.ranges.length, 3);
  const edit = applyLinkedIdentifierEdit(source, selected.ranges, selected.primaryIndex, 0, 5, "total");
  assert.equal(edit.value, "total = 1\nprint(total)\nscore2 = total\n# score\nlabel = 'score'");
  const removed = applyLinkedIdentifierEdit(source, selected.ranges, selected.primaryIndex, 0, 5, "");
  assert.equal(removed.value, " = 1\nprint()\nscore2 = \n# score\nlabel = 'score'");
  const primaryEmpty = removed.ranges[removed.primaryIndex];
  const retyped = applyLinkedIdentifierEdit(removed.value, removed.ranges, removed.primaryIndex, primaryEmpty.start, primaryEmpty.end, "total");
  assert.equal(retyped.value, "total = 1\nprint(total)\nscore2 = total\n# score\nlabel = 'score'");
  assert.deepEqual(diffTextEdit(source, source.replace("score", "total")), { start: 0, end: 5, inserted: "total" });
  assert.equal(identifierOccurrences(source, source.indexOf("score2"), source.indexOf("score2") + 6), null);
});

test("텍스트 편집 뒤 미사용 의미 범위는 안전한 위치만 유지하고 이동한다", () => {
  const before = "unused = 1\nsecond = 2\nprint('ok')";
  const ranges = [
    { start:0, end:6, name:"unused" },
    { start:11, end:17, name:"second" }
  ];
  const prefixed = "# memo\n" + before;
  assert.deepEqual(remapTextRangesAfterEdit(ranges, before, prefixed), [
    { start:7, end:13, name:"unused" },
    { start:18, end:24, name:"second" }
  ]);

  const touched = before.slice(0, 3) + "X" + before.slice(4);
  assert.deepEqual(remapTextRangesAfterEdit(ranges, before, touched), [
    { start:11, end:17, name:"second" }
  ]);

  const joined = "x" + before;
  assert.deepEqual(remapTextRangesAfterEdit(ranges, before, joined), [
    { start:12, end:18, name:"second" }
  ]);
});

test("open 대입문 다음에는 작업 줄과 close 호출 계획을 만든다", () => {
  const source = '    file = open("data.txt", encoding="utf-8")';
  const plan = pythonOpenClosePlan(source, source.length, source.length);
  assert.equal(source + plan.inserted, '    file = open("data.txt", encoding="utf-8")\n    \n    file.close()');
  assert.equal(plan.variable, "file");
  assert.equal(pythonOpenClosePlan('with open("a.txt") as file:', 31, 31), null);
});

test("트레이스백에서 열린 Python 파일의 정확한 위치를 고른다", () => {
  const stderr = 'Traceback\\n  File "main.py", line 4, in <module>\\n  File "helper.py", line 9, in run\\nValueError: bad';
  assert.deepEqual(parsePythonTracebackLocation(stderr, "main.py", ["main.py", "helper.py"]), {
    path: "helper.py", file: "helper.py", line: 9, current: false
  });
});

test("선택한 코드 줄은 Tab과 Shift+Tab으로 들여쓰기와 내어쓰기를 한다", () => {
  const indented = transformEditorLines("one\ntwo\nthree", 0, 8, "indent");
  assert.deepEqual(indented, {
    value: "    one\n    two\nthree", selectionStart: 4, selectionEnd: 16
  });
  assert.deepEqual(transformEditorLines(indented.value, indented.selectionStart, indented.selectionEnd, "outdent"), {
    value: "one\ntwo\nthree", selectionStart: 0, selectionEnd: 8
  });
  assert.deepEqual(transformEditorLines("  one\n\ttwo", 0, 10, "outdent"), {
    value: "one\ntwo", selectionStart: 0, selectionEnd: 7
  });
});

test("code-link line helpers map offsets and line starts", () => {
  const source = "one\nsecond\nthree\n";
  assert.equal(lineNumberAtOffset(source, 0), 1);
  assert.equal(lineNumberAtOffset(source, 4), 2);
  assert.equal(lineNumberAtOffset(source, source.length), 4);
  assert.equal(lineStartOffset(source, 1), 0);
  assert.equal(lineStartOffset(source, 2), 4);
  assert.equal(lineStartOffset(source, 99), source.length);
});

test("Python 실행 변수 목록은 내부 이름과 중복을 제외하고 긴 값을 제한한다", () => {
  const rows = normalizePythonVariables([
    { name:"score", type:"int", value:"95" },
    { name:"_internal", type:"str", value:"숨김" },
    { name:"score", type:"int", value:"100" },
    { name:"names", type:"list", value:"가".repeat(700) }
  ]);
  assert.deepEqual(rows.slice(0, 2).map(row => [row.name, row.type]), [["score","int"],["names","list"]]);
  assert.equal(rows[0].value, "95");
  assert.equal(rows[1].value.length, 600);
  assert.equal(rows[1].value.endsWith("…"), true);
});

test("변수 목록은 DataFrame 의 표 HTML 과 shape 를 있을 때만 통과시킨다", () => {
  const rows = normalizePythonVariables([
    { name:"df", type:"DataFrame", value:"...", html:"<table><tr><td>1</td></tr></table>", shape:"30×25", tableNote:"앞 20행 × 20열 미리보기" },
    { name:"x", type:"int", value:"", lazy:true }
  ]);
  assert.equal(rows[0].html, "<table><tr><td>1</td></tr></table>");
  assert.equal(rows[0].shape, "30×25");
  assert.equal(rows[0].tableNote, "앞 20행 × 20열 미리보기");
  assert.equal("html" in rows[1], false);   // 일반 값에는 html 필드를 만들지 않는다
  assert.equal("shape" in rows[1], false);
  assert.equal("tableNote" in rows[1], false);
  assert.equal(rows[1].lazy, true);
});

test("과제 자동채점 테스트를 정리하고 출력의 의미 없는 공백을 통일한다", () => {
  const rows = normalizeAssignmentTests([
    { name:"  덧셈  ", input:"2\r\n3\r\n", expected:"5  \r\n" },
    { name:"", input:null, expected:0 },
    null
  ]);
  assert.deepEqual(rows, [
    { name:"덧셈", input:"2\n3\n", expected:"5  \n" },
    { name:"테스트 2", input:"", expected:"0" }
  ]);
  assert.equal(normalizeGradingOutput("\r\n  결과  \r\n\r\n"), "  결과");
  assert.equal(normalizeGradingOutput("a  \n b\t"), "a\n b");
});

test("숨김 테스트의 실행 오류는 학생용 공통 오류 안내에서 제외한다", () => {
  const report = { results: [
    { error: "공개 테스트 오류" },
    { error: "숨김 입력 12345 노출" },
    { error: "" }
  ] };
  const tests = [{}, { hidden: true }, {}];
  assert.equal(assignmentGradingErrorText(report, tests, "fallback"), "공개 테스트 오류");
  assert.equal(assignmentGradingErrorText(null, tests, "채점기 오류"), "채점기 오류");
});

test("Python 실행 전 진단 결과를 위치와 심각도 순으로 정리한다", () => {
  const rows = normalizePythonDiagnostics([
    { severity:"warning", line:4, column:2, code:"PY-NAME", message:"이름 없음", hint:"먼저 정의" },
    { severity:"error", line:2, column:0, code:"SyntaxError", message:"문법 오류" },
    { severity:"unknown", line:2, column:-5, code:"X", message:"기본 경고" },
    { severity:"info", line:0, message:"첫 줄 참고" },
    { severity:"warning", line:1, message:"" }
  ]);
  assert.deepEqual(rows.map(row => [row.severity, row.line, row.column, row.code]), [
    ["info", 1, 0, ""],
    ["error", 2, 0, "SyntaxError"],
    ["warning", 2, 0, "X"],
    ["warning", 4, 2, "PY-NAME"]
  ]);
});

test("Python 미사용 심볼 범위는 중복과 잘못된 길이를 제거해 위치순으로 정리한다", () => {
  const rows = normalizePythonUnusedRanges([
    { line:3, column:8, length:4, name:"idle", kind:"function" },
    { line:1, column:7, length:2, name:"os", kind:"import" },
    { line:1, column:7, length:2, name:"os", kind:"import" },
    { line:2, column:0, length:2, name:"value", kind:"variable" },
    { line:4, column:0, length:1, name:"x", kind:"unknown" }
  ]);
  assert.deepEqual(rows, [
    { line:1, column:7, length:2, name:"os", kind:"import" },
    { line:3, column:8, length:4, name:"idle", kind:"function" },
    { line:4, column:0, length:1, name:"x", kind:"variable" }
  ]);
});

test("Python 단계 실행 보고서의 변수와 변경 내역을 안전하게 제한한다", () => {
  const report = normalizePythonTraceReport({
    truncated:false,
    error:null,
    steps:[{
      line:"3", functionName:"calculate", depth:"2", phase:"line",
      variables:[{ name:"total", type:"int", value:"7" }, { name:"_hidden", type:"str", value:"x" }],
      changes:[{ name:"total", before:"3", after:"7", type:"int", kind:"changed" }]
    }, {
      line:4, functionName:"calculate", phase:"return",
      variables:[], changes:[{ name:"↩ 반환값", before:"", after:"7", type:"int", kind:"added" }]
    }]
  });
  assert.equal(report.steps.length, 2);
  assert.deepEqual(report.steps[0].variables, [{ name:"total", type:"int", value:"7" }]);
  assert.deepEqual(report.steps[0].changes[0], { name:"total", before:"3", after:"7", type:"int", kind:"changed" });
  assert.equal(report.steps[1].phase, "return");
  assert.equal(report.error, "");
});

test("Tab은 커서 바로 뒤의 닫는 괄호만 통과한다", () => {
  assert.deepEqual(closingBracketTabPlan("func()", 5, 5), { caret:6 });
  assert.deepEqual(closingBracketTabPlan("data[0]", 6, 6), { caret:7 });
  assert.deepEqual(closingBracketTabPlan("{x}", 2, 2), { caret:3 });
  assert.equal(closingBracketTabPlan("func()", 4, 4), null);
  assert.equal(closingBracketTabPlan("func()", 5, 6), null);
});

test("Python block indentation recognizes a colon before an inline comment", () => {
  assert.equal(pythonLineOpensBlock("class BayesianFilter: # 베이지안 필터"), true);
  assert.equal(pythonLineOpensBlock("    if label == '#':  # 해시 문자열"), true);
  assert.equal(pythonLineOpensBlock("value = '# not a comment'"), false);
  assert.equal(pythonLineOpensBlock("value = 1  # 설명:"), false);
});

test("원본 저장 폴더 표식은 작업공간 경로와 안전하게 왕복한다", () => {
  const marker = workspaceOriginalSaveMarkerPath("수업/파이썬/");
  assert.equal(workspaceOriginalSaveFolderPath(marker), "수업/파이썬");
  assert.equal(workspaceOriginalSaveFolderPath("수업/파이썬/main.py"), "");
});

test("editor undo history remembers the caret immediately before an edit", () => {
  const initial = { value:"first\nsecond", s:0, e:0 };
  assert.deepEqual(editorHistoryCaretState(initial, initial.value, 8, 8), {
    value:"first\nsecond", s:8, e:8
  });
  assert.equal(editorHistoryCaretState(initial, "changed", 4, 4), initial);
});

test("Windows 절대경로 리터럴은 raw·이스케이프·UNC 표기를 같은 폴더 기준으로 감지한다", () => {
  const paths = windowsAbsolutePathLiterals([
    String.raw`open(r"D:\수업자료\project\raw.csv", "w")`,
    String.raw`open("D:\\수업자료\\project\\escaped.csv", "w")`,
    String.raw`open(r"\\server\share\project\unc.csv", "w")`
  ].join("\n"));
  assert.deepEqual(paths, [
    "D:/수업자료/project/raw.csv",
    "D:/수업자료/project/escaped.csv",
    "/server/share/project/unc.csv"
  ]);
  assert.equal(paths.every(path => windowsAbsolutePathTouchesFolder(path, "project")), true);
  assert.equal(windowsAbsolutePathTouchesFolder(paths[0], "수업"), false);
  assert.equal(windowsAbsolutePathTouchesFolder(paths[0], "다른폴더"), false);
});

test("folder drops are recognized even when DataTransfer.files is empty", () => {
  assert.equal(dataTransferHasFileItems({
    files: [],
    items: [{ kind:"file", webkitGetAsEntry(){ return { isDirectory:true }; } }]
  }), true);
  assert.equal(dataTransferHasFileItems({ files:[{ name:"note.txt" }], items:[] }), true);
  assert.equal(dataTransferHasFileItems({ files:[], items:[{ kind:"string" }] }), false);
  assert.equal(dataTransferHasFileItems({ files:[], items:[] }), false);
  assert.equal(dataTransferHasFileItems(null), false);
});

test("folder drop sources capture both legacy entries and modern handles during the event", async () => {
  const legacyDirectory = { name:"legacy", isDirectory:true };
  const modernDirectory = { name:"modern", kind:"directory" };
  let modernCalled = 0;
  const captured = captureDroppedFileItems({
    files: [],
    items: [
      { kind:"file", webkitGetAsEntry(){ return legacyDirectory; } },
      {
        kind:"file",
        webkitGetAsEntry(){ return null; },
        getAsFileSystemHandle(){
          modernCalled += 1;
          return Promise.resolve(modernDirectory);
        }
      },
      { kind:"string", getAsFileSystemHandle(){ throw new Error("must not be called"); } }
    ]
  });
  assert.equal(modernCalled, 1);
  assert.deepEqual(captured.entries, [legacyDirectory]);
  assert.deepEqual(await Promise.all(captured.handlePromises), [modernDirectory]);
});

test("modern folder handles are captured even when a legacy entry is also available", async () => {
  const legacyDirectory = { name:"same", isDirectory:true };
  const modernDirectory = { name:"same", kind:"directory" };
  let handleCalls = 0;
  const captured = captureDroppedFileItems({
    files: [],
    items: [{
      kind:"file",
      webkitGetAsEntry(){ return legacyDirectory; },
      getAsFileSystemHandle(){
        handleCalls += 1;
        return Promise.resolve(modernDirectory);
      }
    }]
  });
  assert.equal(handleCalls, 1);
  assert.deepEqual(captured.entries, [legacyDirectory]);
  assert.deepEqual(await Promise.all(captured.handlePromises), [modernDirectory]);
});

test("directory placeholders are not opened as zero-byte untitled files", () => {
  const oneFileItem = { items:[{ kind:"file" }] };
  assert.equal(droppedTransferNeedsFolderPicker(oneFileItem, [
    { name:"수업자료", size:0, type:"" }
  ]), true);
  assert.equal(droppedTransferNeedsFolderPicker(oneFileItem, []), true);
  assert.equal(droppedTransferNeedsFolderPicker(oneFileItem, [
    { name:"empty.txt", size:0, type:"text/plain" }
  ]), false);
  assert.equal(droppedTransferNeedsFolderPicker(oneFileItem, [
    { name:"data", size:12, type:"" }
  ]), false);
  assert.equal(droppedTransferNeedsFolderPicker({ items:[] }, []), false);
});
