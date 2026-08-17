const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

const mapModel = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
  return doc ? JSON.parse(JSON.stringify(doc.mapDoc)) : null;
});

/* 배경 타일은 인터넷에서 받으므로 테스트에서는 기대하지 않는다 — 지도 칸·표시·모델만 본다.
   타일 요청이 실패해도 표시와 메모는 그대로 저장돼야 한다는 것이 이 문서의 계약이다. */
test("새 지도에서 표시를 찍고 이름을 붙이면 문서 모델에 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => newMapScratch());
  const stage = page.locator(".map-stage");
  await expect(stage).toHaveCount(1);
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  // 처음엔 표시가 없고, 저장 안 됨(●)도 아니다.
  expect((await mapModel(page)).markers).toEqual([]);
  await expect(page.locator(".map-status")).toHaveText("");

  // 표시 추가 모드로 바꾼 뒤 지도 한가운데를 누르면 그 자리에 표시가 생긴다.
  const addBtn = page.locator(".map-add");
  await addBtn.click();
  await expect(addBtn).toHaveAttribute("aria-pressed", "true");
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);
  await expect(addBtn).toHaveAttribute("aria-pressed", "false");   // 한 번 찍으면 모드가 풀린다
  const afterAdd = await mapModel(page);
  expect(afterAdd.markers).toHaveLength(1);
  expect(afterAdd.markers[0].color).toBe("red");

  // 표시를 찍으면 팝업이 열리고, 거기서 이름을 붙이면 모델과 말풍선에 함께 반영된다.
  const label = page.locator(".map-popup-label");
  await expect(label).toBeVisible();
  await label.fill("우리 학교");
  expect((await mapModel(page)).markers[0].label).toBe("우리 학교");
  // ● 는 icons.js 가 SVG 로 바꿔 두므로 글자만 본다.
  await expect(page.locator(".map-status")).toContainText("저장 안 됨");

  // 색을 바꾸면 그 표시만 색이 바뀐다.
  await page.locator('.map-swatch[aria-label="파랑"]').click();
  expect((await mapModel(page)).markers[0].color).toBe("blue");

  expect(errors).toEqual([]);
});

/* 배경 타일이 안 와도(오프라인 CI) 캡처 자체는 끝나야 한다 — 지도가 그림으로 굳어
   칠판에 올라가는 것까지가 계약이고, 타일 유무는 그림의 내용일 뿐이다. */
test("지도를 칠판으로 보내면 새 화이트보드에 그림으로 올라간다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    doc.mapDoc.title = "우리 동네";
    doc.mapInstance.fire("click", { latlng: { lat:37.5665, lng:126.978 } });
  });

  await page.locator(".map-to-board").click();

  // 칠판이 새로 열리고 활성 탭이 된다.
  await expect(page.locator(".wb-canvas")).toHaveCount(1, { timeout: 20_000 });
  const board = await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "board");
    if (!doc) return null;
    const items = (doc.boardState && doc.boardState.items) || [];
    return {
      name: doc.name,
      active: doc.id === activeId,
      images: items.filter(it => it.type === "image").map(it => ({
        isDataUrl: /^data:image\//.test(it.src || (it.img && it.img.src) || ""),
        w: it.w, h: it.h
      }))
    };
  });
  expect(board).not.toBeNull();
  expect(board.name).toBe("지도 – 우리 동네");
  expect(board.active).toBe(true);
  expect(board.images).toHaveLength(1);
  expect(board.images[0].isDataUrl).toBe(true);          // 바깥 주소가 아니라 그림 자체가 들어간다
  expect(board.images[0].w).toBeGreaterThan(0);

  // 지도 문서는 그대로 남아 계속 고칠 수 있다 — 캡처하려고 감췄던 칸도 원래대로 돌아온다.
  // (되돌리지 않으면 말풍선·확대 단추가 사라진 지도가 남는다.)
  const mapPanes = await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    const stage = doc.el.querySelector(".map-stage");
    return [".leaflet-control-container", ".leaflet-popup-pane", ".leaflet-tooltip-pane"]
      .map(sel => { const el = stage.querySelector(sel); return el ? el.style.display : "missing"; });
  });
  expect(mapPanes).toEqual(["", "", ""]);
  expect(await page.evaluate(() => docs.filter(d => d.kind === "map").length)).toBe(1);
  expect(errors).toEqual([]);
});

test("같은 지도를 두 번 보내면 서로 다른 칠판이 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await page.evaluate(() => { docs.find(d => d.kind === "map").mapDoc.title = "답사 경로"; });

  await page.locator(".map-to-board").click();
  await expect(page.locator(".wb-canvas")).toHaveCount(1, { timeout: 20_000 });

  // 지도 탭으로 돌아가 한 번 더 보낸다.
  await page.evaluate(() => setActiveDoc(docs.find(d => d.kind === "map").id));
  await page.locator(".map-to-board").click();
  await expect(page.locator(".wb-canvas")).toHaveCount(2, { timeout: 20_000 });

  // 이름이 겹치면 자동복원 칸을 함께 써 앞 판서를 덮어쓴다 — 번호로 갈라 놓는다.
  const names = await page.evaluate(() => docs.filter(d => d.kind === "board").map(d => d.name));
  expect(names).toEqual(["지도 – 답사 경로", "지도 – 답사 경로 2"]);
  expect(errors).toEqual([]);
});

test("배경지도를 바꿔도 찍어 둔 표시는 그대로 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => {
    newMapScratch();
  });
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    doc.mapInstance.fire("click", { latlng: { lat:37.5665, lng:126.978 } });
  });
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(0);   // 추가 모드가 아니면 안 생긴다

  await page.locator(".map-add").click();
  await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    doc.mapInstance.fire("click", { latlng: { lat:37.5665, lng:126.978 } });
  });
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

  await page.locator(".map-select").selectOption("light");
  expect((await mapModel(page)).basemap).toBe("light");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

  // 좌표로 이동은 그 자리로 지도를 옮기되 표시를 건드리지 않는다.
  await page.locator(".map-goto").fill("35.1796, 129.0756");
  await page.locator(".map-goto").press("Enter");
  const moved = await mapModel(page);
  expect(moved.center[0]).toBeCloseTo(35.1796, 2);
  expect(moved.markers).toHaveLength(1);

  expect(errors).toEqual([]);
});

/* 장소 이름 검색. 실제 조회는 인터넷과 남의 서버에 달려 있으므로 여기서는 가로채 넣는다 —
   확인할 것은 "이름을 넣으면 목록이 뜨고, 고르면 그 자리로 간다"는 화면 쪽 계약이다. */
test("장소 이름으로 찾아 목록에서 고르면 그 자리로 옮겨진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route("**/can-proxy-tiles", (route) => route.fulfill({
    status: 200, contentType: "text/plain", body: "yes"
  }));
  await page.route("**/geocode?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { display_name: "경복궁, 종로구, 서울특별시", lat: "37.5796", lon: "126.9770" },
      { display_name: "경복궁역, 종로구, 서울특별시", lat: "37.5759", lon: "126.9736" }
    ])
  }));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await page.locator(".map-goto").fill("경복궁");
  await page.locator(".map-goto").press("Enter");

  const results = page.locator(".map-result");
  await expect(results).toHaveCount(2, { timeout: 15_000 });
  await expect(results.first()).toContainText("경복궁");

  await results.first().click();
  const moved = await mapModel(page);
  expect(moved.center[0]).toBeCloseTo(37.5796, 2);
  expect(moved.center[1]).toBeCloseTo(126.977, 2);
  expect(moved.zoom).toBeGreaterThanOrEqual(15);
  await expect(page.locator(".map-result")).toHaveCount(0);   // 고르면 목록은 닫힌다

  expect(errors).toEqual([]);
});

test("찾지 못한 이름은 목록 없이 이유를 알려 준다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/can-proxy-tiles", (route) => route.fulfill({
    status: 200, contentType: "text/plain", body: "yes"
  }));
  await page.route("**/geocode?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: "[]"
  }));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await page.locator(".map-goto").fill("ㅁㄴㅇㄹ 없는 장소");
  await page.locator(".map-goto").press("Enter");

  await expect(page.locator(".map-status")).toContainText("찾지 못했어요", { timeout: 15_000 });
  await expect(page.locator(".map-result")).toHaveCount(0);
  expect(errors).toEqual([]);
});
