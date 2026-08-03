const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 화이트보드는 디스크 파일 형식이 없는 가상 문서다. 예전에는 판서할 때마다 ● 가 켜지는데
// 끄는 경로가 없어 영영 남았고, Ctrl+S 는 앱이 안 받아서 브라우저 "웹페이지 저장(HTML)"이 떴다.
// 지금은 ● 를 켜지 않고(복구본 자동 저장으로 대신), Ctrl+S 는 PNG 내보내기로 받는다.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function stroke(page, canvas){
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 6 });
  await page.mouse.up();
}

const boardDirty = (page) => page.evaluate(() => {
  const all = (typeof docs !== "undefined") ? docs : [];
  const board = all.find(d => d.kind === "board");
  return board ? !!board.hasUnsavedEdits : null;
});

test("판서해도 ● 가 켜지지 않고, 복구본은 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.keyboard.press("Alt+b");
  const canvas = page.locator(".wb-canvas").last();
  await expect(canvas).toBeVisible();

  await page.locator(".wb-tool").first().waitFor();
  await page.evaluate(() => {
    const pen = [...document.querySelectorAll(".wb-tools button")].find(b => /펜|Pen/.test(b.textContent || b.title || ""));
    if (pen) pen.click();
  });
  await stroke(page, canvas);

  // 판서가 실제로 들어갔는지부터 확인 — 안 그러면 "● 안 켜짐"이 공허하다.
  const items = await page.evaluate(() => {
    const all = (typeof docs !== "undefined") ? docs : [];
    const board = all.find(d => d.kind === "board");
    return board && board.boardState ? board.boardState.items.length : -1;
  });
  expect(items).toBeGreaterThan(0);

  expect(await boardDirty(page)).toBe(false);
  await expect(page.locator("#tabBar .tab.dirty")).toHaveCount(0);
  await expect(page.locator("#activeDocStatus")).toBeHidden();

  // 복구본(자동 저장)은 남아 있어야 한다 — ● 를 안 켜는 근거가 이것이다.
  await page.evaluate(() => {
    const all = (typeof docs !== "undefined") ? docs : [];
    const board = all.find(d => d.kind === "board");
    if (board && typeof board.flushBoardRecovery === "function") board.flushBoardRecovery();
  });
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => k.startsWith("manneung-board-recovery:")).length);
  expect(saved).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("화이트보드에서 Ctrl+S 는 브라우저 저장 대신 PNG 다운로드를 시작한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.keyboard.press("Alt+b");
  await expect(page.locator(".wb-canvas")).toHaveCount(1);

  const download = page.waitForEvent("download", { timeout: 8000 });
  await page.keyboard.press("Control+s");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);

  expect(errors).toEqual([]);
});
