const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 보드 배경 창·변환 창도 도구상자처럼 제목줄을 끌어 옮기고 가장자리로 크기를 바꾼다.
// 배경 창은 "바깥을 누르면 닫힘"이 있어, 창 밖 층에 뜨는 크기 조절 띠를 잡아도 닫히지 않아야 한다.

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-canvas").last()).toBeVisible();
}

async function dragBy(page, box, dx, dy){
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

// 제목 글자 위를 잡는다(가운데는 빈 칸일 수도, 닫기 단추일 수도 있어 글자가 확실하다)
async function dragHead(page, panel, dx, dy){
  await dragBy(page, await panel.locator(".wb-bg-head strong").boundingBox(), dx, dy);
}

async function dragEdge(page, dir, dx, dy){
  const handle = page.locator(`.edge-resize-layer:not([hidden]) .dir-${dir}`).last();
  await dragBy(page, await handle.boundingBox(), dx, dy);
}

test("배경 창은 제목줄로 옮겨지고, 크기를 바꿔도 닫히지 않으며, 자리가 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.locator(".wb-bg-toggle").last().click();
  const panel = page.locator(".wb-bg-panel").last();
  await expect(panel).toBeVisible();

  const before = await panel.boundingBox();
  await dragHead(page, panel, 260, 60);
  const moved = await panel.boundingBox();
  expect(Math.round(moved.x - before.x)).toBeGreaterThan(240);
  expect(Math.round(moved.y - before.y)).toBeGreaterThan(40);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/is-floating/);

  await dragEdge(page, "e", 80, 0);
  await expect(panel).toBeVisible();
  const widened = await panel.boundingBox();
  expect(Math.round(widened.width - moved.width)).toBeGreaterThan(60);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("classdock-whiteboard:bg-rect:v1") || "null"));
  expect(saved).not.toBeNull();
  expect(Math.abs(saved.left - widened.x)).toBeLessThan(2);

  // 바깥(보드)을 누르면 예전처럼 닫힌다
  const stage = await page.locator(".wb-canvas").last().boundingBox();
  await page.mouse.click(stage.x + 20, stage.y + stage.height - 20);
  await expect(panel).toBeHidden();

  // 다시 열면 옮긴 자리에 뜬다
  await page.locator(".wb-bg-toggle").last().click();
  await expect(panel).toBeVisible();
  const reopened = await panel.boundingBox();
  expect(Math.abs(reopened.x - widened.x)).toBeLessThan(2);
  expect(Math.abs(reopened.y - widened.y)).toBeLessThan(2);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("변환 창도 제목줄로 옮겨진다", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: /^변환 —/ }).last().click();
  const panel = page.locator(".wb-transform-panel").last();
  await expect(panel).toBeVisible();

  const before = await panel.boundingBox();
  await dragHead(page, panel, 300, 80);
  const moved = await panel.boundingBox();
  expect(Math.round(moved.x - before.x)).toBeGreaterThan(280);
  expect(Math.round(moved.y - before.y)).toBeGreaterThan(60);
  await expect(panel).toHaveClass(/is-floating/);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("classdock-whiteboard:transform-rect:v1") || "null"));
  expect(saved).not.toBeNull();
});
