const { test, expect } = require("@playwright/test");
const { storedZip } = require("./helpers");

/* 사이드바 최상위 ZIP·폴더의 ✕ 는 안에서 열어 둔 탭까지 한꺼번에 닫는다.
   실수로 눌러도 되돌릴 수 있게 확인창을 한 번 띄운다 — 취소하면 그대로, 닫기를 눌러야 닫힌다. */
async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await page.goto("/");
}

test("최상위 ZIP 닫기(✕)는 확인창을 거친다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);

  await page.locator("#fileInput").setInputFiles({
    name: "수업자료.zip",
    mimeType: "application/zip",
    buffer: storedZip([
      { name: "가.txt", data: "첫 번째" },
      { name: "나.txt", data: "두 번째" }
    ])
  });
  const rows = page.locator("#sbList .sb-item");
  await expect(rows.filter({ hasText: "가.txt" })).toHaveCount(1, { timeout: 20_000 });
  await rows.filter({ hasText: "가.txt" }).click();
  await expect(page.locator("#docTabs .tab")).toHaveCount(1);

  const root = rows.filter({ hasText: "수업자료.zip" });
  const modal = page.locator("#confirmModal");

  // 취소 → 아무것도 닫히지 않는다.
  await root.locator(".sb-close").click();
  await expect(modal).toBeVisible();
  await expect(page.locator("#confirmSub")).toContainText("'수업자료.zip' 압축 파일");
  await expect(page.locator("#confirmSub")).toContainText("열어 둔 탭 1개");
  await page.locator("#confirmCancel").click();
  await expect(modal).toBeHidden();
  await expect(root).toHaveCount(1);
  await expect(page.locator("#docTabs .tab")).toHaveCount(1);

  // Esc 도 취소다.
  await root.locator(".sb-close").click();
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(root).toHaveCount(1);

  // 닫기 → 묶음과 탭이 함께 닫힌다.
  await root.locator(".sb-close").click();
  await page.locator("#confirmOk").click();
  await expect(page.locator("#sbList .sb-item")).toHaveCount(0);
  await expect(page.locator("#docTabs .tab")).toHaveCount(0);

  expect(errors).toEqual([]);
});
