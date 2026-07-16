"use strict";

// 사이드바 내용 검색이 '지금 편집기에 있는 글자'를 보는지 확인한다.
// 예전엔 doc.sourceFile(파일을 열던 순간의 디스크 스냅샷)만 읽고 그 결과를 contentTextCache 에
// 영구 캐시해서, 편집은 물론 저장을 해도 검색이 옛 내용을 찾았다.
// 이제는 살아있는 편집기 > savedText > 디스크 스냅샷 순으로 본다(실행 경로 openDocRunText 와 같은 사다리).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/js/core.js");
const MB = 1024 * 1024;

// documents.js 는 브라우저 전역에 기대므로 최소한의 흉내만 내어 vm 에 올린다.
// let/const 는 컨텍스트 속성이 되지 않아 스크립트 끝에서 필요한 것만 꺼낸다.
function loadDocuments(docs){
  const el = () => ({
    style: { setProperty(){} }, dataset: {}, classList: { add(){}, remove(){} },
    append(){}, appendChild(){}, addEventListener(){}, setAttribute(){},
    querySelectorAll: () => [], focus(){}, scrollIntoView(){}
  });
  const ctx = {
    SUBTITLE_EXTS: [], SQLITE_EXTS: [], BINARY_ASSET_EXTS: new Set(),
    IMG_EXTS: [], VIDEO_EXTS: [], AUDIO_EXTS: [],
    console, setTimeout, clearTimeout, requestAnimationFrame: () => 0,
    Blob, URL, TextDecoder, TextEncoder,
    document: { createElement: el, querySelectorAll: () => [], addEventListener(){} },
    window: { addEventListener(){}, t: (s) => s, tf: () => "" },
    localStorage: { getItem: () => null, setItem(){} },
    contentMatchSnippet: core.contentMatchSnippet,
    byId: () => null,
    docs: docs || []
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");
  vm.runInContext(source
    + "\n;globalThis.__search = { runContentSearch, snippets: () => contentMatchSnippets, ids: () => contentMatchIds };"
    + "\n;globalThis.__probeBusy = () => contentSearchBusyQuery;"
    + "\n;globalThis.__probeDebounce = () => CONTENT_SEARCH_DEBOUNCE_MS;", ctx);
  ctx.renderSidebar = () => {};        // 실제 함수 선언이 스텁을 덮으므로 로드 뒤에 다시 씌운다
  ctx.setContentStatus = () => {};
  return ctx;
}

const noDisk = { arrayBuffer(){ throw new Error("디스크를 읽으면 안 된다"); } };
const pyDoc = (over) => Object.assign(
  { id: 1, kind: "office", name: "k.py", isTextFile: true, sourceFile: noDisk, size: 500 }, over);

test("편집 중인 문서는 저장하지 않아도 편집기 내용으로 검색된다", () => {
  const ctx = loadDocuments();
  const doc = pyDoc({ hasUnsavedEdits: true, savedText: "# 빈 파일",
    codeEditor: { getValue: () => "def category_probability(self): pass" } });
  assert.equal(ctx.liveDocText(doc), "def category_probability(self): pass");
});

test("깨끗한 문서는 편집기를 읽지 않고 savedText 를 쓴다", () => {
  const ctx = loadDocuments();
  let calls = 0;
  const doc = pyDoc({ hasUnsavedEdits: false, savedText: "저장된 본문",
    codeEditor: { getValue: () => { calls++; return "x"; } } });
  assert.equal(ctx.liveDocText(doc), "저장된 본문");
  assert.equal(calls, 0, "편집이 없으면 큰 문자열을 복사할 이유가 없다");
});

test("저장된 텍스트가 있으면 낡은 디스크 스냅샷을 읽지 않는다", async () => {
  const ctx = loadDocuments();
  assert.equal(await ctx.getDocText(pyDoc({ savedText: "새로 저장한 내용" })), "새로 저장한 내용");
});

test("열어본 적 없는 파일은 사다리를 타지 않고 기존 스냅샷 경로로 간다", () => {
  const ctx = loadDocuments();
  const doc = pyDoc({});
  assert.equal(ctx.hasLiveDocText(doc), false);
  assert.equal(ctx.liveDocText(doc), null);
});

test("본문이 메모리에 있으면 크기 상한을 넘겨도 메인 스레드에서 검색한다", () => {
  const ctx = loadDocuments();
  const open = pyDoc({ size: 40 * MB, savedText: "big" });
  assert.equal(ctx.isTextSearchable(open), true);
  // 워커는 옛 sourceFile 블롭만 보므로 넘기면 안 된다(넘기면 낡은 결과가 덮어쓴다)
  assert.equal(ctx.isLargeTextSearchable(open), false);

  const unopened = pyDoc({ size: 40 * MB });          // 기존 동작 회귀 확인
  assert.equal(ctx.isTextSearchable(unopened), false);
  assert.equal(ctx.isLargeTextSearchable(unopened), true);
});

test("소문자본은 그 본문에서 나온 것일 때만 재사용한다(편집 후 줄 번호가 따라온다)", async () => {
  let body = "line one\nline two\nTARGETWORD here\n";
  const doc = pyDoc({ hasUnsavedEdits: true, codeEditor: { getValue: () => body } });
  const ctx = loadDocuments([doc]);
  const S = ctx.__search;

  await S.runContentSearch("targetword");
  assert.equal(S.snippets().get(1).line, 3);

  body = "머리말\n머리말\n머리말\n" + body;            // 앞에 3줄 삽입 → 6번째 줄로 밀린다
  await S.runContentSearch("targetword");
  assert.equal(S.snippets().get(1).line, 6, "소문자본을 docId 로만 캐시하면 옛 줄(3)이 나온다");

  body = "다 지웠다\n";
  await S.runContentSearch("targetword");
  assert.equal(S.ids().has(1), false, "편집으로 지운 단어는 즉시 검색에서 빠져야 한다");
});

test("노트북(.ipynb)은 아직 범위 밖이다 — sourceFile 이 없어 여전히 제외된다", () => {
  const ctx = loadDocuments();
  const nb = { id: 9, kind: "office", name: "수업.ipynb", notebook: true, savedText: "{cells}", size: 100 };
  assert.equal(ctx.isTextSearchable(nb), false);
});

// ── 검색이 도는 동안 "없음"이라고 단언하지 않는다 ──
// 이름 필터가 0개여도 내용 검색 결과가 곧 도착하므로, 그동안은 "검색 중…"을 띄운다.
// 이 표시가 걷히지 않으면 영영 "검색 중…"에 갇히므로 해제 경로를 함께 확인한다.

function searchCtx(body){
  const doc = { id: 1, kind: "office", name: "k.py", isTextFile: true, size: 500,
    hasUnsavedEdits: true, codeEditor: { getValue: () => body() }, sourceFile: noDisk };
  const ctx = loadDocuments([doc]);
  ctx.__input = "";
  ctx.byId = () => ({ value: ctx.__input });
  ctx.yields = 0;
  ctx.yieldToBrowserThrottled = async () => { ctx.yields++; };
  // 빈 목록에 무엇이 찍히는지만 흉내낸다(renderSidebar 의 판정식과 동일).
  ctx.drawn = [];
  ctx.renderSidebar = () => {
    const q = ctx.__input.trim().toLocaleLowerCase();
    const searching = !!q && ctx.__probeBusy() === q;
    ctx.drawn.push(searching ? "검색 중…" : "필터에 일치하는 파일이 없습니다.");
  };
  ctx.setContentStatus = () => {};
  return ctx;
}

test("타이핑 직후엔 '없음'이 아니라 '검색 중…'을 띄우고, 끝나면 걷는다", async () => {
  let body = "TARGETWORD\n";
  const ctx = searchCtx(() => body);
  ctx.__input = "targetword";

  ctx.onSidebarSearchInput();
  assert.equal(ctx.drawn[0], "검색 중…", "결과가 곧 오는데 '없음'이라 하면 고장 난 것처럼 보인다");
  assert.equal(ctx.__probeBusy(), "targetword");

  await new Promise(r => setTimeout(r, 150));
  assert.equal(ctx.__probeBusy(), "", "검색이 끝나면 반드시 해제돼야 한다");
  assert.ok(ctx.yields > 0, "첫 검색이 화면을 얼리지 않도록 루프에서 양보해야 한다");
});

test("검색이 끝나고 정말 없으면 그때 '없음'이라고 말한다", async () => {
  let body = "TARGETWORD\n";
  const ctx = searchCtx(() => body);
  ctx.__input = "존재하지않는단어zzz";
  ctx.onSidebarSearchInput();
  await new Promise(r => setTimeout(r, 150));
  ctx.drawn.length = 0;
  ctx.renderSidebar();
  assert.equal(ctx.drawn[0], "필터에 일치하는 파일이 없습니다.");
});

test("검색어를 지우면 '검색 중…'도 즉시 걷힌다", () => {
  const ctx = searchCtx(() => "x");
  ctx.__input = "abc";
  ctx.onSidebarSearchInput();
  assert.equal(ctx.__probeBusy(), "abc");
  ctx.__input = "";
  ctx.onSidebarSearchInput();
  assert.equal(ctx.__probeBusy(), "");
});

test("디바운스는 80ms — 웜 검색이 ~10ms대라 250ms 대기가 체감 지연의 대부분이었다", () => {
  assert.equal(loadDocuments().__probeDebounce(), 80);
});
