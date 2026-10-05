const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 표시 묶음(숫자 동그라미) 이름표 — 시안 B: '표시 N개' + '눌러서 펼치기 ›', 안에 든 표시 셋과 '외 N곳'. */
test("표시 묶음에 마우스를 올리면 안에 든 표시 이름을 미리 보인다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.route("**/tile-proxy**", (route) => route.abort());
  await page.goto("/");
  await page.evaluate(() => newMapScratch());

  // 서울에 20곳, 부산에 5곳 — 두 덩이로 모여 전체 보기 확대에서 묶음이 생긴다.
  const rows = ["이름,위도,경도"];
  for (let i = 0; i < 20; i++) rows.push(`서울${i + 1},${(37.55 + i * 0.002).toFixed(4)},${(126.97 + (i % 4) * 0.002).toFixed(4)}`);
  for (let i = 0; i < 5; i++) rows.push(`부산${i + 1},${(35.15 + i * 0.002).toFixed(4)},${(129.05 + i * 0.002).toFixed(4)}`);
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".map-csv-import").click();
  await (await chooser).setFiles({ name:"p.csv", mimeType:"text/csv", buffer:Buffer.from(rows.join("\n"), "utf8") });
  await expect.poll(() => page.evaluate(() => docs.find(d => d.kind === "map").mapDoc.markers.length)).toBe(25);

  const clusters = page.locator(".map-marker-cluster");
  await expect(clusters.first()).toBeVisible();
  const counts = await clusters.allTextContents();
  const index = counts.findIndex(text => Number(text) >= 5);
  expect(index).toBeGreaterThanOrEqual(0);
  const count = Number(counts[index]);
  await clusters.nth(index).hover();

  const tip = page.locator(".leaflet-tooltip.map-cluster-tip");
  await expect(tip.locator(".map-cluster-tip-count")).toHaveText(`표시 ${count}개`);
  await expect(tip.locator(".map-cluster-tip-hint")).toHaveText("눌러서 펼치기 ›");
  await expect(tip.locator(".map-cluster-tip-row")).toHaveCount(3);
  await expect(tip.locator(".map-cluster-tip-name").first()).toHaveText(/^(서울|부산)\d+$/);
  await expect(tip.locator(".map-cluster-tip-more")).toHaveText(`외 ${count - 3}곳`);
  expect(await tip.locator(".map-cluster-tip-dot").first().evaluate((n) => n.style.backgroundColor)).not.toBe("");
  expect(errors).toEqual([]);
});
