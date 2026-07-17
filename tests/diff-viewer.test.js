const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/js/diff-viewer.js"), "utf8");
const context = {
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]),
  window: { t: (s) => s, tf: (tmpl, vars) => String(tmpl).replace(/\{(\w+)[^}]*\}/g, (m, k) => vars && vars[k] != null ? String(vars[k]) : m) }
};
vm.runInNewContext(source + "\nthis.api = { diffLineRecords, diffRowsFromRecords, diffUtf8Bytes, diffTextParts, diffTextLineCount, diffNormalizeText, diffLimitMessage, diffInlineHtml, diffFoldRows, diffLimitRows, diffRowHtml, diffShortName, diffDocText };", context);
const api = context.api;

const kinds = (recs) => recs.map((r) => r.t).join(" ");

test("같은 내용은 모두 eq 로, 추가·삭제는 원문 줄 인덱스와 함께 판정한다", () => {
  const same = api.diffLineRecords(["a", "b"], ["a", "b"], null);
  assert.equal(kinds(same), "eq eq");

  const recs = api.diffLineRecords(["A", "B", "C", "D"], ["A", "B", "X", "C", "D", "E"], null);
  assert.equal(kinds(recs), "eq eq ins eq eq ins");
  // vm 컨텍스트 객체는 프로토타입이 달라 로컬 복사본으로 비교한다(다른 assert 도 동일)
  assert.deepEqual({ ...recs[2] }, { t: "ins", ai: -1, bi: 2 });   // X
  assert.deepEqual({ ...recs[5] }, { t: "ins", ai: -1, bi: 5 });   // E
  assert.deepEqual({ ...recs[3] }, { t: "eq", ai: 2, bi: 3 });     // C 짝 유지

  const del = api.diffLineRecords(["A", "B", "C"], ["A", "C"], null);
  assert.equal(kinds(del), "eq del eq");
});

test("반복 줄 사이의 수정도 patience 앵커·LCS 폴백으로 자연스럽게 짝짓는다", () => {
  // 중복 줄(공백 줄)이 섞여 유일 줄 앵커가 제한되는 전형적 코드 편집
  const a = ["def f():", "    return 1", "", "def g():", "    return 2", ""];
  const b = ["def f():", "    return 10", "", "def g():", "    return 2", ""];
  const rows = api.diffRowsFromRecords(api.diffLineRecords(a, b, null));
  assert.equal(rows.filter((r) => r.t === "chg").length, 1);
  const chg = rows.find((r) => r.t === "chg");
  assert.equal(a[chg.ai], "    return 1");
  assert.equal(b[chg.bi], "    return 10");
});

test("삭제·추가가 이웃하면 바뀐 줄(chg)로 묶고 남는 쪽은 단독 행으로 남긴다", () => {
  const rows = api.diffRowsFromRecords([
    { t: "del", ai: 0, bi: -1 },
    { t: "del", ai: 1, bi: -1 },
    { t: "ins", ai: -1, bi: 0 }
  ]);
  assert.deepEqual([...rows.map((r) => r.t)], ["chg", "del"]);
  assert.deepEqual([rows[0].ai, rows[0].bi], [0, 0]);
});

test("바뀐 줄 짝은 공통 앞뒤를 제외한 가운데만 강조하고 HTML 을 이스케이프한다", () => {
  const [aHtml, bHtml] = api.diffInlineHtml("abcdef", "abXYef");
  assert.equal(aHtml, 'ab<span class="diff-mark">cd</span>ef');
  assert.equal(bHtml, 'ab<span class="diff-mark">XY</span>ef');

  const [wholeA, wholeB] = api.diffInlineHtml("<b>", "안녕");
  assert.equal(wholeA, "&lt;b&gt;");   // 전부 다르면 강조 span 없이 줄 배경만
  assert.equal(wholeB, "안녕");
});

test("인라인 강조는 이모지의 UTF-16 서로게이트 쌍을 자르지 않는다", () => {
  const [aHtml, bHtml] = api.diffInlineHtml("앞😀뒤", "앞😁뒤");
  assert.equal(aHtml, '앞<span class="diff-mark">😀</span>뒤');
  assert.equal(bHtml, '앞<span class="diff-mark">😁</span>뒤');
  assert.ok(!/[\uD800-\uDBFF](?=<)|(?<=>)[\uDC00-\uDFFF]/u.test(aHtml));
});

test("크기·줄 수 제한은 UTF-8 바이트와 논리 줄 수를 정확히 센다", () => {
  assert.equal(api.diffUtf8Bytes("abc"), 3);
  assert.equal(api.diffUtf8Bytes("가😀"), 7);
  assert.equal(api.diffTextLineCount(""), 0);
  assert.equal(api.diffTextLineCount("a"), 1);
  assert.equal(api.diffTextLineCount("a\n"), 1);
  assert.equal(api.diffTextLineCount("\n"), 1);
  const parts = api.diffTextParts("a\n");
  assert.deepEqual({ lines:[...parts.lines], finalNewline:parts.finalNewline }, { lines:["a"], finalNewline:true });
  assert.equal(api.diffNormalizeText("a\r\nb\rc"), "a\nb\nc");
  assert.match(api.diffLimitMessage("가".repeat(1747627), ""), /5MB/);
  assert.match(api.diffLimitMessage("x\n".repeat(50001), ""), /50,000줄/);
});

test("공백 무시 키를 쓰면 들여쓰기만 다른 줄은 같은 줄이 된다", () => {
  const keyOf = (s) => s.replace(/\s+/g, " ").trim();
  const recs = api.diffLineRecords(["  x = 1"], ["x  =  1"], keyOf);
  assert.equal(kinds(recs), "eq");
});

test("같은 줄이 길게 이어지면 문맥만 남기고 접되, 접힌 줄 수를 기록한다", () => {
  const rows = [];
  rows.push({ t: "chg", ai: 0, bi: 0 });
  for (let i = 1; i <= 40; i++) rows.push({ t: "eq", ai: i, bi: i });
  rows.push({ t: "chg", ai: 41, bi: 41 });
  const folds = [];
  const folded = api.diffFoldRows(rows, folds);
  const fold = folded.find((r) => r.t === "fold");
  assert.ok(fold);
  assert.equal(fold.count, 40 - 6);                      // 위아래 문맥 3줄씩 제외
  assert.equal(folds[fold.id].length, fold.count);
  assert.equal(folded.length, rows.length - fold.count + 1);
  // 짧은 동일 구간은 접지 않는다
  const short = api.diffFoldRows([{ t: "eq", ai: 0, bi: 0 }], []);
  assert.equal(short[0].t, "eq");
});

test("화면 행 상한은 앞뒤 문맥과 생략 행 수를 보존한다", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ t:"ins", ai:-1, bi:i }));
  const limited = api.diffLimitRows(rows, 7);
  assert.equal(limited.length, 7);
  assert.deepEqual({ ...limited[3] }, { t:"limit", count:14 });
  assert.equal(limited[0].bi, 0);
  assert.equal(limited[limited.length - 1].bi, 19);
});

test("행 HTML 은 줄번호 1부터, 파일 내용은 이스케이프해 그린다", () => {
  const a = ["<script>"], b = ["<script>"];
  const html = api.diffRowHtml({ t: "eq", ai: 0, bi: 0 }, "split", a, b);
  assert.ok(html.includes(">1<"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

test("파일 끝 개행 유무 차이는 별도 비교 행으로 표시한다", () => {
  const html = api.diffRowHtml(
    { t:"eof", aFinalNewline:true, bFinalNewline:false },
    "split", [], []
  );
  assert.ok(html.includes("파일 끝 개행 있음"));
  assert.ok(html.includes("파일 끝 개행 없음"));
  assert.ok(html.includes("is-del"));
  assert.ok(html.includes("is-ins"));
});

test("셀 노트북 비교는 저장본보다 현재 notebookModel 을 우선한다", async () => {
  context.nbSyncFindModel = (doc) => { doc.notebookModel.live = "현재 셀"; };
  context.modelToIpynb = (model) => JSON.stringify(model);
  context.ipynbToPython = (text) => JSON.parse(text).live;
  context.openDocRunText = async () => JSON.stringify({ live:"이전 저장본" });
  const text = await api.diffDocText({ name:"수업.ipynb", notebookModel:{ live:"편집 전" } });
  assert.equal(text, "현재 셀");
});

test("비교 문서 이름은 경로를 떼고 파일명만 쓴다", () => {
  assert.equal(api.diffShortName("폴더/하위\\main.py"), "main.py");
  assert.equal(api.diffShortName(""), "?");
});
