const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 화면마다 따로 만든 창도 제목줄을 끌어 옮길 수 있어야 한다.
// 세 갈래를 하나씩 지킨다: movable-card(암기장), makeFloatingPanel(엑셀 조건부 서식·맞춤법 검사),
// 지도 안에서만 옮기는 칸(반경 보기).

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

async function dragFrom(page, box, dx, dy){
  const x = box.x + Math.min(24, box.width / 2), y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function expectMovedBy(page, panel, handle, dx, dy){
  const before = await panel.boundingBox();
  await dragFrom(page, await handle.boundingBox(), dx, dy);
  const after = await panel.boundingBox();
  expect(Math.round(after.x - before.x)).toBeLessThan(dx + 3);
  expect(Math.round(after.x - before.x)).toBeGreaterThan(dx - 3);
  expect(Math.round(after.y - before.y)).toBeLessThan(dy + 3);
  expect(Math.round(after.y - before.y)).toBeGreaterThan(dy - 3);
  expect(Math.round(after.width)).toBe(Math.round(before.width));
}

test("암기장 카드 창은 제목줄로 옮겨진다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.newStudyScratch());
  await page.locator(".study-bar .study-primary").first().click();
  const card = page.locator(".study-modal-card");
  await expect(card).toBeVisible();
  // 긴 창은 화면 안에 다 들어오도록 붙잡히므로(위아래 여유가 적다) 옆으로 옮겨 본다
  await expectMovedBy(page, card, card.locator("header h2"), -120, 0);
  await expect(card).toBeVisible();
});

test("엑셀 조건부 서식 규칙 창은 제목줄로 옮겨지고 다시 열어도 그 자리다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => newSpreadsheetScratch());
  const cell = page.locator('td[data-mrow="0"][data-mcol="0"]');
  await expect(cell).toBeVisible();
  await cell.click({ button: "right" });
  await page.locator(".xlsx-context-menu button", { hasText: "데이터" }).hover();
  await page.locator(".xlsx-context-sub button", { hasText: "조건부 서식 규칙 관리" }).click();
  const modal = page.locator(".xlsx-cond-modal");
  await expect(modal).toBeVisible();
  await expectMovedBy(page, modal, modal.locator(".xlsx-cond-head strong"), -200, 60);
  const moved = await modal.boundingBox();

  await modal.locator('[data-a="close"]').click();
  await expect(modal).toHaveCount(0);
  await cell.click({ button: "right" });
  await page.locator(".xlsx-context-menu button", { hasText: "데이터" }).hover();
  await page.locator(".xlsx-context-sub button", { hasText: "조건부 서식 규칙 관리" }).click();
  await expect(modal).toBeVisible();
  const again = await modal.boundingBox();
  expect(Math.abs(again.x - moved.x)).toBeLessThan(2);
  expect(Math.abs(again.y - moved.y)).toBeLessThan(2);
});

test("맞춤법 검사 창은 제목줄로 옮겨진다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => newTextScratch());
  // 텍스트 편집기에서는 버튼이 도구 메뉴 안에 접혀 있어 직접 누른다
  await expect(page.locator(".spellcheck-trigger")).not.toHaveCount(0);
  await page.evaluate(() => [...document.querySelectorAll(".spellcheck-trigger")].pop().click());
  const panel = page.locator(".spellcheck-panel");
  await expect(panel).toBeVisible();
  await expectMovedBy(page, panel, panel.locator(".spellcheck-title"), -300, -150);
  await expect(panel).toHaveClass(/is-floating/);
});

test("지도 반경 칸은 지도 안에서 옮겨지고 지도 밖으로는 나가지 않는다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await expect(page.locator(".map-radius-panel")).toHaveCount(1);
  const panel = page.locator(".map-radius-panel").last();
  const mapBox = await page.locator(".map-stage").last().boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2, { button: "right" });
  await page.getByText("여기서 반경 보기").last().click();
  await expect(panel).toBeVisible();
  // 처음 뜬 칸은 왼쪽 위 확대·축소 단추와 겹치지 않는다(예전에는 지도가 낮으면 단추가 제목줄을 덮었다).
  const zoomBox = await page.locator(".map-stage .leaflet-control-zoom").last().boundingBox();
  const opened = await panel.boundingBox();
  expect(opened.x).toBeGreaterThanOrEqual(zoomBox.x + zoomBox.width);
  const head = panel.locator(".map-radius-head strong");
  // 칸이 지도 높이를 거의 다 쓰므로(위아래 여유가 적다) 옆으로 옮겨 본다
  await expectMovedBy(page, panel, head, 200, 0);

  // 한참 밖으로 끌어도 지도 칸 안에 머문다
  await dragFrom(page, await head.boundingBox(), 3000, -3000);
  const stage = await page.locator(".map-stage").last().boundingBox();
  const box = await panel.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(stage.y - 1);

  // 접으면 폭이 줄어든다(크기를 못 박지 않았다)
  await panel.locator(".map-radius-fold").click();
  await expect(panel).toHaveClass(/is-collapsed/);
  const folded = await panel.boundingBox();
  expect(folded.width).toBeLessThan(box.width - 50);
});
