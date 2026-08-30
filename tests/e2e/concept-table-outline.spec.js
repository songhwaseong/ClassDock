const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const ExcelJS = require("../../vendor/exceljs.min.js");

// 관계도 표·개요: 이미 엑셀 표나 개요 글로 적어 둔 것을 카드로 바꾸는 길.
// 창 하나에서 들이기(표 파일·개요 글)와 내보내기(관계 CSV·개요 .txt)가 함께 돈다.
const EMPTY_CONCEPT = JSON.stringify({ type:"classdock-concept", version:1, title:"업무 분장", nodes:[], edges:[] });

async function openConcept(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "업무 분장.concept", mimeType: "application/json", buffer: Buffer.from(EMPTY_CONCEPT, "utf8")
  });
  await expect(page.locator(".concept-doc")).toBeVisible();
}

const openDialog = async page => {
  await page.locator(".concept-bar button", { hasText: "표·개요" }).click();
  await expect(page.locator(".concept-io-form")).toBeVisible();
};

test.describe("관계도 표·개요", () => {
  test("개요 글을 붙여 넣으면 카드와 상위 → 하위 관계가 생긴다", async ({ page }) => {
    await openConcept(page);
    await openDialog(page);

    await page.locator(".ci-outline").fill("교장\n\t교감 | 학사 총괄\n\t\t교무부장\n\t행정실장\n");
    await page.locator(".ci-outline-apply").click();

    await expect(page.locator(".concept-io-status")).toHaveText(/카드 4개.*관계 3개/);
    await expect(page.locator(".concept-card")).toHaveCount(4);
    await expect(page.locator(".concept-card h3", { hasText: "교무부장" })).toBeVisible();
    await expect(page.locator(".concept-lines > g")).toHaveCount(3);   // defs 의 화살표 path 는 세지 않는다
    // 창을 닫지 않아도 개요 칸은 방금 만든 관계도로 다시 채워진다(왕복이 한 자리에서 끝난다).
    await expect(page.locator(".ci-outline")).toHaveValue(/교장\n\t교감 \| 학사 총괄/);

    // 같은 글을 한 번 더 넣어도 이름이 같은 카드는 늘어나지 않는다.
    await page.locator(".ci-outline-apply").click();
    await expect(page.locator(".concept-io-status")).toHaveText(/카드 0개/);
    await expect(page.locator(".concept-card")).toHaveCount(4);
  });

  test("CSV 표를 고르면 관계 종류까지 읽어 카드로 만든다", async ({ page }) => {
    await openConcept(page);
    await openDialog(page);

    await page.locator(".concept-io-form input[type=file]").setInputFiles({
      name: "결재선.csv", mimeType: "text/csv",
      buffer: Buffer.from("﻿개념,분류,관계,대상,연결선\n기안,절차,원인 → 결과,검토,올림\n검토,절차,원인 → 결과,결재,\n", "utf8")
    });

    await expect(page.locator(".concept-card")).toHaveCount(3);
    await expect(page.locator(".concept-io-status")).toHaveText(/표에서 카드 3개.*관계 2개/);
    await expect(page.locator(".concept-edge-label").first()).toHaveText("올림");
    // 엑셀(.xlsx) 길은 연대표의 시트 읽기를 그대로 빌린다 — 그 전역이 있어야 돈다.
    expect(await page.evaluate(() => typeof window.timelineSheetRows)).toBe("function");
  });

  test("열 이름을 못 찾은 표는 무엇이 필요한지 알려 준다", async ({ page }) => {
    await openConcept(page);
    await openDialog(page);

    await page.locator(".concept-io-form input[type=file]").setInputFiles({
      name: "이름없음.csv", mimeType: "text/csv", buffer: Buffer.from("가,나\n1,2\n", "utf8")
    });

    await expect(page.locator(".concept-io-status.is-error")).toHaveText(/열을 찾지 못했어요/);
    await expect(page.locator(".concept-card")).toHaveCount(0);
  });

  test("관계 CSV로 내보낸 표는 그대로 다시 들어온다", async ({ page }) => {
    await openConcept(page);
    await openDialog(page);
    await page.locator(".ci-outline").fill("본부\n\t지원팀 | 서무\n");
    await page.locator(".ci-outline-apply").click();
    await expect(page.locator(".concept-card")).toHaveCount(2);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".ci-csv").click()
    ]);
    expect(download.suggestedFilename()).toBe("업무 분장.csv");

    // 내보낸 그대로 '바꾸기'로 다시 들이면 같은 관계도가 나온다.
    await page.locator('input[name="concept-io-mode"][value="replace"]').check();
    await page.locator(".concept-io-form input[type=file]").setInputFiles({
      name: "다시.csv", mimeType: "text/csv",
      buffer: Buffer.from("﻿개념,분류,설명,관계,대상,연결선\n본부,,,상위 → 하위,지원팀,\n지원팀,서무,,,,\n", "utf8")
    });
    await page.locator("#confirmOk").click();            // 바꾸기는 카드가 있을 때만 한 번 되묻는다
    await expect(page.locator(".concept-card")).toHaveCount(2);
    await expect(page.locator(".concept-card h3", { hasText: "지원팀" })).toBeVisible();
  });

  test("엑셀(.xlsx) 첫 시트도 같은 규칙으로 읽는다", async ({ page }) => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("업무 분장");
    ["개념", "상위", "분류", "설명"].forEach((value, index) => { sheet.getCell(1, index + 1).value = value; });
    [
      ["교장", "", "관리", "학교 운영 총괄"],
      ["교감", "교장", "관리", ""],
      ["교무부장", "교감", "부장", "교육과정"],
      ["연구부장", "교감", "부장", ""]
    ].forEach((row, rowIndex) => row.forEach((value, index) => { sheet.getCell(rowIndex + 2, index + 1).value = value; }));

    await openConcept(page);
    await openDialog(page);
    await page.locator(".concept-io-form input[type=file]").setInputFiles({
      name: "업무 분장.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer())
    });

    await expect(page.locator(".concept-io-status")).toHaveText(/엑셀 시트에서 카드 4개.*관계 3개/, { timeout: 15_000 });
    await expect(page.locator(".concept-card")).toHaveCount(4);
    await expect(page.locator(".concept-lines > g")).toHaveCount(3);
    await expect(page.locator(".concept-card h3", { hasText: "교무부장" })).toBeVisible();
    // 분류·설명 열도 카드에 함께 실린다.
    await expect(page.locator(".concept-card", { hasText: "교육과정" })).toContainText("부장");
  });
});
