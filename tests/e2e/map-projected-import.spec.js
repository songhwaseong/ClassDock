const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const K = require("../../src/js/korea-coords.js");

/* 표 들이기: 위경도 대신 평면 좌표(미터)가 적힌 표.
 * 예전에는 이런 줄이 '좌표 오류' 로 모두 빠졌다. 이제는 좌표계를 골라 앱 안에서 바꿔 넣는다.
 * 중부원점 GRS80 5186 과 5181 은 값만으로 가를 수 없어(북쪽으로 100km 차이) 주소 열과 맞춰 고르는지 본다. */
async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
}
const mapModel = (page) => page.evaluate(() => JSON.parse(JSON.stringify(docs.find(d => d.kind === "map").mapDoc)));
async function importCsv(page, text){
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".map-csv-import").click();
  await (await chooser).setFiles({ name:"places.csv", mimeType:"text/csv", buffer:Buffer.from(text, "utf8") });
}
const places = [
  { name:"서울시청", address:"서울특별시 중구 세종대로 110", lat:37.5663, lng:126.9779 },
  { name:"부산시청", address:"부산광역시 연제구 중앙대로 1001", lat:35.1796, lng:129.0756 },
  { name:"제주시청", address:"제주특별자치도 제주시 광양9길 10", lat:33.4996, lng:126.5312 }
];

test("주소 열이 있으면 주소와 맞는 좌표계를 골라 표시로 넣는다", async ({ page }) => {
  await openApp(page);
  const rows = places.map(p => { const [x, y] = K.fromWgs84("5186", p.lat, p.lng); return [p.name, p.address, x.toFixed(2), y.toFixed(2)].join(","); });
  await importCsv(page, "이름,주소,X좌표,Y좌표\n" + rows.join("\n") + "\n");

  const modal = page.locator(".map-projected-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".map-projected-system")).toHaveValue("5186");
  await expect(modal.locator(".map-projected-reason")).toContainText("3줄 중 3줄");
  await expect(modal.locator("tbody tr.is-match")).toHaveCount(3);
  await expect(modal.locator("tbody tr").first()).toContainText("서울특별시 중구");

  // 다른 좌표계를 고르면 미리보기가 바로 바뀐다(5181 이면 100km 남쪽 — 주소와 안 맞는다).
  await modal.locator(".map-projected-system").selectOption("5181");
  await expect(modal.locator("tbody tr.is-match")).toHaveCount(0);
  await modal.locator(".map-projected-system").selectOption("5186");

  await modal.locator(".map-projected-apply").click();
  await expect(modal).toHaveCount(0);
  const model = await mapModel(page);
  expect(model.markers).toHaveLength(3);
  for (const place of places) {
    const marker = model.markers.find(m => m.label === place.name);
    expect(Math.abs(marker.lat - place.lat)).toBeLessThan(0.00001);
    expect(Math.abs(marker.lng - place.lng)).toBeLessThan(0.00001);
    expect(marker.address).toBe(place.address);
    expect(marker).not.toHaveProperty("x");
  }
});

test("주소가 없으면 열 이름과 값 범위로 짐작하고, 취소하면 아무것도 넣지 않는다", async ({ page }) => {
  await openApp(page);
  // 인허가(LOCALDATA) 모양 — '좌표정보(x)' 는 중부원점 Bessel 로 먼저 짐작한다.
  const rows = places.map(p => { const [x, y] = K.fromWgs84("2097", p.lat, p.lng); return [p.name, x.toFixed(1), y.toFixed(1)].join(","); });
  await importCsv(page, "사업장명,좌표정보(x),좌표정보(y)\n" + rows.join("\n") + "\n");
  const modal = page.locator(".map-projected-modal");
  await expect(modal.locator(".map-projected-system")).toHaveValue("2097");
  await expect(modal.locator(".map-projected-reason")).toContainText("값 범위로 짐작");
  await expect(modal.locator(".map-projected-summary")).toContainText("3줄 중 3줄");
  await modal.locator(".map-projected-cancel").click();
  await expect(modal).toHaveCount(0);
  expect((await mapModel(page)).markers).toHaveLength(0);
});
