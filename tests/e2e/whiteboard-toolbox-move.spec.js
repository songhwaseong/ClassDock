const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 수학·과학 도구상자를 메모창처럼 옮기고 크기를 바꾼다.
// 화면 기준으로 확인한다: 제목줄을 끌면 무대(보드) 밖으로도 나가는지, 가장자리를 잡아
// 늘리고 줄일 수 있는지, 새로 고쳐도 그 자리에 다시 뜨는지, 앱 헤더 아래에 머무는지.

const RECT_KEY = "classdock-whiteboard:edu-rect:v1";

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function openToolbox(page){
  await page.evaluate(() => newWhiteboard());
  const toggle = page.locator(".wb-edu-toggle").last();
  await expect(toggle).toBeVisible();
  await toggle.click();
  const panel = page.locator(".wb-edu-panel").last();
  await expect(panel).toBeVisible();
  return panel;
}

async function dragBy(page, box, dx, dy){
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function dragHead(page, panel, dx, dy){
  await dragBy(page, await panel.locator(".wb-edu-head").boundingBox(), dx, dy);
}

// 가장자리 손잡이는 창 밖 별도 층에 뜬다 — 지금 보이는 층(도구상자 것)만 고른다.
async function dragEdge(page, dir, dx, dy){
  const handle = page.locator(`.edge-resize-layer:not([hidden]) .dir-${dir}`).last();
  await dragBy(page, await handle.boundingBox(), dx, dy);
}

test("도구상자는 제목줄을 끌어 보드 밖으로도 옮기고 가장자리로 크기를 바꾼다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  const panel = await openToolbox(page);
  const stage = await page.locator(".wb-stage").last().boundingBox();

  // ① 위쪽 변을 잡아 내려 창을 낮춘다(원래는 무대 높이를 꽉 채운다)
  const opened = await panel.boundingBox();
  await dragEdge(page, "n", 0, 260);
  const shortened = await panel.boundingBox();
  expect(Math.round(opened.height - shortened.height)).toBeGreaterThan(200);

  // ② 왼쪽 위로 끌면 무대 위(도구막대 쪽)까지 나간다
  await dragHead(page, panel, -320, -400);
  const movedUp = await panel.boundingBox();
  expect(Math.round(movedUp.x - shortened.x)).toBeLessThan(-280);
  expect(movedUp.y).toBeLessThan(stage.y);
  await expect(panel).toHaveClass(/is-floating/);
  expect(await panel.evaluate(el => getComputedStyle(el).position)).toBe("fixed");

  // ③ 아래로도 자유롭게 내려온다
  await dragHead(page, panel, 0, 220);
  const movedDown = await panel.boundingBox();
  expect(Math.round(movedDown.y - movedUp.y)).toBeGreaterThan(180);

  // ④ 오른쪽 변을 잡아 넓힌다
  await dragEdge(page, "e", 90, 0);
  const widened = await panel.boundingBox();
  expect(Math.round(widened.width - movedDown.width)).toBeGreaterThan(60);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("옮긴 자리와 크기는 새로 고쳐도 그대로 남는다", async ({ page }) => {
  await openApp(page);
  const panel = await openToolbox(page);
  await dragEdge(page, "n", 0, 200);
  await dragHead(page, panel, -260, -80);
  const moved = await panel.boundingBox();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), RECT_KEY);
  expect(saved).not.toBeNull();
  expect(Math.abs(saved.left - moved.x)).toBeLessThan(2);
  expect(Math.abs(saved.top - moved.y)).toBeLessThan(2);

  await page.reload();
  const again = await openToolbox(page);
  const restored = await again.boundingBox();
  expect(Math.abs(restored.x - moved.x)).toBeLessThan(2);
  expect(Math.abs(restored.y - moved.y)).toBeLessThan(2);
  expect(Math.abs(restored.width - moved.width)).toBeLessThan(2);
  expect(Math.abs(restored.height - moved.height)).toBeLessThan(2);
});

// 도구상자와 메모창은 같은 헬퍼(makeFloatingPanel)를 쓴다 — 메모창 쪽이 그대로인지 함께 지킨다.
test("메모창도 예전처럼 제목줄로 옮겨지고 자리가 저장된다", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("Control+m");
  const memo = page.locator("#scratchpad");
  await expect(memo).toBeVisible();

  const before = await memo.boundingBox();
  await dragBy(page, await memo.locator(".scratchpad-head").boundingBox(), -140, 70);
  const after = await memo.boundingBox();
  expect(Math.round(after.x - before.x)).toBeLessThan(-120);
  expect(Math.round(after.y - before.y)).toBeGreaterThan(50);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("classdock-scratchpad:rect:v1") || "null"));
  expect(saved).not.toBeNull();
  expect(Math.abs(saved.left - after.x)).toBeLessThan(2);
});

test("도구상자는 앱 헤더 위로는 올라가지 않는다(작업 영역 안에 머문다)", async ({ page }) => {
  await openApp(page);
  const panel = await openToolbox(page);
  await dragHead(page, panel, -200, -600);          // 화면 맨 위로 끌어올린다
  const box = await panel.boundingBox();
  const contentTop = await page.evaluate(() => document.getElementById("content").getBoundingClientRect().top);
  expect(box.y).toBeGreaterThanOrEqual(contentTop);
});
