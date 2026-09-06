const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 큰 파일은 열기 전에 한 번 묻는다.
   판정 자체는 tests/large-file-open-confirm.test.js 가 촘촘히 본다. 여기서는 실제 배선만 본다 —
   confirmDialog 는 file-loaders.js 보다 뒤에 로드되는 파일(office-doc-viewers.js)에 있어서,
   "부를 때는 이미 있다"가 진짜인지 브라우저에서 확인할 필요가 있다.
   가장 낮은 상한이 표 40MB 라 41MB 짜리를 쓴다(내용은 읽기 전에 물으므로 아무 바이트나 된다). */

const OVER_LIMIT = Buffer.alloc(41 * 1024 * 1024, 0x20);
const SMALL = Buffer.from("이름,점수\n김철수,90\n", "utf8");

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

const openCount = (page) => page.evaluate(() => (typeof docs !== "undefined" ? docs.length : -1));

test("상한을 넘는 파일은 열기 전에 묻고, 열지 않기를 고르면 열리지 않는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  expect(await openCount(page)).toBe(0);

  await page.locator("#fileInput").setInputFiles({
    name:"성적.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer:OVER_LIMIT,
  });

  const modal = page.locator("#confirmModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#confirmSub")).toContainText("성적.xlsx");
  await expect(page.locator("#confirmSub")).toContainText("41MB");
  await expect(page.locator("#confirmOk")).toHaveText("그래도 열기");
  await expect(page.locator("#confirmCancel")).toHaveText("열지 않기");

  await page.locator("#confirmCancel").click();
  await expect(modal).toBeHidden();

  // 열지 않기를 골랐으니 문서가 늘지 않는다(깨진 표를 파싱하려다 오류를 내지도 않는다).
  await expect.poll(() => openCount(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("상한 아래 파일은 묻지 않고 그대로 열린다", async ({ page }) => {
  await openApp(page);
  await page.locator("#fileInput").setInputFiles({
    name:"작은표.csv", mimeType:"text/csv", buffer:SMALL,
  });
  await expect.poll(() => openCount(page)).toBe(1);
  await expect(page.locator("#confirmModal")).toBeHidden();
});
