const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(require.resolve("../src/js/exam-paper.js"), "utf8");
const storage = new Map();
const sandbox = {
  crypto: webcrypto,
  TextEncoder, TextDecoder,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  toast(){}, showLoading(){}, hideLoading(){},
  localStorage: {
    getItem(key){ return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value){ storage.set(key, String(value)); },
    removeItem(key){ storage.delete(key); }
  },
  markDocumentDirty(doc, dirty){ doc.commonDirty = !!dirty; },
  docs: []
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox);

function sampleItems(){
  const items = [
    { ...sandbox.examNewItem("choice"), id: "i1", stem: "1+1 은?", answerIndex: 2 },
    { ...sandbox.examNewItem("choice"), id: "i2", stem: "가장 큰 수는?", answerIndex: 4 },
    { ...sandbox.examNewItem("short"), id: "i3", stem: "광합성을 하는 기관은?", answerText: "잎|leaf", loose: true }
  ];
  const four = () => [{ text: "1", image: "" }, { text: "2", image: "" }, { text: "3", image: "" }, { text: "4", image: "" }];
  items[0].choices = four();
  items[1].choices = four();
  return items;
}

test("배포본에는 정답이 남지 않는다", () => {
  const stripped = sandbox.examStripAnswers(sampleItems());
  const text = JSON.stringify(stripped);
  assert.equal(/answerIndex|answerText/.test(text), false);
  assert.equal(stripped.length, 3);
  assert.equal(stripped[0].choices.length, 4);
});

test("암호 봉투는 맞는 암호에서만 열린다", async () => {
  const sealed = await sandbox.examSealWithPassword({ items: sampleItems() }, "teacher-1234");
  assert.equal(await sandbox.examOpenWithPassword(sealed, "wrong-pass"), null);
  const opened = await sandbox.examOpenWithPassword(sealed, "teacher-1234");
  assert.equal(opened.items.length, 3);
});

test("제출본은 그 시험지의 개인키로만 열린다", async () => {
  const keys = await sandbox.examGenerateKeyPair();
  const stranger = await sandbox.examGenerateKeyPair();
  const payload = {
    student: "12 홍길동", signature: "data:image/png;base64,AAA", submittedAt: "2026-08-03T00:00:00.000Z",
    answers: [{ id: "i1", type: "choice", value: 2 }]
  };
  const seal = await sandbox.examSealForTeacher(payload, keys.publicJwk);
  assert.equal(JSON.stringify(seal).includes("홍길동"), false);          // 봉인 밖으로 답이 새지 않는다
  assert.equal(await sandbox.examUnsealWithPrivate(seal, stranger.privateJwk), null);
  const opened = await sandbox.examUnsealWithPrivate(seal, keys.privateJwk);
  assert.equal(opened.student, "12 홍길동");
});

test("자동 채점은 문항당 1점이고 주관식 불일치만 확인 대상으로 남긴다", () => {
  const items = sampleItems();
  const hit = sandbox.examAutoScore(items, { i1: 2, i2: 3, i3: " 잎 " });   // 공백 무시 정답
  assert.equal(sandbox.examCountMarks(hit.marks), 2);
  assert.equal(hit.marks.i2, false);
  assert.equal(hit.review, 0);

  const miss = sandbox.examAutoScore(items, { i1: 2, i2: 4, i3: "잎사귀" });
  assert.equal(sandbox.examCountMarks(miss.marks), 2);
  assert.equal(miss.review, 1);

  const blank = sandbox.examAutoScore(items, { i1: 2, i2: 4, i3: "" });     // 무응답은 확인할 것이 없다
  assert.equal(blank.review, 0);
});

test("문항이 바뀌면 배포본 해시가 달라진다", async () => {
  const items = sampleItems();
  const before = await sandbox.examSha256Hex(sandbox.examCanonicalStringify(sandbox.examStripAnswers(items)));
  items[0].stem = "1+2 는?";
  const after = await sandbox.examSha256Hex(sandbox.examCanonicalStringify(sandbox.examStripAnswers(items)));
  assert.notEqual(before, after);
  assert.equal(before.length, 64);
});

test("정답을 고르지 않은 문항은 저장을 막는다", () => {
  const items = sampleItems();
  assert.equal(sandbox.examValidateForSave({ meta: { title: "" }, items }).ok, false);
  assert.equal(sandbox.examValidateForSave({ meta: { title: "중간고사" }, items }).ok, true);
  items[0].answerIndex = 0;
  assert.equal(sandbox.examValidateForSave({ meta: { title: "중간고사" }, items }).ok, false);
  items[0].answerIndex = 2;
  items[2].answerText = "";
  assert.equal(sandbox.examValidateForSave({ meta: { title: "중간고사" }, items }).ok, false);
});

test("파일에서 읽은 문항은 정답 없이도 정규화된다", () => {
  const raw = [{ type: "choice", stem: "x", choices: [{ text: "a" }], answerIndex: 1, answerText: "누출" }];
  const student = sandbox.examNormalizeItems(raw, false);
  assert.equal(student[0].answerIndex, 0);
  assert.equal(student[0].answerText, "");
  assert.equal(student[0].choices.length, 2);              // 보기가 모자라면 최소 개수로 채운다
  const teacher = sandbox.examNormalizeItems(raw, true);
  assert.equal(teacher[0].answerIndex, 1);
});

test("해시가 없거나 다른 버전이면 채점 일치로 인정하지 않는다", () => {
  const hash = "a".repeat(64);
  assert.equal(sandbox.examHashesMatch(hash, hash), true);
  assert.equal(sandbox.examHashesMatch(hash, "b".repeat(64)), false);
  assert.equal(sandbox.examHashesMatch(hash, ""), false);
  assert.equal(sandbox.examHashesMatch("not-a-hash", "not-a-hash"), false);
});

test("채점표 이름과 시각은 수정 가능한 외부 값보다 봉인 내부 값을 사용한다", () => {
  const row = {
    submission: { student: "변조된 이름", submittedAt: "2000-01-01" },
    payload: { student: "12 홍길동", submittedAt: "2026-08-03T00:00:00.000Z" }
  };
  assert.equal(sandbox.examRowStudent(row), "12 홍길동");
  assert.equal(sandbox.examRowSubmittedAt(row), "2026-08-03T00:00:00.000Z");
});

test("수동 확인한 주관식은 확인 필요 개수에서 빠지고 저장 성적에 유지된다", () => {
  storage.clear();
  const items = sampleItems();
  const row = {
    submissionKey: "c".repeat(64),
    submission: { student: "외부 이름", submittedAt: "외부 시각" },
    payload: {
      student: "12 홍길동", submittedAt: "2026-08-03T00:00:00.000Z",
      answers: { i1: 2, i2: 4, i3: "잎사귀" }
    },
    marks: { i1: true, i2: true, i3: false }, manualMarks: {}
  };
  const state = { master: { id: "exam-1", title: "과학", items }, rows: [row] };
  assert.equal(sandbox.examReviewCount(items, row), 1);
  row.manualMarks.i3 = false;
  assert.equal(sandbox.examReviewCount(items, row), 0);
  assert.equal(sandbox.examPersistGradedRow(state, row), true);
  const saved = sandbox.examFindSavedGrade("exam-1", row.submissionKey);
  assert.equal(saved.student, "12 홍길동");
  assert.equal(saved.review, 0);
  assert.equal(saved.manualMarks.i3, false);
});

test("CSV 셀은 엑셀 수식으로 시작하는 학생 이름을 실행되지 않게 만든다", () => {
  assert.equal(sandbox.examCsvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(sandbox.examCsvCell("홍길동"), '"홍길동"');
});

test("시험지 편집 변경은 앱 공통 미저장 상태에도 반영된다", () => {
  const doc = { examEdit: { dirty: false } };
  sandbox.examMarkEditorDirty(doc);
  assert.equal(doc.examEdit.dirty, true);
  assert.equal(doc.commonDirty, true);
});

test("봉인 내부 시험지 해시가 원본과 다르면 점수를 만들지 않는다", async () => {
  storage.clear();
  const keys = await sandbox.examGenerateKeyPair();
  const seal = await sandbox.examSealForTeacher({
    examId: "exam-1", student: "12 홍길동", submittedAt: "2026-08-03T00:00:00.000Z",
    signature: "data:image/png;base64,AAA", itemsHash: "b".repeat(64),
    answers: [{ id: "i1", type: "choice", value: 2 }]
  }, keys.publicJwk);
  const row = {
    submissionKey: "d".repeat(64),
    submission: {
      examId: "exam-1", student: "12 홍길동", submittedAt: "2026-08-03T00:00:00.000Z", seal
    },
    payload: null, marks: null, autoMarks: null, manualMarks: {}, opened: false
  };
  const doc = { examGrade: {
    master: {
      id: "exam-1", title: "과학", items: sampleItems(), privateJwk: keys.privateJwk,
      itemsHash: "a".repeat(64)
    },
    rows: [row]
  } };
  await sandbox.examOpenPendingRows(doc);
  assert.equal(row.marks, null);
  assert.equal(row.opened, true);
  assert.match(row.note, /채점 차단/);
  assert.equal(sandbox.examReadGradebook().records.length, 0);
});

test("제출 기록을 지우면 같은 배포본을 그 기기에서 다시 풀 수 있다", () => {
  storage.clear();
  const paper = { id: "exam-reset-1", meta: { title: "쪽지시험" } };
  const items = sandbox.examNormalizeItems(sandbox.examStripAnswers(sampleItems()), false);

  const first = {};
  sandbox.examAttachTakeDoc(first, paper, items);
  first.examTake.answers.i1 = 2;
  first.examTake.student = "12 홍길동";
  sandbox.examSaveDraft(first);

  // 제출한 기기 — 초안이 지워지고 완료 표식만 남은 상태
  storage.delete("mn.exam.exam-reset-1");
  sandbox.examWriteJson("mn.examDone.exam-reset-1", {
    at: "2026-08-05T05:22:30.000Z", student: "12 홍길동", receipt: "abcd1234"
  });
  const locked = {};
  sandbox.examAttachTakeDoc(locked, paper, items);
  assert.equal(locked.examTake.submitted, true);
  assert.equal(locked.examTake.receipt, "abcd1234");

  assert.equal(sandbox.examClearSubmissionLock("exam-reset-1"), true);
  assert.equal(sandbox.examClearSubmissionLock("exam-reset-1"), false);   // 두 번 지워도 탈 나지 않는다

  const again = {};
  sandbox.examAttachTakeDoc(again, paper, items);
  assert.equal(again.examTake.submitted, false);
  assert.equal(again.examTake.receipt, "");

  // 다른 시험지의 자물쇠는 건드리지 않는다
  sandbox.examWriteJson("mn.examDone.exam-reset-1", { at: "2026-08-05T05:22:30.000Z", student: "12 홍길동" });
  assert.equal(sandbox.examClearSubmissionLock("exam-reset-2"), false);
  const still = {};
  sandbox.examAttachTakeDoc(still, paper, items);
  assert.equal(still.examTake.submitted, true);
});

test("초기화 코드는 시험지와 선생님 암호에서 늘 같은 값으로 나온다", async () => {
  const code = await sandbox.examResetCodeFor("exam-1", "teacher-1234");
  assert.equal(code.length, 8);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);   // 헷갈리는 0·O·1·I 는 안 쓴다
  assert.equal(await sandbox.examResetCodeFor("exam-1", "teacher-1234"), code);
  assert.notEqual(await sandbox.examResetCodeFor("exam-2", "teacher-1234"), code);
  assert.notEqual(await sandbox.examResetCodeFor("exam-1", "teacher-9999"), code);
  assert.equal(sandbox.examResetCodeText(code), code.slice(0, 4) + "-" + code.slice(4));
  assert.equal(sandbox.examNormalizeResetCode(" " + code.slice(0, 4).toLowerCase() + "-" + code.slice(4) + " "), code);
});

test("배포본에는 코드가 아니라 지문만 들어가고, 맞는 코드에서만 열린다", async () => {
  const code = await sandbox.examResetCodeFor("exam-1", "teacher-1234");
  const seal = await sandbox.examMakeResetSeal(code);
  assert.equal(JSON.stringify(seal).includes(code), false);        // 코드 자체는 배포본에 없다
  assert.equal(await sandbox.examResetCodeMatches(seal, code), true);
  assert.equal(await sandbox.examResetCodeMatches(seal, "ABCD2345"), false);
  assert.equal(await sandbox.examResetCodeMatches(seal, ""), false);
  assert.equal(await sandbox.examResetCodeMatches(null, code), false);
  assert.equal(await sandbox.examResetCodeMatches({ salt: seal.salt }, code), false);
});
