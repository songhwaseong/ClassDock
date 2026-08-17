const { test, expect } = require("@playwright/test");
const { collapseSidebar, storedZip } = require("./helpers");

const MAP_DOC = JSON.stringify({
  type: "classdock-map",
  version: 1,
  title: "답사 지도",
  basemap: "osm",
  center: [37.5665, 126.978],
  zoom: 13,
  markers: [{ id: "mk-1", lat: 37.5665, lng: 126.978, label: "시청", note: "", color: "blue" }]
}, null, 2);

// 자바스크립트 소스맵도 `.map` 을 쓴다 — 지도로 오해하면 안 되는 쪽.
const SOURCE_MAP = JSON.stringify({ version: 3, sources: ["a.js"], names: [], mappings: "AAAA" });

/* 본문을 직접 클릭하는 검사는 사이드바를 접고 시작한다(열려 있으면 백드롭이 클릭을 가져간다).
   사이드바 목록을 눌러야 하는 검사만 펴 둔 채로 연다. */
async function boot(page, lang, options = {}){
  await page.addInitScript((uiLang) => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", uiLang);
    } catch(_){}
  }, lang);
  if (options.sidebar !== "open") await collapseSidebar(page);
  await page.goto("/");
}

test("압축 파일 안의 .map 도 지도로 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page, "ko", { sidebar: "open" });

  await page.locator("#fileInput").setInputFiles({
    name: "수업자료.zip",
    mimeType: "application/zip",
    buffer: storedZip([{ name: "답사 지도.map", data: MAP_DOC }])
  });

  /* 압축을 풀어도 첫 파일을 자동으로 열지는 않는다(의도된 동작) — 사이드바에서 눌러 연다.
     여기서 확인할 것은 "압축 안의 .map 이 목록에 올라오고, 누르면 지도로 열리는가" 이다. */
  const row = page.locator("#sbList .sb-item", { hasText: "답사 지도.map" });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.click();

  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1, { timeout: 20_000 });
  const opened = await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    return doc ? { name: doc.name, title: doc.mapDoc.title, markers: doc.mapDoc.markers.length, zoom: doc.mapDoc.zoom } : null;
  });
  expect(opened).toEqual({ name: "답사 지도.map", title: "답사 지도", markers: 1, zoom: 13 });
  expect(errors).toEqual([]);
});

/* `.map` 은 자바스크립트 소스맵도 쓰는 확장자다. 지도로 열리지 않는 것은 물론이고,
   "지도가 깨졌다"는 안내가 뜨면 안 된다 — 애초에 지도였던 적이 없기 때문이다. */
test("같은 확장자의 소스맵은 지도가 아니라 텍스트로, 경고 없이 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page, "ko");

  await page.locator("#fileInput").setInputFiles({
    name: "app.js.map",
    mimeType: "application/json",
    buffer: Buffer.from(SOURCE_MAP, "utf8")
  });

  await expect(page.locator("#activeFileName")).toHaveText("app.js.map");
  expect(await page.evaluate(() => docs.filter(d => d.kind === "map").length)).toBe(0);
  await expect(page.locator(".toast", { hasText: "지도 문서" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("EN 으로 바꾸면 지도 화면도 영어로 나온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page, "en");

  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  // 이모지는 icons.js 가 SVG 로 바꾸므로 글자만 본다.
  await expect(page.locator(".map-add")).toContainText("Add a pin");
  await expect(page.locator(".map-to-board")).toContainText("To whiteboard");
  await expect(page.locator(".map-title")).toHaveAttribute("placeholder", "Map title");
  await expect(page.locator(".map-goto")).toHaveAttribute("placeholder", "Place name or coordinates");
  await expect(page.locator(".map-select option").first()).toHaveText("Standard");

  // 마커 편집 풍선도 열릴 때 번역된다.
  await page.locator(".map-add").click();
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    doc.mapInstance.fire("click", { latlng: { lat: 37.5, lng: 127 } });
  });
  await expect(page.locator(".map-popup-label")).toHaveAttribute("placeholder", "Name");
  await expect(page.locator(".map-popup-remove")).toHaveText("Delete pin");
  await expect(page.locator('.map-swatch[aria-label="Blue"]')).toHaveCount(1);
  await expect(page.locator(".map-status")).toContainText("Not saved");

  // 숫자가 끼어 조립되는 문구도 영어로 나온다.
  await expect(page.locator(".map-coord")).toContainText("Center");
  await expect(page.locator(".map-coord")).toContainText("zoom");

  expect(errors).toEqual([]);
});

test("EN 에서는 칠판의 지도 고르기 창도 영어로 나온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page, "en");

  await page.keyboard.press("Alt+b");
  await expect(page.locator(".wb-canvas")).toHaveCount(1);
  await expect(page.locator(".wb-map")).toHaveAttribute("title", /Insert a map/);

  await page.locator(".wb-map").click();
  await expect(page.locator(".map-picker-modal h3")).toHaveText("Pick a map");
  await expect(page.locator(".map-picker-ok")).toHaveText("Insert this view");
  await expect(page.locator(".map-picker-cancel")).toHaveText("Cancel");
  await expect(page.locator(".map-picker-modal .sub")).toContainText("Choose the area");
  await expect(page.locator(".map-picker-basemap option").first()).toHaveText("Standard");

  expect(errors).toEqual([]);
});
