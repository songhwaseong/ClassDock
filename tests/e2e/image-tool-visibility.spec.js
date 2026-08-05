const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 이미지 편집 도구 노출 설정: 설정 '도구' 탭에서 끈 버튼이 이미 열려 있는 이미지 편집기에서도
 * 바로 사라져야 한다(<html>.hide-tool-<id> 클래스 토글). 저장 버튼처럼 꼭 필요한 것은 남고,
 * 자르기·표시처럼 '켜 둔 모드'가 있는 도구는 모드까지 함께 정리돼야 손 놓친 상태가 남지 않는다. */

// 1x1 PNG — 편집기를 띄우는 데만 쓰므로 내용은 중요하지 않다.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.locator("#fileInput").setInputFiles({ name: "그림.png", mimeType: "image/png", buffer: PNG_1PX });
  await expect(page.locator(".img-tools")).toBeVisible();
}

// 설정 → 도구 탭에서 주어진 도구 체크를 끄고 저장한다.
async function hideTools(page, ids){
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="tools"]').click();
  for (const id of ids) await page.locator("#settingTool-" + id).uncheck();
  await page.locator("#settingsSave").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
}

test("설정에서 끈 이미지 도구는 열려 있는 편집기에서 바로 사라지고 저장 버튼은 남는다", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".img-tool-ocr")).toBeVisible();
  await expect(page.locator(".img-tool-pdf")).toBeVisible();

  await hideTools(page, ["imgOcr", "imgPdf", "imgAdjust"]);

  await expect(page.locator(".img-tool-ocr")).toBeHidden();
  await expect(page.locator(".img-tool-pdf")).toBeHidden();
  await expect(page.locator(".img-tool-adjust")).toBeHidden();
  await expect(page.locator(".img-tools .run-save")).toBeVisible();   // 저장은 노출 설정 대상이 아니다
  await expect(page.locator(".img-tool-rotate").first()).toBeVisible();

  // 설정은 다시 열었을 때도 끈 상태로 보여야 한다(저장·복원 경로).
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="tools"]').click();
  await expect(page.locator("#settingTool-imgOcr")).not.toBeChecked();
  await expect(page.locator("#settingTool-imgMemo")).toBeChecked();
});

test("자르기를 숨기면 '적용'·비율 버튼과 켜 둔 자르기 모드까지 함께 정리된다", async ({ page }) => {
  await boot(page);
  await page.locator(".img-tool-crop").first().click();               // 자르기 모드 켜기
  await expect(page.locator(".img-stage")).toHaveClass(/crop-mode/);
  await expect(page.locator(".img-crop-ratios")).toBeVisible();

  await hideTools(page, ["imgCrop"]);

  await expect(page.locator(".img-tool-crop").first()).toBeHidden();  // 자르기
  await expect(page.locator(".img-tool-crop").nth(1)).toBeHidden();   // 적용
  await expect(page.locator(".img-crop-ratios")).toBeHidden();
  await expect(page.locator(".img-stage")).not.toHaveClass(/crop-mode/);
  expect(await page.evaluate(() => document.documentElement.classList.contains("hide-tool-imgCrop"))).toBe(true);
});

test("표시(주석)를 숨기면 열려 있던 표시 패널과 선택된 펜 도구도 함께 꺼진다", async ({ page }) => {
  await boot(page);
  await page.locator(".img-tool-ann").click();                        // 표시 패널 열기(펜 자동 선택)
  await expect(page.locator(".img-annotate")).toBeVisible();

  await hideTools(page, ["imgAnnotate"]);

  await expect(page.locator(".img-tool-ann")).toBeHidden();
  await expect(page.locator(".img-annotate")).toBeHidden();
  expect(await page.evaluate(() => {
    const panel = document.querySelector(".img-annotate");
    return panel ? panel.hidden : null;                               // CSS 뿐 아니라 상태도 닫혀 있어야 한다
  })).toBe(true);
});
