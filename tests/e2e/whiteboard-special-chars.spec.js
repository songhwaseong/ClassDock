const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 화이트보드 특수문자: 빈 곳 우클릭 메뉴로 그 자리에 넣기 · 글상자 안 우클릭으로 커서 자리에 끼워 넣기.

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-canvas").last()).toBeVisible();
}

const boardItems = (page) => page.evaluate(() => {
  const doc = docs.find((d) => d.id === activeId);
  return (doc.boardState.items || []).map((item) => ({ type:item.type, text:item.text || "", x:item.x, y:item.y }));
});

const stageBox = (page) => page.evaluate(() => {
  const rect = docs.find((d) => d.id === activeId).el.querySelector(".wb-canvas").getBoundingClientRect();
  return { x:rect.left, y:rect.top, width:rect.width, height:rect.height };
});

test("빈 곳 우클릭 → 특수문자로 누른 자리에 기호 글자를 넣고, 최근 목록에 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  const stage = await stageBox(page);
  const menu = page.locator(".wb-focus-context-menu");
  const picker = page.locator(".wb-symbol-picker");

  await page.mouse.click(stage.x + 300, stage.y + 220, { button:"right" });
  await menu.locator(".wb-context-board button", { hasText:"특수문자" }).click();
  await expect(menu).toBeHidden();
  await expect(picker).toBeVisible();

  // icons.js 가 ● → 를 SVG 로 바꾸지 않고 글자 그대로 둔다
  await picker.locator(".wb-symbol-tab", { hasText:"화살표" }).click();
  const arrow = picker.locator(".wb-symbol-cell", { hasText:"→" }).first();
  await expect(arrow).toHaveText("→");
  await arrow.click();
  await expect(picker).toBeHidden();

  const items = await boardItems(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ type:"text", text:"→" });
  expect(Math.abs(items[0].x - 300)).toBeLessThan(40);                // 누른 자리 근처

  await page.mouse.click(stage.x + 500, stage.y + 300, { button:"right" });
  await menu.locator(".wb-context-board button", { hasText:"특수문자" }).click();
  await expect(picker.locator(".wb-symbol-tab.active")).toHaveText("화살표");   // 마지막으로 본 갈래를 기억
  await picker.locator(".wb-symbol-tab", { hasText:"최근" }).click();
  await expect(picker.locator(".wb-symbol-cell")).toHaveText(["→"]);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  expect(errors).toEqual([]);
});

test("글상자 안 우클릭 → 특수문자를 커서 자리에 끼워 넣고, 글상자는 닫히지 않는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  const stage = await stageBox(page);
  const picker = page.locator(".wb-symbol-picker");

  await page.locator(".wb-tools .wb-tool").nth(8).click();          // 글자 도구
  await page.mouse.click(stage.x + 200, stage.y + 160);
  const ta = page.locator(".wb-textinput");
  await expect(ta).toBeFocused();
  await page.keyboard.type("가격3000원");
  await page.keyboard.press("ArrowLeft");                            // "원" 앞으로
  const box = await ta.boundingBox();
  // 글자 위를 우클릭해도(크롬은 그 단어를 선택한다) 우클릭 전 커서 자리에 들어가야 한다
  await page.mouse.click(box.x + 14, box.y + box.height / 2, { button:"right" });
  await expect(page.locator(".wb-focus-context-menu")).toBeHidden(); // 보드 메뉴가 아니라 고르개
  await expect(picker).toBeVisible();
  await expect(ta).toBeFocused();

  await picker.locator(".wb-symbol-cell", { hasText:"※" }).first().click();
  await picker.locator(".wb-symbol-tab", { hasText:"번호" }).click();
  await picker.locator(".wb-symbol-cell", { hasText:"①" }).first().click();
  await expect(ta).toBeVisible();
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue("가격3000※①원");

  await page.keyboard.press("Escape");                               // 첫 Esc 는 고르개만 닫는다
  await expect(picker).toBeHidden();
  await expect(ta).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(ta).toHaveCount(0);
  expect((await boardItems(page)).map((item) => item.text)).toEqual(["가격3000※①원"]);
  expect(errors).toEqual([]);
});
