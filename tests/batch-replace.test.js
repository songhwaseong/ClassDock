const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/js/batch-replace.js"), "utf8");
// window.document 를 주지 않아 브라우저 전용 블록(모달·DOM)은 건너뛰고 순수 코어만 로드한다.
const context = { window: undefined };
vm.runInNewContext(
  source + "\nthis.api = { batchEscapeRegExp, batchBuildMatcher, batchReplacementString, batchComputeReplacement, batchDetectDominantEol, batchRememberDocTextFormat, batchIsTargetDoc, batchOfficeKind, batchChangeLabel, batchOutsideSummary, batchIsVisibleDoc, batchRestoreUndoEntry, batchRememberSavedEntries, batchApplyButtonModel };",
  context
);
const api = context.api;

const lineKinds = (changes) => changes.map(c => c.line).join(",");

test("일반(비정규식) 찾기는 정규식 특수문자를 문자 그대로 다룬다", () => {
  const m = api.batchBuildMatcher("a.b", { regex: false });
  assert.equal(m.error, undefined);
  const r = api.batchComputeReplacement("a.b axb aXb", m, "Z");
  assert.equal(r.count, 1);                 // "a.b" 한 곳만(정규식이었다면 axb·aXb 도 잡힘)
  assert.equal(r.out, "Z axb aXb");
});

test("대소문자 옵션에 따라 일치 개수가 달라진다", () => {
  const insensitive = api.batchBuildMatcher("cat", { caseSensitive: false });
  assert.equal(api.batchComputeReplacement("Cat cat CAT", insensitive, "dog").count, 3);
  const sensitive = api.batchBuildMatcher("cat", { caseSensitive: true });
  const r = api.batchComputeReplacement("Cat cat CAT", sensitive, "dog");
  assert.equal(r.count, 1);
  assert.equal(r.out, "Cat dog CAT");
});

test("여러 줄에서 바뀐 줄 번호·전후 내용을 줄 단위로 기록한다", () => {
  const m = api.batchBuildMatcher("2025", {});
  const text = "연도 2025\n그대로\n마감 2025-12-31";
  const r = api.batchComputeReplacement(text, m, "2026");
  assert.equal(r.count, 2);
  assert.equal(lineKinds(r.changes), "1,3");
  assert.equal(r.out, "연도 2026\n그대로\n마감 2026-12-31");
  assert.deepEqual({ ...r.changes[0] }, { line: 1, before: "연도 2025", after: "연도 2026", count: 1 });
});

test("정규식 모드는 그룹 치환($1)을 지원한다", () => {
  const m = api.batchBuildMatcher("(\\w+)@(\\w+)", { regex: true });
  assert.equal(m.regex, true);
  const r = api.batchComputeReplacement("kim@school lee@home", m, "$2/$1");
  assert.equal(r.count, 2);
  assert.equal(r.out, "school/kim home/lee");
});

test("일반 모드의 바꿀 말에 든 $ 는 문자 그대로 들어간다", () => {
  const m = api.batchBuildMatcher("price", { regex: false });
  const r = api.batchComputeReplacement("the price", m, "$5");
  assert.equal(r.out, "the $5");
});

test("빈 문자열에도 일치하는 위험한 패턴은 거부한다", () => {
  assert.ok(api.batchBuildMatcher("a*", { regex: true }).error);
  assert.ok(api.batchBuildMatcher("", {}).error);            // 빈 찾을 말
  assert.ok(api.batchBuildMatcher("(", { regex: true }).error); // 잘못된 정규식
});

test("일치가 없으면 개수 0·원본 그대로", () => {
  const m = api.batchBuildMatcher("zzz", {});
  const r = api.batchComputeReplacement("hello\nworld", m, "x");
  assert.equal(r.count, 0);
  assert.equal(r.out, "hello\nworld");
  assert.equal(r.changes.length, 0);
});

test("아직 렌더하지 않은 문서도 원본 CRLF와 BOM 정보를 저장 전에 기억한다", () => {
  const doc = { textEncoding: { encoding: "utf-8", bom: true } };
  api.batchRememberDocTextFormat(doc, "첫 줄\r\n둘째 줄\r\n");
  assert.equal(doc.textEol, "crlf");
  assert.equal(doc.textBom, true);

  // 이미 렌더 과정에서 정한 값은 디스크 재읽기로 덮어쓰지 않는다.
  const known = { textEol: "cr", textBom: false, textEncoding: { bom: true } };
  api.batchRememberDocTextFormat(known, "a\r\nb");
  assert.deepEqual({ ...known }, { textEol: "cr", textBom: false, textEncoding: { bom: true } });
});

test("잠긴 분할 참고 문서는 일괄 치환 대상에서 제외한다", () => {
  const textDoc = { id: 7, kind: "office", sourceFile: {}, codeEditor: {} };
  const searchable = () => true;
  assert.equal(api.batchIsTargetDoc(textDoc, searchable, () => false), true);
  assert.equal(api.batchIsTargetDoc(textDoc, searchable, () => true), false);
});

test("작업 탭과 분할 참고 문서를 모두 현재 표시 문서로 판정한다", () => {
  assert.equal(api.batchIsVisibleDoc({ id: 2 }, 2, 9), true);
  assert.equal(api.batchIsVisibleDoc({ id: 9 }, 2, 9), true);
  assert.equal(api.batchIsVisibleDoc({ id: 4 }, 2, 9), false);
});

test("되돌리기 재저장이 실패하면 이전 내용은 복원하되 저장 안 됨으로 남긴다", async () => {
  const calls = [];
  const doc = { id: 1 };
  const result = await api.batchRestoreUndoEntry({ doc, prev: "이전", resave: true }, {
    save: async () => false,
    reflect: (target, text) => calls.push(["reflect", target.id, text]),
    markDirty: (target, dirty) => calls.push(["dirty", target.id, dirty])
  });
  assert.deepEqual({ ...result }, { persisted: false, needsSave: true, saveFailed: true });
  assert.deepEqual(calls, [["reflect", 1, "이전"], ["dirty", 1, true]]);
});

test("되돌리기 재저장이 성공한 파일만 깨끗한 상태로 표시한다", async () => {
  let dirty = null;
  const result = await api.batchRestoreUndoEntry({ doc: {}, prev: "이전", resave: true }, {
    save: async () => true,
    reflect: () => {},
    markDirty: (_doc, value) => { dirty = value; }
  });
  assert.equal(result.persisted, true);
  assert.equal(result.saveFailed, false);
  assert.equal(dirty, false);
});

test("여러 파일 저장 후 최신 바이트를 작업공간 복원 묶음에 한 번만 병합한다", async () => {
  const entries = [
    { doc: { id: 1 }, text: "첫째" },
    { doc: { id: 2 }, text: "둘째" }
  ];
  let calls = 0, remembered = [];
  const result = await api.batchRememberSavedEntries(entries, {
    makeFile: entry => ({ name: entry.doc.id + ".txt", text: entry.text }),
    remember: async files => { calls++; remembered = files; return true; }
  });
  assert.deepEqual({ ...result }, { attempted: true, saved: true });
  assert.equal(calls, 1);
  assert.deepEqual(remembered.map(file => file.text), ["첫째", "둘째"]);
  assert.equal(entries[0].doc.savedInWorkspace, true);
  assert.equal(entries[1].doc.savedInWorkspace, true);
});

test("작업공간 스냅샷 갱신 실패를 저장됨으로 표시하지 않는다", async () => {
  const doc = { id: 1, savedInWorkspace: true };
  const result = await api.batchRememberSavedEntries([{ doc, text: "최신" }], {
    makeFile: () => ({ name: "a.txt" }),
    remember: async () => false
  });
  assert.deepEqual({ ...result }, { attempted: true, saved: false });
  assert.equal(doc.savedInWorkspace, false);
});

test("단일 실행 버튼은 미리보기 전후에 역할과 문구가 바뀐다", () => {
  const before = api.batchApplyButtonModel(null);
  assert.deepEqual({ ...before }, {
    disabled: false,
    requiresPreview: true,
    label: "미리보기"
  });

  const ready = api.batchApplyButtonModel({
    files: [
      { checked: true, count: 2 },
      { checked: false, count: 8 },
      { checked: true, count: 3 }
    ]
  });
  assert.deepEqual({ ...ready }, {
    disabled: false,
    requiresPreview: false,
    label: "바꾸고 저장 (2개 파일 · 5곳)"
  });
  assert.doesNotMatch(source, /const previewBtn\s*=/);
});

/* ---------- Word·PowerPoint 합류 ---------- */

test("docx·pptx 는 텍스트 대상이 아니라 별도 통로로 잡힌다", () => {
  const docx = { id: 1, name: "안내문.docx", kind: "office" };
  const pptx = { id: 2, name: "수업.pptx", kind: "office" };
  const text = { id: 3, name: "메모.txt", kind: "office", savedText: "가" };
  assert.equal(api.batchOfficeKind(docx), "docx");
  assert.equal(api.batchOfficeKind(pptx), "pptx");
  assert.equal(api.batchOfficeKind(text), null);
  // 텍스트 판정은 오피스 확장자를 자연히 걸러내므로 두 갈래가 겹치지 않는다.
  assert.equal(api.batchIsTargetDoc(docx, (d) => /\.(txt|md)$/i.test(d.name)), false);
});

test("오피스 문서라도 PDF·노트북·잠긴 참고 문서는 대상이 아니다", () => {
  assert.equal(api.batchOfficeKind({ name: "a.docx", kind: "pdf" }), null);
  assert.equal(api.batchOfficeKind({ name: "a.pptx", notebookModel: {} }), null);
  assert.equal(api.batchOfficeKind({ name: "a.docx" }, () => true), null);
  assert.equal(api.batchOfficeKind({ name: "a.doc" }), null);      // 구형 .doc 은 읽기 전용 유지
  assert.equal(api.batchOfficeKind({ name: "a.ppt" }), null);      // 구형 .ppt 도 마찬가지
});

test("미리보기 이름표: 텍스트는 줄 번호, Word 는 파트+문단, PPT 는 이름표만", () => {
  assert.equal(api.batchChangeLabel({ line: 12 }), "12");
  assert.equal(api.batchChangeLabel({ para: 3, label: "문단", numbered: true }), "문단 3");
  assert.equal(api.batchChangeLabel({ para: 2, label: "머리말", numbered: true }), "머리말 2");
  // 슬라이드는 파트 이름이 이미 번호를 품고 있어 문단 번호를 덧붙이지 않는다.
  assert.equal(api.batchChangeLabel({ para: 2, label: "슬라이드 3", numbered: false }), "슬라이드 3");
  assert.equal(api.batchChangeLabel({ para: 1 }), "문단 1");
  assert.equal(api.batchChangeLabel(null), "");
});

test("바꾸지 않은 곳은 같은 이름끼리 합쳐 숫자로 알린다", () => {
  assert.equal(api.batchOutsideSummary([]), "");
  assert.equal(api.batchOutsideSummary(null), "");
  assert.equal(api.batchOutsideSummary([{ label: "머리말", count: 2 }]), "머리말 2곳");
  assert.equal(
    api.batchOutsideSummary([{ label: "머리말", count: 2 }, { label: "꼬리말", count: 1 }, { label: "머리말", count: 3 }]),
    "머리말 5곳 · 꼬리말 1곳");
  assert.equal(api.batchOutsideSummary([{ label: "메모", count: 0 }]), "");
});
