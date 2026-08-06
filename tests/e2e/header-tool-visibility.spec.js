const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 헤더(맨 위 막대) 버튼 노출 설정: 설정 '도구' 탭에서 끈 버튼은 문서를 열지 않아도 즉시 사라져야 한다.
 * 설정(⚙)·저장·집중·분할 작업은 대상에서 빠져 있어 어떤 조합으로 꺼도 설정 창으로 돌아올 길이 남는다. */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

// 설정 → 도구 탭에서 주어진 도구 체크를 끄고 저장한다.
async function hideTools(page, ids){
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="tools"]').click();
  for (const id of ids) await page.locator("#settingTool-" + id).uncheck();
  await page.locator("#settingsSave").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
}

test("설정에서 끈 헤더 버튼은 바로 사라지고 설정(⚙)은 항상 남는다", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#themeToggle")).toBeVisible();
  await expect(page.locator("#helpOpen")).toBeVisible();
  await expect(page.locator("#langToggle")).toBeVisible();

  await hideTools(page, ["hdrTheme", "hdrHelp", "hdrLang", "hdrPalette"]);

  await expect(page.locator("#themeToggle")).toBeHidden();
  await expect(page.locator("#helpOpen")).toBeHidden();
  await expect(page.locator("#langToggle")).toBeHidden();
  await expect(page.locator("#commandPaletteOpen")).toBeHidden();
  await expect(page.locator("#settingsOpen")).toBeVisible();   // 설정은 노출 대상이 아니다
  await expect(page.locator("#sidebarToggle")).toBeVisible();

  // 설정을 다시 열었을 때도 끈 상태로 보여야 한다(저장·복원 경로).
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="tools"]').click();
  await expect(page.locator("#settingTool-hdrTheme")).not.toBeChecked();
  await expect(page.locator("#settingTool-hdrSidebar")).toBeChecked();
});

test("숨긴 헤더 버튼도 명령 팔레트로는 계속 실행된다(되돌릴 길 확보)", async ({ page }) => {
  await boot(page);
  await hideTools(page, ["hdrTheme"]);
  await expect(page.locator("#themeToggle")).toBeHidden();

  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.locator("#commandPaletteOpen").click();
  await page.locator(".cmdk-input").fill("테마");
  await expect(page.locator(".cmdk-item-label")).toContainText(["밝게 / 어둡게 전환 (테마)"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).not.toBe(before);
});

test("더보기(⋮)는 실제로 표시할 항목이 없으면 통째로 사라진다", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#headerMore")).toBeVisible();

  await hideTools(page, ["hdrImageMemo"]);
  // E2E 정적 서버에서는 저장 폴더 API가 없으므로 이미지 메모까지 끄면 실제 항목이 하나도 없다.
  await expect(page.locator("#headerMoreWrap")).toBeHidden();
  await expect(page.locator("#imageMemoOpen")).toBeHidden();
});
