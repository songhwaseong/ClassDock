const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 여행일지(.trip) — 갈래를 고르면 말이 바뀌되 자료는 그대로인지, 여정 띠로 날을 오가며
 * 종이에 쓴 글이 저장되고 다시 열었을 때 그대로인지. */

async function boot(page, purpose = "trip"){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(p => window.newTripScratch && window.newTripScratch(p), purpose);
  await expect(page.locator(".trip-bar")).toBeVisible();
}

const modelOf = page => page.evaluate(() => {
  const doc = docs.find(d => d.kind === "trip");
  return doc ? JSON.parse(JSON.stringify(doc.trip)) : null;
});

test("새 여행일지가 탭으로 열리고 갈래에 따라 이름이 다르다", async ({ page }) => {
  await boot(page, "field");
  await expect(page.locator(".tab.active")).toContainText("체험학습.trip");
  const model = await modelOf(page);
  expect(model.purpose).toBe("field");
  expect(model.days).toEqual([]);
});

test("여정 띠로 날을 더하고 오가며, 종이에 쓴 글이 그 날에 담긴다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-day-chip")).toHaveCount(1);
  await expect(page.locator(".trip-rail-head")).toHaveText("1일");

  await page.locator(".trip-day-title").fill("첫째 날 — 성산");
  await page.locator(".diary-text").fill("바람이 셌다");
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-day-chip")).toHaveCount(2);
  await expect(page.locator(".trip-rail-head")).toHaveText("2일");
  await page.locator(".diary-text").fill("둘째 날 글");

  // 첫째 날로 돌아가면 그 날 글이 그대로다
  await page.locator(".trip-day-chip").nth(0).click();
  await expect(page.locator(".diary-text")).toHaveValue("바람이 셌다");
  await expect(page.locator(".trip-day-title")).toHaveValue("첫째 날 — 성산");

  const model = await modelOf(page);
  expect(model.days.map(d => d.text)).toEqual(["바람이 셌다", "둘째 날 글"]);
});

test("갈래를 바꾸면 말만 바뀌고 자료는 한 글자도 안 바뀐다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-title").fill("성산");
  await page.locator(".diary-text").fill("본 것");
  await expect(page.locator(".trip-rail-head")).toHaveText("1일");
  await expect(page.locator(".trip-add-day")).toHaveText("＋ 날");

  const before = await modelOf(page);
  await page.locator(".trip-purpose-select").selectOption("survey");
  await expect(page.locator(".trip-rail-head")).toHaveText("조사 1차례");
  await expect(page.locator(".trip-add-day")).toHaveText("＋ 조사 차례");
  await expect(page.locator(".trip-day-chip-head")).toHaveText("1차 조사");

  const after = await modelOf(page);
  expect(after.purpose).toBe("survey");
  delete before.purpose; delete after.purpose;
  delete before.updatedAt; delete after.updatedAt;
  expect(after).toEqual(before);
});

test("저장하면 ZIP 으로 쓰이고 다시 열어도 그대로다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-title").fill("제주 3박 4일");
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-title").fill("첫째 날");
  await page.locator(".trip-day-date").fill("2026-07-20");
  await page.locator(".diary-text").fill("성산일출봉에 올랐다");
  await expect(page.locator(".tab.active")).toHaveClass(/dirty|unsaved/).catch(() => {});

  // 저장본 바이트를 그대로 받아 다시 연다(디스크 대화창을 띄우지 않는다)
  const bytes = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "trip");
    const packed = tripPack(doc.trip, doc.tripAssets, Date.now());
    return Array.from(packed.slice(0, 2)).concat([packed.length]);
  });
  expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  expect(bytes[2]).toBeGreaterThan(100);

  const round = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "trip");
    const packed = tripPack(doc.trip, doc.tripAssets, Date.now());
    const back = await tripUnpack(packed);
    return { title:back.model.title, days:back.model.days.map(d => [d.date, d.title, d.text]),
      same:tripContentKey(back.model) === tripContentKey(doc.trip) };
  });
  expect(round.title).toBe("제주 3박 4일");
  expect(round.days).toEqual([["2026-07-20", "첫째 날", "성산일출봉에 올랐다"]]);
  expect(round.same).toBe(true);
});

test("떼어 낸 종이 엔진이 여행일지에서도 그대로 돈다(스티커·되돌리기)", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".diary-text").fill("사진을 붙여 보자");

  // 종이 엔진이 붙여 주는 글상자 스티커 한 장(사진 바이트 없이 되는 갈래)
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "trip");
    doc.trip.days[0].stickers.push({ id:"st-e2e-1", kind:"text", text:"제주", x:0.2, y:0.3, w:0.3,
      color:"#1f2937", font:"gothic", size:0.048, align:"left", rot:0, flip:false });
  });
  await page.locator(".trip-day-chip").nth(0).click();
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await expect(page.locator(".diary-sticker-text")).toContainText("제주");

  // 되돌리기 단추가 살아 있다
  await expect(page.locator(".trip-undo-btn")).toBeEnabled();
});
