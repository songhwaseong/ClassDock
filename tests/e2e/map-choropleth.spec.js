const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 색칠 지도의 화면 쪽 계약. 이름 맞추기 규칙은 tests/map-choropleth.test.js 가 보고, 여기서는
   붙여 넣은 표 → 경계층·범례 → 마우스 올린 지역 → 우클릭 메뉴 → 되돌리기·저장이 한 흐름으로 이어지는지 본다.
   배경 타일은 인터넷에서 받으므로 기대하지 않는다(경계는 앱에 들어 있어 타일 없이 그려진다). */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}
const mapModel = (page) => page.evaluate(() => JSON.parse(JSON.stringify(docs.find(d => d.kind === "map").mapDoc)));
const screenPoint = (page, lat, lng) => page.evaluate(([la, ln]) => {
  const map = docs.find(d => d.kind === "map").mapInstance;
  const rect = map.getContainer().getBoundingClientRect();
  const point = map.latLngToContainerPoint([la, ln]);
  return { x:rect.left + point.x, y:rect.top + point.y };
}, [lat, lng]);

const TABLE = [
  "시도\t인구(명)",
  "전국\t51,000,000",
  "서울특별시\t9,386,034",
  "경기도\t13,630,821",
  "광주광역시\t1,419,237",
  "전라남도\t1,804,217",
  "부산\t3,266,598",
  "없는도\t12"
].join("\n");

test("붙여 넣은 표로 시도를 칠하고 범례·마우스 올린 지역·되돌리기·저장이 따라온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  const button = page.locator(".map-choropleth");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  const modal = page.locator(".map-choro-modal");
  await expect(modal).toBeVisible();

  await modal.locator(".map-choro-paste").fill(TABLE);
  // 광주광역시·전라남도가 있으니 자동 시점은 통합 전(2025년 12월)을 고른다
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 5곳");
  await expect(modal.locator(".map-choro-note")).toContainText("2025년 12월 기준");
  await expect(modal.locator(".map-choro-note")).toContainText("없는도");
  await modal.locator(".map-choro-unit").fill("명");
  await modal.locator(".map-choro-apply").click();
  await expect(modal).toHaveCount(0);

  await expect(button).toHaveAttribute("aria-pressed", "true");
  const model = await mapModel(page);
  expect(model.choropleth.vintage).toBe("2025-12");
  expect(model.choropleth.title).toBe("인구(명)");
  expect(model.choropleth.values).toEqual({ "서울특별시":9386034, "경기도":13630821, "광주광역시":1419237, "전라남도":1804217, "부산광역시":3266598 });
  await expect(page.locator(".leaflet-mapChoro-pane path")).toHaveCount(17);
  const legend = page.locator(".map-choro-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("인구(명) (명)");
  await expect(legend).toContainText("자료 없음");
  await expect(legend).toContainText("통계청 SGIS");
  await expect(page.locator(".map-status")).toContainText("저장 안 됨");

  // 서울 위에 마우스를 올리면 지역 이름과 값이 뜬다
  const seoul = await screenPoint(page, 37.5665, 126.978);
  await page.mouse.move(seoul.x, seoul.y);
  await expect(page.locator(".map-choro-hover")).toContainText("서울특별시 · 9,386,034 명");

  // 나라 전체를 덮는 층이지만 우클릭 메뉴는 그대로 열린다
  await page.mouse.click(seoul.x, seoul.y, { button:"right" });
  await expect(page.locator(".map-context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  // 저장 형식에 담긴다
  const saved = await page.evaluate(() => JSON.parse(mapDocSerialize(docs.find(d => d.kind === "map").mapDoc)));
  expect(saved.version).toBe(13);
  expect(saved.choropleth.values["서울특별시"]).toBe(9386034);

  // 되돌리면 색칠이 걷힌다
  await page.locator(".map-undo").click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".leaflet-mapChoro-pane path")).toHaveCount(0);
  await expect(legend).toBeHidden();
  expect(errors).toEqual([]);
});

test("켜진 🎨 단추를 다시 누르면 색칠이 걷히고, 다시 켜면 걷기 전 설정이 창에 채워지며, 범례를 누르면 설정 창이 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  const button = page.locator(".map-choropleth");
  const modal = page.locator(".map-choro-modal");
  await button.click();
  await expect(modal.locator(".map-choro-clear")).toHaveCount(0);   // 창에는 지우기 단추가 없다
  await modal.locator(".map-choro-paste").fill(TABLE);
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 5곳");
  await modal.locator(".map-choro-title").fill("우리 인구");
  await modal.locator(".map-choro-apply").click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  // 되돌리기 기록은 200ms 안의 변경을 한 단계로 묶는다 — 칠한 것이 기록된 뒤에 걷어야 따로 되돌려진다.
  await expect(page.locator(".map-undo")).toBeEnabled();
  const legend = page.locator(".map-choro-legend");
  await expect(legend).toBeVisible();

  // 범례를 누르면 지금 설정으로 창이 열리고, 지도에는 표시가 찍히지 않는다
  const markersBefore = (await mapModel(page)).markers.length;
  await legend.click();
  await expect(modal).toBeVisible();
  await expect(modal.locator(".map-choro-title")).toHaveValue("우리 인구");
  await modal.locator(".map-choro-close").click();
  await expect(modal).toHaveCount(0);
  expect((await mapModel(page)).markers.length).toBe(markersBefore);

  // 켜진 단추를 누르면 창 없이 바로 걷힌다
  await button.click();
  await expect(modal).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".leaflet-mapChoro-pane path")).toHaveCount(0);
  await expect(legend).toBeHidden();
  expect((await mapModel(page)).choropleth).toBeNull();

  // 다시 누르면 걷기 전 설정이 채워진 창이 열린다
  await button.click();
  await expect(modal).toBeVisible();
  await expect(modal.locator(".map-choro-title")).toHaveValue("우리 인구");
  await expect(modal.locator(".map-choro-paste")).toHaveValue(/서울특별시\t9386034/);
  await modal.locator(".map-choro-close").click();

  // 걷은 것도 되돌리기로 살아난다
  await page.locator(".map-undo").click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(legend).toBeVisible();
  expect(errors).toEqual([]);
});

test("읍면동은 범위를 골라 코드 붙은 표로 칠하고, 범위로 지도를 옮기며, 다시 열면 범위가 남아 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await page.locator(".map-choropleth").click();
  const modal = page.locator(".map-choro-modal");
  await expect(modal.locator(".map-choro-scope")).toBeHidden();
  await modal.locator(".map-choro-level").selectOption("emd");
  await expect(modal.locator(".map-choro-scope")).toBeVisible();
  await expect(modal.locator(".map-choro-scope-sido")).toHaveValue("서울특별시");
  await modal.locator(".map-choro-scope-sgg").selectOption("종로구");
  await modal.locator(".map-choro-paste").fill([
    "행정구역\t인구",
    "서울특별시 (1100000000)\t9,386,034",
    "서울특별시 종로구 (1111000000)\t139,417",
    "서울특별시 종로구 청운효자동(1111051500)\t11,000",
    "서울특별시 종로구 사직동(1111053000)\t9,000",
    "부산광역시 중구 중앙동(2611051000)\t5,000"
  ].join("\n"));
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 2곳");
  await expect(modal.locator(".map-choro-note")).toContainText("범위 밖 1줄");
  await modal.locator(".map-choro-apply").click();
  await expect(modal).toHaveCount(0);

  const settings = (await mapModel(page)).choropleth;
  expect(settings.level).toBe("emd");
  expect(settings.scope).toBe("서울특별시|종로구");
  expect(settings.values).toEqual({ "서울특별시|종로구|청운효자동":11000, "서울특별시|종로구|사직동":9000 });
  const expected = await page.evaluate(() => mapChoroRegions("emd", "2026-07", "서울특별시|종로구").length);
  await expect(page.locator(".leaflet-mapChoro-pane path")).toHaveCount(expected);
  // 종로구로 옮겨 간다
  const center = await page.evaluate(() => docs.find(d => d.kind === "map").mapInstance.getCenter());
  expect(Math.abs(center.lat - 37.59)).toBeLessThan(0.05);
  expect(Math.abs(center.lng - 126.98)).toBeLessThan(0.05);

  // 범례를 누르면 읍면동·범위가 그대로 채워진 창이 열린다
  await page.locator(".map-choro-legend").click();
  await expect(modal.locator(".map-choro-level")).toHaveValue("emd");
  await expect(modal.locator(".map-choro-scope-sgg")).toHaveValue("종로구");
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 2곳");
  expect(errors).toEqual([]);
});

test("표시 개수로 칠하면 표시를 더할 때 색이 따라 바뀌고, 시군구 값 글자는 확대해야 나온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    for (const [lat, lng] of [[37.5796, 126.977], [37.58, 126.98], [37.4979, 127.0276]]) doc.mapDoc.markers.push(mapNormalizeMarker({ lat, lng }));
  });

  await page.locator(".map-choropleth").click();
  const modal = page.locator(".map-choro-modal");
  await modal.locator(".map-choro-level").selectOption("sgg");
  await modal.locator('input[name="mapChoroSource"][value="markers"]').check();
  await expect(modal.locator(".map-choro-paste")).toBeHidden();
  await expect(modal.locator(".map-choro-note")).toContainText("표시 3개 중 3개");
  await modal.locator(".map-choro-labels").check();
  await modal.locator(".map-choro-apply").click();

  const legend = page.locator(".map-choro-legend");
  await expect(legend).toContainText("지역별 표시 개수 (개)");
  expect((await mapModel(page)).choropleth.values).toEqual({});   // 개수는 저장하지 않고 열 때마다 센다

  // 멀리서는 시군구 글자를 쓰지 않는다
  await page.evaluate(() => docs.find(d => d.kind === "map").mapInstance.setView([37.55, 126.99], 7, { animate:false }));
  await expect(page.locator(".map-choro-label")).toHaveCount(0);
  await page.evaluate(() => docs.find(d => d.kind === "map").mapInstance.setView([37.55, 126.99], 11, { animate:false }));
  await expect(page.locator(".map-choro-label", { hasText:"종로구" })).toContainText("2");

  // 표시를 하나 더 찍으면 다시 센다
  const addBtn = page.locator(".map-add");
  await addBtn.click();
  const jongno = await screenPoint(page, 37.573, 126.979);
  await page.mouse.click(jongno.x, jongno.y);
  await expect(page.locator(".map-choro-label", { hasText:"종로구" })).toContainText("3");
  expect(errors).toEqual([]);
});

test("색을 직접 고르면 미리보기 띠·지도·범례가 그 색으로 칠해지고 다음 지도에서도 이어 쓴다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await page.locator(".map-choropleth").click();
  const modal = page.locator(".map-choro-modal");
  await modal.locator(".map-choro-paste").fill(TABLE);
  await expect(modal.locator(".map-choro-custom")).toBeHidden();
  await modal.locator(".map-choro-scheme").selectOption("custom");
  await expect(modal.locator(".map-choro-custom")).toBeVisible();
  await modal.locator(".map-choro-classes").selectOption("3");
  await modal.locator(".map-choro-color-low").fill("#ffffff");
  await modal.locator(".map-choro-color-high").fill("#7c3aed");
  const strip = () => modal.locator(".map-choro-preview i").evaluateAll(cells => cells.map(cell => cell.title));
  expect(await strip()).toEqual(["#ffffff", "#be9df6", "#7c3aed"]);
  // 가운데 색을 켜면 가운데 칸이 그 색이 된다
  await modal.locator(".map-choro-mid-on").check();
  await modal.locator(".map-choro-color-mid").fill("#facc15");
  expect(await strip()).toEqual(["#ffffff", "#facc15", "#7c3aed"]);
  await modal.locator(".map-choro-apply").click();

  const settings = (await mapModel(page)).choropleth;
  expect(settings.scheme).toBe("custom");
  expect(settings.customColors).toEqual(["#ffffff", "#facc15", "#7c3aed"]);
  const fills = await page.locator(".leaflet-mapChoro-pane path").evaluateAll(paths => [...new Set(paths.map(p => p.getAttribute("fill")))]);
  expect(fills).toEqual(expect.arrayContaining(["#ffffff", "#facc15", "#7c3aed"]));
  const swatches = await page.locator(".map-choro-legend-row i").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor));
  expect(swatches.slice(0, 3)).toEqual(["rgb(124, 58, 237)", "rgb(250, 204, 21)", "rgb(255, 255, 255)"]);

  // 새 지도에서 직접 고르기를 열면 지난번 색이 채워져 있다
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-choropleth")).toHaveCount(2);
  await page.locator(".map-choropleth").last().click();
  await page.locator(".map-choro-modal .map-choro-scheme").selectOption("custom");
  await expect(page.locator(".map-choro-modal .map-choro-color-high")).toHaveValue("#7c3aed");
  await expect(page.locator(".map-choro-modal .map-choro-mid-on")).toBeChecked();
  expect(errors).toEqual([]);
});
