const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 지도 읽기 도구(축척·방위·위경도 격자)와 표시 목록, 그리고 그림으로 내보내기.
   배경 타일은 인터넷에서 받으므로 여기서도 기대하지 않는다 — 우리가 그리는 것만 본다. */
async function openApp(page){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
      localStorage.removeItem("mn.mapListPanel");
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
}

const mapModel = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
  return doc ? JSON.parse(JSON.stringify(doc.mapDoc)) : null;
});

// 표시를 한 개 찍고 이름을 붙인다(찍을 때마다 추가 모드가 풀리므로 매번 다시 켠다).
async function dropPin(page, name, dx, dy){
  const stage = page.locator(".map-stage");
  await page.locator(".map-add").click();
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.locator(".map-popup-label").last().fill(name);
  /* 말풍선은 닫아도 200ms 가량 DOM 에 남는다 — 다음 표시를 찍기 전에 사라진 것을 확인한다
     (남아 있으면 다음 이름 칸을 고를 때 선택자가 둘을 잡는다). */
  await page.evaluate(() => docs.find(d => d.kind === "map").mapInstance.closePopup());
  await expect(page.locator(".map-popup-label")).toHaveCount(0);
}

test("축척 막대는 지도 칸에 붙어 확대에 따라 눈금이 바뀐다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 컨트롤 칸(확대 단추·저작권)이 아니라 지도 칸에 직접 붙어야 캡처·인쇄에도 남는다.
  const legend = page.locator(".map-stage > .map-legend");
  await expect(legend).toHaveCount(1);
  const scaleText = page.locator(".map-scale-text");
  await expect(scaleText).not.toHaveText("");
  const wide = await scaleText.textContent();

  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    doc.mapInstance.setView([37.5665, 126.978], 16);
  });
  await expect(scaleText).not.toHaveText(wide);      // 확대하면 축척도 따라 잘아진다
  // 축척 막대는 눈금 값만큼의 폭을 갖는다(0 이면 그리지 않은 것).
  const width = await page.locator(".map-scale-bar").evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(10);

  expect(errors).toEqual([]);
});

test("위경도 격자는 켠 채로 저장되고 적도·본초자오선을 따로 부른다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  const gridBtn = page.locator(".map-grid-toggle");
  await expect(gridBtn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".map-grid-label")).toHaveCount(0);

  await gridBtn.click();
  await expect(gridBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-grid-label").first()).toBeVisible();
  expect((await mapModel(page)).grid).toBe(true);
  // 격자는 저장되는 내용이라 ● 가 켜진다(● 는 icons.js 가 SVG 로 바꾸므로 글자만 본다).
  await expect(page.locator(".map-status")).toContainText("저장 안 됨");

  // 적도·본초자오선이 보이는 자리로 옮기면 그 두 선만 따로 이름이 붙는다.
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    doc.mapInstance.setView([0, 0], 5);
  });
  await expect(page.locator(".map-grid-label.is-zero")).toHaveCount(2);
  await expect(page.locator(".map-grid-label.is-zero").first()).toContainText("0°");

  // 되돌리기 한 단계면 격자도 함께 꺼진다(저장 내용과 같은 범위).
  await page.locator(".map-undo").click();
  await expect(gridBtn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".map-grid-label")).toHaveCount(0);
  expect((await mapModel(page)).grid).toBe(false);

  expect(errors).toEqual([]);
});

test("표시 목록에서 이름으로 찾고, 눌러서 그 자리로 가고, 지울 수 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await dropPin(page, "우리 학교", -60, -40);
  await dropPin(page, "도서관", 70, 50);

  const listBtn = page.locator(".map-list-toggle");
  await listBtn.click();
  await expect(listBtn).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator(".map-list-item");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".map-list-foot")).toContainText("2");

  // 이름으로 거르면 그 줄만 남는다.
  await page.locator(".map-list-filter").fill("도서");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".map-list-name")).toHaveText("도서관");

  // 줄을 누르면 그 표시 자리로 옮겨 간다(적어도 확대 15 단계까지 들어간다).
  await page.locator(".map-list-go").click();
  const view = await page.evaluate(() => {
    const map = docs.find(d => d.kind === "map").mapInstance;
    const center = map.getCenter();
    return { zoom:map.getZoom(), lat:center.lat, lng:center.lng };
  });
  expect(view.zoom).toBeGreaterThanOrEqual(15);
  const target = (await mapModel(page)).markers.find(m => m.label === "도서관");
  expect(Math.abs(view.lat - target.lat)).toBeLessThan(0.001);
  expect(Math.abs(view.lng - target.lng)).toBeLessThan(0.001);

  // 목록에서 지우면 지도와 모델에서 함께 사라진다.
  await page.locator(".map-list-remove").click();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  expect((await mapModel(page)).markers.map(m => m.label)).toEqual(["우리 학교"]);

  // 접었다 펴도 같은 목록이 돌아온다(펴 둔 상태는 이 브라우저에 남는다).
  await listBtn.click();
  await expect(page.locator(".map-list")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("mn.mapListPanel"))).toBe("0");

  expect(errors).toEqual([]);
});

test("PNG 저장은 지도 제목으로 그림 파일을 내려 준다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.locator(".map-title").fill("우리 동네 답사");
  const download = page.waitForEvent("download");
  await page.locator(".map-save-png").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("우리 동네 답사.png");

  expect(errors).toEqual([]);
});
