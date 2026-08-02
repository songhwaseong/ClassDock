const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 화이트보드 → 메모창 → 다시 화이트보드 왕복.
// 화면 기준으로 확인한다: 메모 블록이 생기는지, 거기서 연 보드에 판서가 살아 있는지,
// 그리고 두 번째 "메모로"가 새 블록을 만들지 않고 같은 블록을 제자리에서 바꾸는지.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function stroke(page, canvas, from, to){
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

// docs 는 let 선언이라 window 에 안 붙는다 — 전역 스코프에서 직접 찾는다.
const boardDocs = (page) => page.evaluate(() => {
  const all = (typeof docs !== "undefined") ? docs : [];
  return all.filter(d => d.kind === "board").map(d => ({
    name: d.name,
    items: d.boardState ? d.boardState.items.length : -1,
    memoBlockId: d.memoBlockId || null
  }));
});

test("화이트보드를 메모로 보내고, 메모에서 다시 열어 고치면 같은 블록이 바뀐다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 보드가 둘 열리면 .wb-canvas 도 둘이 된다 — 항상 방금 연(마지막) 보드를 겨눈다.
  const canvas = page.locator(".wb-canvas").last();
  const penBtn = page.locator('.wb-tool[title="펜"]').last();
  const memoBtn = page.locator('.wb-act', { hasText: "메모로" }).last();

  await page.evaluate(() => newWhiteboard());
  await expect(canvas).toBeVisible();

  await penBtn.click();
  await stroke(page, canvas, [40, 40], [120, 90]);
  await expect.poll(async () => (await boardDocs(page))[0].items).toBe(1);

  // ① 메모로 보내기 → 이미지 블록 한 개
  await memoBtn.click();
  const imageBlocks = page.locator('#scratchpad [data-block-id] .scratchpad-image-tools');
  await expect(imageBlocks).toHaveCount(1);
  const boardBtn = page.locator('.scratchpad-reuse', { hasText: "화이트보드로" });
  await expect(boardBtn).toHaveCount(1);

  // ② 메모에서 다시 화이트보드로 → 판서가 그대로 살아 있고 원래 블록과 이어져 있다
  await boardBtn.click();
  await expect.poll(async () => (await boardDocs(page)).length).toBe(2);
  const reopened = (await boardDocs(page))[1];
  expect(reopened.items).toBe(1);
  expect(reopened.memoBlockId).toBeTruthy();

  // ③ 획을 하나 더 긋고 다시 메모로 → 새 블록이 아니라 같은 블록이 갱신된다
  await expect(canvas).toBeVisible();
  await penBtn.click();
  await stroke(page, canvas, [60, 120], [160, 160]);
  await expect.poll(async () => (await boardDocs(page))[1].items).toBe(2);

  await memoBtn.click();
  await expect(page.locator('#scratchpad [data-block-id] .scratchpad-image-tools')).toHaveCount(1);

  expect(errors).toEqual([]);
});
