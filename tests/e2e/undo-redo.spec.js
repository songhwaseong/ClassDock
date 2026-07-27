const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 공용 history.js(MNEditHistory)로 옮긴 편집기들이 실제로 되돌려지는지 확인한다.
// 특히 capture 가 매번 새 배열/객체를 주는 편집기는 isEqual 을 빠뜨리면 undo 가 조용히
// 아무 일도 안 하게 되므로(같은 상태를 다시 만들고 그리로 돌아감) 화면 기준으로 검증한다.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// 캔버스 위에 획 하나 긋기
async function stroke(page, canvas, from, to){
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

// docs 는 let 선언이라 window 에 붙지 않는다 — 전역 스코프에서 직접 찾는다.
const boardItemCount = (page) => page.evaluate(() => {
  const all = (typeof docs !== "undefined") ? docs : [];
  const doc = all.find(d => d.kind === "board");
  return doc && doc.boardState ? doc.boardState.items.length : -1;
});

test("화이트보드: 획을 긋고 되돌리기·다시실행이 실제로 판서를 되돌린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => newWhiteboard());
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();

  const undoBtn = page.locator('.wb-act[title*="되돌리기"]');
  const redoBtn = page.locator('.wb-act[title*="다시 실행"]');
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();
  expect(await boardItemCount(page)).toBe(0);

  // 펜으로 두 획
  await page.locator('.wb-tool[title="펜"]').click();
  await stroke(page, canvas, [40, 40], [120, 90]);
  await expect.poll(() => boardItemCount(page)).toBe(1);
  await expect(undoBtn).toBeEnabled();

  await stroke(page, canvas, [60, 120], [160, 160]);
  await expect.poll(() => boardItemCount(page)).toBe(2);

  // 되돌리기 두 번 → 획이 실제로 사라져야 한다
  await undoBtn.click();
  await expect.poll(() => boardItemCount(page)).toBe(1);
  await undoBtn.click();
  await expect.poll(() => boardItemCount(page)).toBe(0);
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeEnabled();

  // 다시실행 → 되살아나야 한다
  await redoBtn.click();
  await expect.poll(() => boardItemCount(page)).toBe(1);
  await redoBtn.click();
  await expect.poll(() => boardItemCount(page)).toBe(2);
  await expect(redoBtn).toBeDisabled();

  expect(errors).toEqual([]);
});

test("화이트보드: 되돌린 뒤 새로 그리면 다시실행 기록은 버려진다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newWhiteboard());
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();
  await page.locator('.wb-tool[title="펜"]').click();

  await stroke(page, canvas, [40, 40], [120, 90]);
  await stroke(page, canvas, [60, 120], [160, 160]);
  await expect.poll(() => boardItemCount(page)).toBe(2);

  const undoBtn = page.locator('.wb-act[title*="되돌리기"]');
  const redoBtn = page.locator('.wb-act[title*="다시 실행"]');
  await undoBtn.click();
  await expect(redoBtn).toBeEnabled();

  await stroke(page, canvas, [200, 40], [260, 90]);      // 새 갈래
  await expect.poll(() => boardItemCount(page)).toBe(2);
  await expect(redoBtn).toBeDisabled();
});

test("화이트보드: Ctrl+Z / Ctrl+Y 단축키도 같은 히스토리를 쓴다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newWhiteboard());
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();
  await page.locator('.wb-tool[title="펜"]').click();

  await stroke(page, canvas, [40, 40], [120, 90]);
  await expect.poll(() => boardItemCount(page)).toBe(1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => boardItemCount(page)).toBe(0);
  await page.keyboard.press("Control+y");
  await expect.poll(() => boardItemCount(page)).toBe(1);
});
