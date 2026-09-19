const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const incheon = require("../fixtures/ship-schedule-incheon.json");
const ports = require("../fixtures/ship-ports-sample.json");

/* 지도 문서의 '여객선' 층(항구 시간표 → 도착지 점선).
 * 뜻풀이(항해 묶기·운임·좌표 고르기)는 tests/ship-api.test.js 가 지킨다. 여기서는 화면 계약만 본다.
 * 시간표 표본은 2026-09-19 인천 출발 실측 46줄(18개 도착지, 16항해)이다. */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); localStorage.removeItem("mapShipBoard"); } catch(_){}
  });
  await collapseSidebar(page);
}
const envelope = (items) => JSON.stringify({ response:{ header:{ resultCode:"00", resultMsg:"NORMAL SERVICE." },
  body:{ items:items.length ? { item:items } : "", numOfRows:500, pageNo:1, totalCount:items.length } } });

async function stubLauncher(page, options = {}){
  const asked = [];
  await page.route("**/can-proxy-ship", (route) => options.ship === false
    ? route.fulfill({ status:404, contentType:"text/plain", body:"Not found" })
    : route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route("**/ship-ports", (route) => route.fulfill({ status:200, contentType:"application/json",
    body:envelope(ports) }));
  await page.route("**/ship-schedule?**", (route) => {
    asked.push(new URL(route.request().url()).search);
    if (options.keyInvalid) return route.fulfill({ status:428, contentType:"text/plain", body:"bus-key-invalid" });
    const port = new URL(route.request().url()).searchParams.get("port");
    return route.fulfill({ status:200, contentType:"application/json", body:envelope(port === "SEA10100" ? incheon : []) });
  });
  await page.route("**/tile-proxy**", (route) => route.abort());
  return asked;
}
const routes = (page) => page.locator(".leaflet-mapShip-pane path.map-ship-route");
const mapModel = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
  if (!doc) return "";
  const { center, zoom, ...rest } = JSON.parse(JSON.stringify(doc.mapDoc));
  return JSON.stringify(rest);
});

test("런처가 아니면 여객선 단추는 눌리지 않는다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { ship:false });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-toolvis-ship")).toBeDisabled();
});

test("항구 시간표를 불러오면 도착지마다 점선, 항해마다 한 줄", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  const asked = await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  const before = await mapModel(page);

  const toggle = page.locator(".map-toolvis-ship");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  const panel = page.locator(".map-ship-panel");
  await expect(panel).toBeVisible();
  // 표본이 오늘 것이 아닐 수 있어 '지난 편 숨기기'를 끄고 본다.
  await page.locator(".map-ship-hide input").uncheck();
  await page.locator(".map-ship-port").fill("인천");
  await page.locator(".map-ship-load").click();

  await expect(page.locator(".map-ship-summary")).toContainText("인천 출발");
  expect(asked[0]).toMatch(/^\?port=SEA10100&date=\d{8}$/);
  await expect(page.locator(".map-ship-item")).toHaveCount(16);
  await expect(page.locator(".map-ship-item", { hasText:"대부고속페리호" }).first()).toContainText("→ 대이작도 · 소이작도 · 승봉도 · 자월도");
  const placed = await page.evaluate((rows) => [...new Set(rows.map(r => r.arrPlaceNm))].filter(n => MNShipApi.coordsOf(n)).length, incheon);
  expect(placed).toBeGreaterThan(14);
  await expect(routes(page)).toHaveCount(placed);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // 도착지 칩: 백령도만 남긴다.
  await page.locator(".map-ship-dest", { hasText:"백령도" }).click();
  const baengnyeong = new Set(incheon.filter(r => r.arrPlaceNm === "백령도").map(r => r.vihicleNm + r.depPlandTime)).size;
  await expect(page.locator(".map-ship-item")).toHaveCount(baengnyeong);
  await page.locator(".map-ship-dest", { hasText:"전체" }).click();

  await page.waitForTimeout(800);
  await page.screenshot({ path:"test-results/ship-map-incheon.png" });
  expect(await mapModel(page)).toBe(before);

  await toggle.click();
  await expect(routes(page)).toHaveCount(0);
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test("지도 가운데 근처 항구를 누르면 그 항구 시간표를 연다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-goto").fill("37.47, 126.60");
  await page.locator(".map-goto").press("Enter");
  await page.locator(".map-toolvis-ship").click();
  await page.locator(".map-ship-nearby").click();
  const first = page.locator(".map-ship-near").first();
  await expect(first).toContainText("인천");
  await first.click();
  await expect(page.locator(".map-ship-summary")).toContainText("인천 출발");
});

test("없는 항구 이름·키 문제는 까닭을 알린다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { keyInvalid:true });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-toolvis-ship").click();
  await page.locator(".map-ship-port").fill("없는항구");
  await page.locator(".map-ship-load").click();
  await expect(page.locator(".map-ship-status")).toContainText("항구 이름을 목록에서 골라 주세요");
  await page.locator(".map-ship-port").fill("인천");
  await page.locator(".map-ship-load").click();
  await expect(page.locator(".map-ship-status")).toContainText("국토교통부_(TAGO)_국내선박운항정보");
});
