const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const board = require("../fixtures/flight-board-gmp-out.json");

/* 지도 문서의 '항공 운항' 층(공항 게시판 → 노선 선).
 * 뜻풀이(상태 갈래·쪽 넘기기·자정 넘김)는 tests/flight-api.test.js 가 지킨다. 여기서는 화면 계약만 본다.
 *   - 런처 없이 열면 단추가 눌리지 않는가
 *   - 게시판을 불러오면 상대 공항마다 선이 하나씩 그어지고, 목록·칩·숨기기가 맞물리는가
 *   - 편명 찾기는 구간 하나를 긋는가 · 키 문제면 어느 활용신청을 볼지 알리는가
 *   - 무엇보다 이 층이 지도 파일(.map)에 섞이지 않는가
 * 게시판 표본은 2026-09-19 오전 김포 출발 실측(tests/fixtures/flight-board-gmp-out.json)이다. */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); localStorage.removeItem("mapFlightBoard"); } catch(_){}
  });
  await collapseSidebar(page);
}
const envelope = (items, total, page = 1) => JSON.stringify({ response:{ header:{ resultCode:"00", resultMsg:"NORMAL SERVICE." },
  body:{ numOfRows:100, pageNo:page, totalCount:total, items:{ item:items } } } });

async function stubLauncher(page, options = {}){
  const asked = [];
  await page.route("**/can-proxy-flight", (route) => options.flight === false
    ? route.fulfill({ status:404, contentType:"text/plain", body:"Not found" })
    : route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route("**/flight-board?**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    if (options.keyInvalid) return route.fulfill({ status:428, contentType:"text/plain", body:"bus-key-invalid" });
    const line = url.searchParams.get("line") === "I" ? "국제" : "국내";
    const rows = board.filter((row) => row.line === line);
    const pageNo = Number(url.searchParams.get("page"));
    return route.fulfill({ status:200, contentType:"application/json",
      headers:{ "X-ClassDock-Bus-Fetched-At":new Date().toISOString() },
      body:envelope(rows.slice((pageNo - 1) * 100, pageNo * 100), rows.length, pageNo) });
  });
  await page.route("**/flight-search?**", (route) => {
    const inbound = { ...board.find((row) => row.airFln === "RS901"), io:"I", airport:"CJU", city:"GMP", std:"0715", etd:"0708", rmkKor:"도착", rmkEng:"ARRIVED" };
    return route.fulfill({ status:200, contentType:"application/json",
      body:envelope([inbound, board.find((row) => row.airFln === "RS901")], 2) });
  });
  await page.route("**/tile-proxy**", (route) => route.abort());
  return asked;
}
// 보기 자리(center·zoom)는 빼고 비교한다 — 선을 다 보이게 옮긴 것은 문서의 보기 자리로 남는 게 맞다(버스와 같다).
const mapModel = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
  if (!doc) return "";
  const { center, zoom, ...rest } = JSON.parse(JSON.stringify(doc.mapDoc));
  return JSON.stringify(rest);
});
// Leaflet 은 pane 이름의 'Pane' 을 떼고 클래스를 만든다 — mapFlightPane → leaflet-mapFlight-pane.
const routes = (page) => page.locator(".leaflet-mapFlight-pane path.map-flight-route");

test("런처가 아니면 항공 단추는 눌리지 않는다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { flight:false });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-toolvis-flight")).toBeDisabled();
});

test("게시판을 불러오면 상대 공항마다 선 하나, 목록·칩·숨기기가 맞물린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  const asked = await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  const before = await mapModel(page);

  const toggle = page.locator(".map-toolvis-flight");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  const panel = page.locator(".map-flight-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator(".map-flight-airport")).toHaveValue("GMP");
  await panel.locator(".map-flight-load").click();

  // 국내선 147편 → 100줄씩 두 쪽을 묻는다.
  await expect(page.locator(".map-flight-summary")).toContainText("김포 국내선 출발");
  expect(asked).toEqual(["?airport=GMP&io=O&line=D&page=1", "?airport=GMP&io=O&line=D&page=2"]);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  /* 끝난 편(출발 62편)은 기본으로 숨긴다. 남은 편의 상대 공항은 표본에서 6곳(울산은 모두 떠났다). */
  /* 실측 게시판엔 같은 편이 똑같은 줄로 두 번 온 것이 있다(7C117·ZE231). 화면은 한 번만 보인다. */
  const once = (rows) => rows.filter((row, i) => rows.findIndex((other) => other.airFln === row.airFln && other.std === row.std) === i);
  const domestic = once(board.filter((row) => row.line === "국내"));
  const left = domestic.filter((row) => row.rmkKor !== "출발");
  await expect(page.locator(".map-flight-item")).toHaveCount(left.length);
  const leftCities = new Set(left.map((row) => row.city));
  await expect(routes(page)).toHaveCount(leftCities.size);
  await expect(page.locator(".map-flight-summary")).toContainText("끝난 편 " + (domestic.length - left.length) + "편 숨김");

  // 숨기기를 끄면 오늘 편 전부, 선도 떠난 곳까지.
  await page.locator(".map-flight-hide input").uncheck();
  await expect(page.locator(".map-flight-item")).toHaveCount(domestic.length);
  await expect(routes(page)).toHaveCount(new Set(domestic.map((row) => row.city)).size);

  // 제주 칩을 누르면 목록엔 제주 편만 남고, 선은 그대로(다른 곳은 흐리게).
  const jeju = domestic.filter((row) => row.city === "CJU").length;
  await page.locator(".map-flight-dest", { hasText:"제주" }).click();
  await expect(page.locator(".map-flight-item")).toHaveCount(jeju);
  await expect(page.locator(".map-flight-dest.is-on")).toContainText("제주 " + jeju);
  await expect(routes(page)).toHaveCount(new Set(domestic.map((row) => row.city)).size);

  // 국제선 게시판: 63편 한 쪽, 선은 표에 있는 상대 공항마다.
  await page.locator(".map-flight-line").selectOption("I");
  await panel.locator(".map-flight-load").click();
  await expect(page.locator(".map-flight-summary")).toContainText("김포 국제선 출발");
  await expect(page.locator(".map-flight-dest.is-on")).toContainText("전체");
  const intl = once(board.filter((row) => row.line === "국제"));
  await expect(routes(page)).toHaveCount(new Set(intl.map((row) => row.city)).size);
  await expect(page.locator(".map-flight-badge.is-delayed").first()).toHaveText("지연");

  await page.waitForTimeout(800);            // 맞춤 확대 애니메이션이 끝난 뒤에 찍는다
  await page.screenshot({ path:"test-results/flight-map-board.png" });

  // 이 층은 지도 파일에 한 글자도 섞이지 않는다.
  expect(await mapModel(page)).toBe(before);

  // 켜진 단추를 다시 누르면 지우고 닫는다.
  await toggle.click();
  await expect(routes(page)).toHaveCount(0);
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("편명 찾기는 출발→도착 구간 하나를 긋는다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-toolvis-flight").click();
  await page.locator(".map-flight-search input").fill("rs901");
  await page.locator(".map-flight-search button[type=submit]").click();
  await expect(page.locator(".map-flight-summary")).toContainText("편명 RS901");
  await expect(page.locator(".map-flight-item")).toHaveCount(2);
  await expect(page.locator(".map-flight-item").first()).toContainText("김포 → 제주 · 출발");
  await expect(routes(page)).toHaveCount(1);
});

test("키가 이 API 에 안 맞으면 어느 활용신청을 볼지 알린다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { keyInvalid:true });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-toolvis-flight").click();
  await page.locator(".map-flight-load").click();
  await expect(page.locator(".map-flight-status")).toContainText("한국공항공사_실시간 항공기 운항정보 조회");
  await expect(routes(page)).toHaveCount(0);
});
