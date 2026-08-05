const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

const boardCount = (page) => page.evaluate(() => {
  const all = (typeof docs !== "undefined") ? docs : [];
  return all.filter(d => d.kind === "board").length;
});

test("탭바 칠판 버튼과 Alt+B 로 새 화이트보드가 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 탭이 없으면 탭바가 숨어 있어 칠판 버튼도 안 보인다.
  await expect(page.locator("#tabBar")).toBeHidden();

  // Alt+B — 문서가 하나도 없는 상태에서도 판서를 바로 시작할 수 있다.
  await page.keyboard.press("Alt+b");
  await expect(page.locator(".wb-canvas")).toHaveCount(1);
  expect(await boardCount(page)).toBe(1);

  // 이제 탭바가 보이고 칠판 버튼이 오른쪽 끝에 붙는다(＋ 글자가 아니라 SVG 아이콘).
  const boardBtn = page.locator("#tabBar .tab-new-board");
  await expect(boardBtn).toBeVisible();
  await expect(boardBtn).toHaveAttribute("title", /새 화이트보드.*Alt\+B/);
  await expect(boardBtn.locator("svg.ui-icon")).toHaveCount(1);

  await boardBtn.click();
  await expect(page.locator(".wb-canvas")).toHaveCount(2);
  expect(await boardCount(page)).toBe(2);

  expect(errors).toEqual([]);
});
