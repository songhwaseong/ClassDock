const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 선택한 한 메모 또는 편집 블록만 화면에 크게 펼치는 집중 보기와 탭 미리보기 툴팁.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function openMemo(page){
  await page.keyboard.press("Control+m");
  await expect(page.locator("#scratchpad")).toBeVisible();
}

test("목록 카드 하나만 화면에 크게 펼치고 Esc로 원래 목록에 돌아온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openApp(page);
  await openMemo(page);

  const panel = page.locator("#scratchpad");
  const textarea = page.locator("#scratchpadEditor textarea").first();
  await textarea.fill("크게 확인할 메모의 전체 내용");
  await page.locator("#scratchpadOverviewOpen").click();
  const before = await panel.boundingBox();
  const viewport = page.viewportSize();

  const enlarge = page.locator(".scratchpad-card-enlarge").first();
  await enlarge.click();
  await expect(panel).toHaveClass(/note-focus/);
  await expect(page.locator(".scratchpad-card-enlarge")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".scratchpad-card-enlarge")).toHaveText(/이전 크기/);
  await expect(page.locator(".scratchpad-head")).toBeHidden();
  await expect(page.locator(".scratchpad-tabbar")).toBeHidden();
  await expect(page.locator(".scratchpad-insertbar")).toBeHidden();
  await expect(page.locator("#scratchpadOverview")).toBeVisible();
  await expect(page.locator(".scratchpad-card")).toHaveCount(1);
  await expect(page.locator(".scratchpad-card")).toContainText("크게 확인할 메모의 전체 내용");
  const enlarged = await panel.boundingBox();
  expect(Math.round(enlarged.width)).toBe(viewport.width - 12);
  expect(Math.round(enlarged.height)).toBe(viewport.height - 12);

  await page.keyboard.press("Escape");
  await expect(panel).not.toHaveClass(/note-focus/);
  await expect(panel).toBeVisible();
  await expect(page.locator("#scratchpadOverview")).toBeVisible();
  await expect(page.locator(".scratchpad-card-enlarge")).toHaveAttribute("aria-pressed", "false");
  const restored = await panel.boundingBox();
  expect(Math.abs(restored.width - before.width)).toBeLessThan(2);
  expect(Math.abs(restored.height - before.height)).toBeLessThan(2);

  await page.keyboard.press("Escape");
  await expect(page.locator("#scratchpadOverview")).toBeHidden();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test("편집 화면의 메모 블록 하나를 크게 편집하고 Esc로 원래 메모에 돌아온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openApp(page);
  await openMemo(page);

  const panel = page.locator("#scratchpad");
  const first = page.locator(".scratchpad-block").first();
  await first.locator("textarea").fill("첫 번째 블록");
  await page.locator("#scratchpadAddText").click();
  await page.locator(".scratchpad-block").last().locator("textarea").fill("두 번째 블록");
  const before = await panel.boundingBox();
  const viewport = page.viewportSize();

  const enlarge = first.locator(".scratchpad-block-focus");
  await expect(enlarge).toHaveAttribute("aria-label", "이 블록만 크게 보기");
  await enlarge.click();
  await expect(panel).toHaveClass(/block-focus/);
  await expect(enlarge).toHaveAttribute("aria-pressed", "true");
  await expect(enlarge).toHaveAttribute("aria-label", "이전 크기로");
  await expect(page.locator(".scratchpad-head")).toBeHidden();
  await expect(page.locator(".scratchpad-tabbar")).toBeHidden();
  await expect(page.locator(".scratchpad-insertbar")).toBeHidden();
  await expect(page.locator(".scratchpad-block:visible")).toHaveCount(1);
  const enlarged = await panel.boundingBox();
  expect(Math.round(enlarged.width)).toBe(viewport.width - 12);
  expect(Math.round(enlarged.height)).toBe(viewport.height - 12);

  await first.locator("textarea").fill("확대해서 고친 첫 번째 블록");
  await page.keyboard.press("Escape");
  await expect(panel).not.toHaveClass(/block-focus/);
  await expect(panel).toBeVisible();
  await expect(page.locator(".scratchpad-block:visible")).toHaveCount(2);
  await expect(first.locator("textarea")).toHaveValue("확대해서 고친 첫 번째 블록");
  await expect(enlarge).toHaveAttribute("aria-pressed", "false");
  const restored = await panel.boundingBox();
  expect(Math.abs(restored.width - before.width)).toBeLessThan(2);
  expect(Math.abs(restored.height - before.height)).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test("메모 탭에 본문 앞부분이 미리보기로 붙는다", async ({ page }) => {
  await openApp(page);
  await openMemo(page);

  const textarea = page.locator("#scratchpadEditor textarea").first();
  await textarea.click();
  await textarea.fill("수업 준비물\n\n색연필 24색\n도화지 30장\n풀\n가위");

  const tab = page.locator(".scratchpad-tab-main").first();
  await expect(tab).toHaveAttribute("title", /수업 준비물[\s\S]*색연필 24색[\s\S]*도화지 30장/);
  await expect(tab).toHaveAttribute("title", /더블클릭 또는 F2로 이름 변경/);
  await expect(tab).not.toHaveAttribute("title", /가위/);

  await page.locator("#scratchpadNew").click();
  await expect(page.locator(".scratchpad-tab-main").last()).toHaveAttribute("title", /\(빈 메모\)/);
});
