const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 커서 모양 판정(항목 위=이동, 빈 곳=끌기)은 마우스가 움직일 때마다 항목 목록을 최대 네 번 훑고,
   좌표를 구할 때마다 getBoundingClientRect 로 레이아웃을 읽는다. 지금은 한 프레임에 한 번만
   판정하므로 커서가 곧바로가 아니라 다음 프레임에 바뀐다 — 그래도 결과는 같아야 한다.
   toHaveCSS 는 값이 맞을 때까지 다시 보므로 그 한 프레임 지연을 그대로 견딘다. */

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.keyboard.press("Alt+b");
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();
  return canvas;
}

// 캔버스 왼쪽 위를 기준으로 한 좌표를 화면 좌표로 바꾼다.
async function spot(canvas, x, y){
  const box = await canvas.boundingBox();
  expect(box, "캔버스가 화면에 있어야 한다").not.toBeNull();
  return { x:box.x + x, y:box.y + y };
}

const pickTool = (page, tool) => page.locator(`.wb-tool.wb-toolvis-${tool}`).click();

test("판서 위에서는 이동, 빈 곳에서는 끌기 커서가 된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);

  // 사각형을 실제로 하나 그린다(모델을 직접 건드리지 않고 사용자가 하는 그대로).
  await pickTool(page, "rect");
  const from = await spot(canvas, 80, 80), to = await spot(canvas, 260, 200);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps:8 });
  await page.mouse.up();

  await pickTool(page, "select");

  // 그린 사각형 안 — 옮길 수 있으므로 move.
  const inside = await spot(canvas, 170, 140);
  await page.mouse.move(inside.x, inside.y);
  await expect(canvas).toHaveCSS("cursor", "move");

  // 아무것도 없는 곳 — 화면을 끄는 자리이므로 grab.
  const outside = await spot(canvas, 520, 380);
  await page.mouse.move(outside.x, outside.y);
  await expect(canvas).toHaveCSS("cursor", "grab");

  // 되돌아와도 다시 move 로 바뀐다(프레임에 묶여 있어도 마지막 자리를 놓치지 않는다).
  await page.mouse.move(inside.x, inside.y);
  await expect(canvas).toHaveCSS("cursor", "move");

  expect(errors).toEqual([]);
});

test("빠르게 여러 번 움직여도 마지막 자리의 커서로 끝난다", async ({ page }) => {
  const canvas = await openBoard(page);
  await pickTool(page, "rect");
  const from = await spot(canvas, 80, 80), to = await spot(canvas, 260, 200);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps:8 });
  await page.mouse.up();
  await pickTool(page, "select");

  // 한 프레임에 한 번만 판정하므로 중간 좌표는 버려진다. 마지막 좌표만 반영되면 된다.
  const outside = await spot(canvas, 520, 380);
  const inside = await spot(canvas, 170, 140);
  for (let step = 0; step < 20; step++){
    const at = step % 2 ? outside : inside;
    await page.mouse.move(at.x, at.y);
  }
  await page.mouse.move(inside.x, inside.y);      // 마지막은 사각형 안
  await expect(canvas).toHaveCSS("cursor", "move");
});
