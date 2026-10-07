"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const study = require("../src/js/study-doc.js");

test("빈칸 카드는 {{정답}}을 가리고 여러 정답을 모은다", () => {
  const parts = study.studyClozeParts({ front:"물의 화학식은 {{H2O}}이고 끓는점은 {{100℃}}이다." });
  assert.equal(parts.question, "물의 화학식은 ＿＿＿＿이고 끓는점은 ＿＿＿＿이다."); assert.equal(parts.answer, "H2O · 100℃"); assert.equal(parts.hasCloze, true);
});
test("자기평가는 결과와 다음 복습일을 문서에 기록한다", () => {
  const good = study.studyNormalizeCard({ front:"질문", back:"정답" }); study.studyRateCard(good, "good", new Date(2026, 7, 23)); assert.equal(good.result, "good"); assert.equal(good.due, "2026-08-26");
  const wrong = study.studyNormalizeCard({ front:"오답" }); study.studyRateCard(wrong, "again", new Date(2026, 7, 23)); assert.deepEqual(study.studyFilterCards([good, wrong], "wrong", new Date(2026, 7, 23)).map(card => card.front), ["오답"]);
});
test("오늘 복습 동그라미는 오늘 끝낸 장수와 남은 복습으로 칠한다", () => {
  const now = new Date(2026, 9, 7), cards = ["알아요", "몰라요", "헷갈려요"].map(front => study.studyNormalizeCard({ front })).concat(study.studyNormalizeCard({ front:"새 카드" }));
  study.studyRateCard(cards[0], "good", now); study.studyRateCard(cards[1], "again", now); study.studyRateCard(cards[2], "hard", now);
  // 알아요·헷갈려요는 오늘 끝(다음 복습이 뒤로 감), 몰라요는 오늘 다시 봐야 하므로 남음, 새 카드도 남음
  assert.deepEqual(study.studyTodayProgress(cards, now), { done:2, left:2, total:4, ratio:0.5 });
  assert.deepEqual(study.studyTodayProgress([], now), { done:0, left:0, total:0, ratio:0 });
});
test("암기 카드는 CSV의 줄바꿈·쉼표를 보존해 왕복한다", () => {
  const cards = [study.studyNormalizeCard({ front:"질문, 하나", back:"첫 줄\n둘째 줄", note:"해설", tags:"과학", type:"qa" })], parsed = study.studyCardsFromCsv(study.studyCardsToCsv(cards));
  assert.equal(parsed[0].front, "질문, 하나"); assert.equal(parsed[0].back, "첫 줄\n둘째 줄"); assert.equal(parsed[0].tags, "과학");
});
test(".study는 파일 열기·메뉴·manifest에 연결된다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8"), loaders = fs.readFileSync(path.join(__dirname, "../src/js/file-loaders.js"), "utf8"), manifest = fs.readFileSync(path.join(__dirname, "../scripts.manifest.json"), "utf8");
  assert.match(html, /accept="[^"]*\.study/); assert.match(html, /id="sbNewStudy"/); assert.match(html, /src="src\/js\/study-doc\.js"/); assert.match(loaders, /ext === "study"[\s\S]{0,120}loadStudyDoc/); assert.match(manifest, /"study-doc\.js"/);
});
