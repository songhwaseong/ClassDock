const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 화이트보드 우클릭 메뉴: 도구·색·되돌리기만 펼치고 나머지는 ▸ 묶음에 접는다.

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-canvas").last()).toBeVisible();
}

const stageBox = (page) => page.evaluate(() => {
  const rect = docs.find((d) => d.id === activeId).el.querySelector(".wb-canvas").getBoundingClientRect();
  return { x:rect.left, y:rect.top, width:rect.width, height:rect.height };
});

test("빈 곳 메뉴는 묶음을 접어 두고, 마우스·키보드로 펼치고 Esc 로 한 층씩 닫는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  const stage = await stageBox(page);
  const menu = page.locator(".wb-focus-context-menu");
  const insert = menu.locator(".wb-context-insert");
  const view = menu.locator(".wb-context-view");

  await page.mouse.click(stage.x + 300, stage.y + 200, { button:"right" });
  await expect(menu).toBeVisible();
  await expect(menu.locator(".wb-context-parent")).toHaveText(["삽입", "교구·정리", "보기", "출력·공유", "수업 기록"]);
  await expect(insert).toBeHidden();
  await expect(menu.locator(".wb-context-text-size-control")).toBeHidden();   // 글자 도구가 아니면 크기 칸은 접힌다
  await expect(menu.locator(".wb-context-show-section")).toBeHidden();        // 정한 단계가 없으면 발표 묶음도 접힌다

  // 마우스를 올리면 열리고, 다른 묶음으로 옮기면 바뀐다.
  await menu.locator(".wb-context-parent", { hasText:"삽입" }).hover();
  await expect(insert).toBeVisible();
  await menu.locator(".wb-context-parent", { hasText:"보기" }).hover();
  await expect(view).toBeVisible();
  await expect(insert).toBeHidden();

  // 묶음은 메뉴와 겹치지 않고 옆에 붙는다.
  const menuBox = await menu.boundingBox(), viewBox = await view.boundingBox();
  expect(viewBox.x >= menuBox.x + menuBox.width - 4 || viewBox.x + viewBox.width <= menuBox.x + 4).toBe(true);

  // 키보드: → 로 열고 첫 항목에 초점, Esc 는 묶음만 닫고 묶음 단추로 돌아간다.
  await menu.locator(".wb-context-parent", { hasText:"삽입" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(insert).toBeVisible();
  await expect(insert.locator("button").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(insert.locator("button", { hasText:"특수문자" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(insert).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu.locator(".wb-context-parent", { hasText:"삽입" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // 다시 열면 묶음은 접힌 채로 시작한다.
  await page.mouse.click(stage.x + 300, stage.y + 200, { button:"right" });
  await expect(menu.locator(".wb-context-sub:visible")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("항목 위 메뉴에는 보드 묶음·빈 곳 붙여넣기·전체 지우기가 없고 보기 묶음만 남는다", async ({ page }) => {
  await openBoard(page);
  const stage = await stageBox(page);
  const menu = page.locator(".wb-focus-context-menu");
  // 사각형 도구로 그린 뒤 선택 도구로 돌아와 테두리 위에서 우클릭한다.
  await page.locator(".wb-tools .wb-tool").nth(6).click();
  await page.mouse.move(stage.x + 120, stage.y + 120);
  await page.mouse.down();
  await page.mouse.move(stage.x + 260, stage.y + 200, { steps:8 });
  await page.mouse.up();
  await page.locator(".wb-tools .wb-tool").nth(0).click();
  await page.mouse.click(stage.x + 130, stage.y + 122, { button:"right" });
  await expect(menu.locator(".wb-context-item")).toBeVisible();
  await expect(menu.locator(".wb-context-parent:visible")).toHaveText(["보기"]);
  await expect(menu.locator(".wb-context-history button", { hasText:"붙여넣기" })).toBeHidden();
  await expect(menu.locator(".wb-context-clear")).toBeHidden();
});
