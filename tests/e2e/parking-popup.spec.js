"use strict";
const { test, expect } = require("@playwright/test");

/* 실제 Leaflet의 팝업 자동 이동을 사용한다. 데이터/지도 타일은 네트워크로 받지 않는다. */
async function openParking(page){
  const record = { prkplceNo:"parking-popup", prkplceNm:"긴 정보 공영주차장", parkingchrgeInfo:"유료", basicTime:"30", basicCharge:"600", addUnitTime:"10", addUnitCharge:"300",
    latitude:"37.5665", longitude:"126.978", prkcmprt:"50", rdnmadr:"서울특별시 중구 주차장길 123", prkplceSe:"공영", prkplceType:"노외",
    dayCmmtkt:"10000", monthCmmtkt:"100000", operDay:"평일+토요일+공휴일", weekdayOperOpenHhmm:"09:00", weekdayOperColseHhmm:"21:00",
    satOperOperOpenHhmm:"00:00", satOperCloseHhmm:"23:59", holidayOperOpenHhmm:"10:00", holidayCloseOpenHhmm:"18:00", metpay:"현금+카드",
    spcmnt:"주차권 할인은 현장 확인이 필요합니다. ".repeat(15), institutionNm:"주차장 관리센터", phoneNumber:"02-123-4567", pwdbsPpkZoneYn:"Y", referenceDate:"2026-10-09" };
  let requests = 0;
  await page.route("**/can-proxy-weather", route => route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route("**/parking-fees?**", route => { requests++; return route.fulfill({ status:200, contentType:"application/json",
    body:JSON.stringify({ header:{ resultCode:"00" }, body:{ items:{ item:[record] }, totalCount:1 } }) }); });
  await page.route("**/parking-popup-fixture", route => route.fulfill({ status:200, contentType:"text/html", body:`<!doctype html><html lang="ko"><head>
    <link rel="stylesheet" href="/vendor/leaflet.css"><link rel="stylesheet" href="/src/styles.css">
    <style>body{margin:0}#stage{position:relative;width:1000px;height:460px;margin:20px}#map{width:100%;height:100%}#tools{padding:12px}</style>
    </head><body><div id="tools"></div><div id="stage"><div id="map"></div></div>
    <script src="/vendor/leaflet.min.js"></script><script src="/src/js/parking-fees.js"></script>
    <script>window.parkingMap=L.map('map',{zoomAnimation:false,fadeAnimation:false}).setView([37.5665,126.978],16);
    window.autoPans=0;window.parkingMap.on('autopanstart',()=>window.autoPans++);
    window.parkingController=MNParkingFees.mount({map:window.parkingMap,stage:document.getElementById('stage'),toolRow:document.getElementById('tools'),doc:{}});</script>
    </body></html>` }));
  await page.setViewportSize({ width:1100, height:650 });
  await page.goto("/parking-popup-fixture");
  const toggle = page.locator(".map-toolvis-parking-fees"); await expect(toggle).toBeEnabled(); await toggle.click();
  await expect(page.locator(".map-parking-go")).toHaveCount(1);
  // 비교 창이 지점을 덮지 않도록 창만 닫는다. 지도 표시를 그대로 사용한다.
  await page.locator(".map-parking-panel .map-weather-heading button").click();
  return { requests:() => requests };
}

test("주차 표시의 긴 상세 팝업은 자동 지도 이동 후에도 유지되고 내부에서 스크롤된다", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message)); const h = await openParking(page);
  await page.locator(".leaflet-mapParkingFees-pane path.leaflet-interactive").click();
  const popup = page.locator(".leaflet-popup"); await expect(popup).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.autoPans)).toBeGreaterThan(0);
  // 기존 코드가 예약한 120ms 재그리기와 Leaflet 이동 애니메이션이 끝난 뒤 확인한다.
  await page.waitForTimeout(700); await expect(popup).toBeVisible();
  await expect(popup.locator(".map-parking-name")).toHaveText("긴 정보 공영주차장");
  const content = popup.locator(".leaflet-popup-content");
  expect(await content.evaluate(n => n.clientHeight)).toBeLessThanOrEqual(280);
  expect(await content.evaluate(n => n.scrollHeight > n.clientHeight)).toBe(true);
  await content.evaluate(n => { n.scrollTop = n.scrollHeight; }); await expect(popup).toContainText("2026-10-09");
  expect(h.requests()).toBe(1); expect(errors).toEqual([]);
});

test("목록에서 연 주차 상세도 유지되고 시간 변경과 표시 지우기는 올바르게 처리된다", async ({ page }) => {
  const h = await openParking(page); await page.locator(".map-toolvis-parking-fees").click();
  await page.locator(".map-parking-go").click(); const popup = page.locator(".leaflet-popup"); await expect(popup).toBeVisible();
  await page.waitForTimeout(700); await expect(popup).toBeVisible();
  await page.locator(".map-parking-duration").selectOption("60"); await expect(popup).toHaveCount(0);
  await expect(page.locator(".map-parking-go-price")).toHaveText("1,500원");
  await page.locator(".map-parking-go").click(); await expect(popup).toBeVisible();
  await page.locator(".map-parking-clear").click(); await expect(popup).toHaveCount(0);
  await expect(page.locator(".leaflet-mapParkingFees-pane path.leaflet-interactive")).toHaveCount(0); expect(h.requests()).toBe(1);
});
