const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 지도 문서의 '버스' 층 — 실시간 차량 이름표(시안 A: 노선 색 머리띠 카드)만 본다.
 * 런처 응답은 TAGO 봉투 모양으로 꾸며 둔다(제주 = 도시코드 빈칸). */

const envelope = (items) => JSON.stringify({ response:{ header:{ resultCode:"00", resultMsg:"NORMAL SERVICE." },
  body:{ items:items.length ? { item:items } : "", numOfRows:100, pageNo:1, totalCount:items.length } } });

async function openApp(page){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko");
      localStorage.removeItem("mapBusCity"); localStorage.setItem("mapJejuBusKeyword", "201");
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.route("**/can-proxy-jeju-bus", (route) => route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route("**/jeju-bus-catalog**", (route) => route.fulfill({ status:404, contentType:"text/plain", body:"" }));
  await page.route("**/jeju-bus-routes?**", (route) => route.fulfill({ status:200, contentType:"application/json",
    body:envelope([{ routeid:"JJB405000201", routeno:"201", startnodenm:"제주버스터미널", endnodenm:"서귀포버스터미널", routetp:"간선버스" }]) }));
  await page.route("**/jeju-bus-route?**", (route) => route.fulfill({ status:200, contentType:"application/json",
    body:envelope([
      { nodeid:"JJB1", nodenm:"제주버스터미널", nodeord:1, gpslati:33.5000, gpslong:126.5200, updowncd:0 },
      { nodeid:"JJB2", nodenm:"제주시청", nodeord:2, gpslati:33.4990, gpslong:126.5310, updowncd:0 },
    ]) }));
  await page.route("**/jeju-bus-position?**", (route) => route.fulfill({ status:200, contentType:"application/json",
    headers:{ "X-ClassDock-Bus-Fetched-At":new Date().toUTCString() },
    body:envelope([{ vehicleno:"제주79자1234", nodeid:"JJB2", nodenm:"제주시청", gpslati:33.4991, gpslong:126.5305 }]) }));
  await page.route("**/tile-proxy**", (route) => route.abort());
}

test("버스 차량 이름표는 노선 색 머리띠에 번호·유형·차량 번호, 아래에 정류장과 수신 시각", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());

  const toggle = page.locator(".map-toolvis-jeju-bus");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await page.locator(".map-jeju-bus-search button[type=submit]").click();
  const start = page.getByRole("button", { name:"지도에 표시" });
  await expect(start).toBeEnabled();
  await start.click();

  const bus = page.locator(".map-jeju-bus-marker").first();
  await expect(bus).toBeVisible();
  await bus.hover();
  const tip = page.locator(".leaflet-tooltip.map-bus-tip");
  await expect(tip.locator(".map-bus-tip-number")).toHaveText("201");
  await expect(tip.locator(".map-bus-tip-type")).toHaveText("간선버스");
  await expect(tip.locator(".map-bus-tip-plate")).toHaveText("제주79자1234");
  await expect(tip.locator(".map-bus-tip-station")).toHaveText("제주시청");
  await expect(tip.locator(".map-bus-tip-foot")).toContainText("마지막 수신");
  // 머리띠는 노선 색(간선 = 파랑)으로 칠한다.
  expect(await tip.locator(".map-bus-tip-head").evaluate((n) => n.style.backgroundColor)).toBe("rgb(23, 107, 192)");

  // 노선 위 정류장 점: 누르면 도착 정보가 열리므로 왼쪽 색 띠 + '눌러서 도착 정보 보기 ›'(시안 C).
  await page.mouse.move(5, 5);
  await page.locator(".leaflet-mapJejuBusRoute-pane path.leaflet-interactive").first().hover();
  const stop = page.locator(".leaflet-tooltip.map-point-tip.is-action");
  await expect(stop.locator(".map-point-tip-name")).toHaveText("제주버스터미널");
  await expect(stop.locator(".map-point-tip-hint")).toHaveText("눌러서 도착 정보 보기 ›");
  expect(errors).toEqual([]);
});
