const { test, expect } = require("@playwright/test");

// 설정에서 고른 코드 색이 저장 → 편집기 → 테마 전환까지 실제로 이어지는지 확인한다.
// 새 프로필에서는 환영 창이 잠시 뒤 떠서 모달 클릭을 가로채므로, 이미 본 상태로 시작한다.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
});

async function openCodeColorSettings(page){
  await page.locator("#settingsOpen").click();
  await page.locator('#settingsTabs [data-settings-tab="document"]').click();
  await expect(page.locator("#settingCodeColorPresets .code-color-preset").first()).toBeVisible();
}

test("코드 색 설정은 미리보기·저장·테마 전환까지 이어진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openCodeColorSettings(page);

  // 미리보기는 실제 강조기(highlightCode)로 그려져 토큰 span 이 들어 있어야 한다.
  await expect(page.locator("#settingCodeColorPreview .tk-k").first()).toBeVisible();
  await expect(page.locator("#settingCodeColorPreview .tk-param").first()).toBeVisible();

  // 키워드 색을 직접 고르면 미리보기가 저장 전에 먼저 바뀐다.
  await page.locator("details.code-color-details > summary").click();
  await page.locator("#settingCodeColor-keyword").evaluate((input) => {
    input.value = "#ff00aa";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#settingCodeColorPreview")).toHaveCSS("--code-keyword", "#ff00aa");

  await page.locator("#settingsSave").click();
  await expect(page.locator("#settingsModal")).toBeHidden();

  const applied = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--python-code-keyword").trim());
  expect(await applied()).toBe("#ff00aa");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--code-keyword").trim())).toBe("");

  // 실제 파이썬 편집기에 반영되는지 — 강조 span 의 계산된 색으로 확인한다.
  await page.locator("#fileInput").setInputFiles({
    name: "color-check.py",
    mimeType: "text/x-python",
    buffer: Buffer.from("def area(radius):\n    return radius * 2\n", "utf8")
  });
  await expect(page.locator(".code-host .tk-k").first()).toHaveCSS("color", "rgb(255, 0, 170)");

  // 다크로 전환하면 라이트에서 고른 색이 남지 않고 다크 기본색으로 돌아가야 한다.
  await page.locator("#themeToggle").click();
  expect(await applied()).toBe("");
  await expect(page.locator(".code-host .tk-k").first()).toHaveCSS("color", "rgb(147, 197, 253)");

  // 라이트로 돌아오면 고른 색이 다시 살아난다.
  await page.locator("#themeToggle").click();
  expect(await applied()).toBe("#ff00aa");

  expect(errors).toEqual([]);
});

test("프리셋 미리보기 점은 지금 테마의 색을 보여준다", async ({ page }) => {
  await page.goto("/");
  await openCodeColorSettings(page);
  const chip = page.locator('[data-code-color-preset="default"] [data-code-color-chip="keyword"]');
  await expect(chip).toHaveCSS("color", "rgb(29, 78, 216)");    // 라이트 기본 키워드색
  await page.locator("#settingsCancel").click();
  await page.locator("#themeToggle").click();
  await openCodeColorSettings(page);
  await expect(chip).toHaveCSS("color", "rgb(147, 197, 253)");  // 다크 기본 키워드색
});

test("프리셋과 되돌리기는 현재 테마만 바꾸고 반대 테마 색을 보존한다", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("classDockSettings", JSON.stringify({
      codeColors:{ light:{}, dark:{ keyword:"#abcdef" } }
    }));
  });
  await page.goto("/");
  await openCodeColorSettings(page);
  await page.locator('[data-code-color-preset="monokai"]').click();
  await expect(page.locator('[data-code-color-preset="monokai"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#settingsSave").click();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("classDockSettings")).codeColors);
  expect(saved.light.keyword).toBe("#c2185b");
  expect(saved.dark.keyword).toBe("#abcdef");

  // 라이트에서 되돌려도 다크에서 직접 고른 색은 그대로 남는다.
  await openCodeColorSettings(page);
  await page.locator("#settingCodeColorReset").click();
  await expect(page.locator('[data-code-color-preset="default"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#settingsSave").click();
  const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem("classDockSettings")).codeColors);
  expect(Object.keys(cleared.light)).toEqual([]);
  expect(cleared.dark.keyword).toBe("#abcdef");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--python-code-keyword"))).toBe("");
});
