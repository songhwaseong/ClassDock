const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

async function openBoard(page){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
      localStorage.removeItem("mn.mapPickerView");
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.keyboard.press("Alt+b");
  await expect(page.locator(".wb-canvas")).toHaveCount(1);
}

const boardImages = (page) => page.evaluate(() => {
  const doc = docs.find(d => d.kind === "board");
  const items = (doc && doc.boardState && doc.boardState.items) || [];
  return items.filter(it => it.type === "image").map(it => ({
    isDataUrl: /^data:image\//.test(it.src || (it.img && it.img.src) || ""),
    w: it.w, h: it.h
  }));
});

/* 배경 타일은 인터넷에서 오므로 오프라인에서도 통과해야 한다 — 고른 화면이 그림이 되어
   칠판에 들어가는 것까지가 계약이고, 타일 유무는 그림의 내용일 뿐이다. */
test("칠판의 지도 버튼으로 자리를 골라 넣으면 그림 항목이 생긴다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  expect(await boardImages(page)).toEqual([]);

  await page.locator(".wb-map").click();
  const picker = page.locator(".map-picker-modal");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".map-picker-stage.leaflet-container")).toHaveCount(1);

  // 좌표로 이동한 뒤 넣는다.
  await picker.locator(".map-picker-goto").fill("37.5665, 126.978");
  await picker.locator(".map-picker-goto").press("Enter");
  await picker.locator(".map-picker-ok").click();

  await expect(picker).toHaveCount(0, { timeout: 20_000 });
  const images = await boardImages(page);
  expect(images).toHaveLength(1);
  expect(images[0].isDataUrl).toBe(true);
  expect(images[0].w).toBeGreaterThan(0);

  // 다음에 열 때 같은 자리에서 시작하도록 기억해 둔다.
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem("mn.mapPickerView") || "null"));
  expect(remembered.center[0]).toBeCloseTo(37.5665, 2);

  expect(errors).toEqual([]);
});

test("지도 고르기를 취소하면 칠판에 아무것도 넣지 않는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);

  await page.locator(".wb-map").click();
  await expect(page.locator(".map-picker-modal")).toBeVisible();
  await page.locator(".map-picker-cancel").click();
  await expect(page.locator(".map-picker-modal")).toHaveCount(0);
  expect(await boardImages(page)).toEqual([]);

  // Esc 로도 닫힌다(취소와 같은 결과).
  await page.locator(".wb-map").click();
  await expect(page.locator(".map-picker-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-picker-modal")).toHaveCount(0);
  expect(await boardImages(page)).toEqual([]);

  expect(errors).toEqual([]);
});

/* 오프라인 지도 현황은 런처가 디스크에 남겨 주는 기능이라 exe 로 돌 때만 뜻이 있다.
   브라우저로 연 화면에 버튼이 보이면 눌러도 아무 데도 남지 않는다. */
test("브라우저로 열면 오프라인 지도 현황 버튼을 붙이지 않는다", async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await expect(page.locator(".map-to-board")).toHaveCount(1);
  await expect(page.locator(".map-prepare")).toHaveCount(0);
});
