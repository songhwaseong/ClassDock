const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { collapseSidebar } = require("./helpers");

/* 채점 화면의 "📚 누적 성적 CSV" — 여러 시험의 저장된 성적을 한 파일로 모아 내보낸다.
 *
 * 시험 한 건짜리 흐름은 exam-paper.spec.js 가 끝까지 훑으므로, 여기서는 그 앞단을 반복하지 않고
 * 실제 저장 함수(examPersistGradedRow)로 성적표를 채운 뒤 진짜 버튼을 눌러 결과 파일을 확인한다.
 * 성적표는 localStorage 에 쌓이므로 시험을 두 번 치른 상황을 화면 조작 없이 만들 수 있다. */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// 채점 화면을 열고 누적 CSV 버튼을 집는다("⬇ 성적 CSV"와 이름이 겹치므로 "누적"으로 좁힌다).
async function openGrading(page){
  await page.evaluate(() => window.openExamGrading(null));
  const grade = page.locator(".exam-grade");
  await expect(grade).toBeVisible();
  const button = grade.locator(".btn").filter({ hasText: "누적 성적 CSV" });
  await expect(button).toHaveCount(1);
  return button;
}

// 앱이 실제로 쓰는 저장 경로로 성적표를 채운다 — localStorage 를 손으로 쓰면
// 기록 모양이 바뀌어도 테스트가 통과해 버린다.
function seedGradebook(page){
  return page.evaluate(() => {
    const item = (type, id) => ({ ...examNewItem(type), id });
    const examA = { id:"exam-a", title:"1학기 중간", items:[item("choice", "a1"), item("short", "a2")] };
    const examB = { id:"exam-b", title:"2학기 기말", items:[item("choice", "b1")] };
    const row = (key, student, submittedAt, marks, answers) => ({
      submissionKey:key, marks, manualMarks:{},
      payload:{ student, submittedAt, answers }
    });
    return [
      // 같은 시험·같은 학생이 두 번 제출 → "복수 제출" 비고가 붙어야 한다.
      examPersistGradedRow({ master:examA },
        row("sub-a1", "홍길동", "2026-03-02T01:00:00.000Z", { a1:true, a2:true }, { a2:"잎" })),
      examPersistGradedRow({ master:examA },
        row("sub-a2", "홍길동", "2026-03-02T02:00:00.000Z", { a1:false, a2:false }, { a2:"" })),
      // 주관식을 적었는데 아직 O/X 가 안 붙은 답 → "확인 필요" 1
      examPersistGradedRow({ master:examA },
        row("sub-a3", "김철수", "2026-03-02T01:30:00.000Z", { a1:true, a2:false }, { a2:"몰라요" })),
      // CSV 수식 주입 방어 확인용 이름
      examPersistGradedRow({ master:examB },
        row("sub-b1", "=SUM(A1)", "2026-07-10T00:00:00.000Z", { b1:true }, {}))
    ];
  });
}

// 따옴표로 감싼 셀만 나오므로(examCsvCell) 줄을 셀 배열로 되돌린다.
function parseCsv(text){
  return text.replace(/^﻿/, "").split("\r\n").filter(Boolean)
    .map(line => line.slice(1, -1).split('","').map(cell => cell.replace(/""/g, '"')));
}

test("저장된 성적이 없으면 누적 CSV 를 내보내지 않고 안내만 한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);

  const button = await openGrading(page);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await button.click();

  await expect(page.locator(".toast, #toast")).toContainText("내보낼 저장 성적이 없어요");
  expect(downloaded).toBe(false);
  expect(errors).toEqual([]);
});

test("누적 성적 CSV 는 여러 시험의 저장된 성적을 시험·학생 순으로 모은다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);

  expect(await seedGradebook(page)).toEqual([true, true, true, true]);

  const button = await openGrading(page);
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const raw = fs.readFileSync(await download.path(), "utf8");

  expect(download.suggestedFilename()).toMatch(/^누적성적_\d{8}_\d{4}\.csv$/);
  expect(raw.startsWith("﻿")).toBe(true);          // 엑셀이 한글을 깨지 않고 열도록 BOM 을 붙인다

  const rows = parseCsv(raw);
  expect(rows[0]).toEqual(["시험", "학생", "제출 시각", "점수", "만점", "확인 필요", "비고", "마지막 수정"]);
  expect(rows).toHaveLength(5);                         // 헤더 + 제출 4건

  // 시험끼리 묶이고, 같은 시험 안에서는 학생 이름순(김 → 홍)
  expect(rows.slice(1).map(r => r[0])).toEqual(["1학기 중간", "1학기 중간", "1학기 중간", "2학기 기말"]);
  expect(rows.slice(1, 4).map(r => r[1])).toEqual(["김철수", "홍길동", "홍길동"]);

  const 김철수 = rows.find(r => r[1] === "김철수");
  expect(김철수.slice(2, 7)).toEqual(["2026-03-02T01:30:00.000Z", "1", "2", "1", ""]);   // 확인 필요 1, 비고 없음

  // 두 번 낸 학생만 "복수 제출"이 붙고, 점수는 제출본마다 따로 남는다
  const 홍길동 = rows.filter(r => r[1] === "홍길동");
  expect(홍길동.map(r => r[6])).toEqual(["복수 제출", "복수 제출"]);
  expect(홍길동.map(r => r[3]).sort()).toEqual(["0", "2"]);

  // 엑셀에서 수식으로 실행되지 않도록 = 로 시작하는 셀 앞에 작은따옴표를 붙인다
  const 주입 = rows.find(r => r[0] === "2학기 기말");
  expect(주입[1]).toBe("'=SUM(A1)");

  // 마지막 수정 시각은 저장 시점에 찍힌다
  for (const row of rows.slice(1)) expect(row[7]).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  expect(errors).toEqual([]);
});
