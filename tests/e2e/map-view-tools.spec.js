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

/* 표시를 목록 순서대로 이어 주는 선. 선을 도형으로 굳혀 두지 않는 것이 요점이라, 표시를
   지우거나 순서를 바꾸면 선이 그 자리에서 다시 이어져야 한다. */
test("표시 잇기는 목록 순서대로 잇고 표시가 바뀌면 저절로 다시 이어진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  const routeBtn = page.locator(".map-route-toggle");
  const routeLine = page.locator(".map-route-line");
  const routeLabel = page.locator(".map-route-label");
  await expect(routeBtn).toHaveAttribute("aria-pressed", "false");

  // 표시가 하나뿐이면 켜도 그릴 선이 없다 — 켠 것 자체는 문서에 남는다.
  await dropPin(page, "학교", -80, -50);
  await routeBtn.click();
  await expect(routeBtn).toHaveAttribute("aria-pressed", "true");
  expect((await mapModel(page)).route).toBe(true);
  await expect(routeLine).toHaveCount(0);

  // 두 번째 표시부터 선이 나타나고, 세 번째를 찍으면 저절로 늘어난다.
  await dropPin(page, "도서관", 40, -10);
  await expect(routeLine).toHaveCount(1);
  await expect(routeLabel).toContainText("표시 2개");
  await dropPin(page, "공원", 60, 60);
  await expect(routeLabel).toContainText("표시 3개");

  // 선은 저장하지 않는다 — .map 에 남는 것은 켜 두었다는 사실뿐이다.
  expect((await mapModel(page)).shapes).toEqual([]);

  // 목록에서 순서를 바꾸면 잇는 차례도 그대로 따라간다.
  await page.locator(".map-list-toggle").click();
  const names = () => page.locator(".map-list-name");
  await expect(names()).toHaveText(["학교", "도서관", "공원"]);
  await page.locator(".map-list-item").first().getByRole("button", { name:"발표 순서를 뒤로" }).click();
  await expect(names()).toHaveText(["도서관", "학교", "공원"]);
  expect((await mapModel(page)).markers.map(m => m.label)).toEqual(["도서관", "학교", "공원"]);
  await expect(routeLine).toHaveCount(1);

  // 가운데 표시를 지우면 남은 둘이 곧바로 이어진다(선을 손볼 필요가 없다).
  await page.locator(".map-list-item").nth(1).locator(".map-list-remove").click();
  await expect(routeLabel).toContainText("표시 2개");

  // 되돌리기는 격자·이름표와 같은 범위다 — 지운 표시가 돌아오면 선도 셋으로 돌아간다.
  await page.locator(".map-undo").click();
  await expect(routeLabel).toContainText("표시 3개");

  /* 우클릭 메뉴에도 같은 항목이 있다(도구를 접어 두면 그쪽이 유일한 길이다). 켜 둔 도구는
     도구막대처럼 is-on 으로 표시돼 메뉴에서 체크(✓)로 보인다. */
  const stage = page.locator(".map-stage");
  const box = await stage.boundingBox();
  /* 표시가 몰려 있는 한가운데를 피해 오른쪽 아래쪽에서 부르되, 맨 모서리는 쓰지 않는다 —
     거기는 Leaflet 저작권 표시 줄이라 우클릭이 지도까지 닿지 않는다(메뉴가 아예 안 열린다). */
  await page.mouse.click(box.x + box.width - 40, box.y + box.height - 70, { button:"right" });
  await expect(page.locator(".map-context-menu")).toBeVisible();
  const menuItem = page.locator(".map-context-menu button", { hasText:"표시 잇기" });
  await expect(menuItem).toBeVisible();
  await expect(menuItem).toHaveClass(/is-on/);
  // 메뉴에서 누르면 도구막대 단추를 그대로 누른 것과 같다 — 꺼지고 선도 걷힌다.
  await menuItem.click();
  await expect(routeBtn).toHaveAttribute("aria-pressed", "false");
  await expect(routeLine).toHaveCount(0);

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
