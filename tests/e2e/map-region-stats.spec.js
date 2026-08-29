const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 카카오 확장 기능(주소 자동 채우기·주변 시설·지역 통계)의 화면 쪽 계약.
   실제 검색은 인터넷과 REST 키가 있어야 하므로 여기서는 부르지 않는다 — 대신 표시에 지역을
   직접 넣어 두고, 세는 것부터 칠판 차트까지가 한 흐름으로 이어지는지 본다. */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// 지역이 붙은 표시 몇 개를 지도에 직접 심는다(검색 없이 세는 부분만 보기 위해).
const seedMarkers = (page) => page.evaluate(() => {
  const doc = docs.find(d => d.kind === "map");
  doc.mapDoc.title = "우리 지역";
  for (const [region, district] of [["경기도","수원시"], ["경기도","수원시"], ["경기도","성남시"], ["서울특별시","중구"]]){
    doc.mapDoc.markers.push(mapNormalizeMarker({ lat:37.5, lng:127.0, label:district + " 자리", region, district }));
  }
});

test("지역 통계는 지역별 개수를 세어 칠판 차트로 보낸다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await seedMarkers(page);

  await page.locator(".map-region-stats").click();
  await expect(page.locator(".map-region-modal")).toBeVisible();

  // 많은 곳부터 센다(수원시 2 · 성남시 1 · 중구 1).
  const byDistrict = await page.locator(".map-region-item").allTextContents();
  expect(byDistrict[0]).toContain("수원시");
  expect(byDistrict[0]).toContain("2");
  expect(byDistrict).toHaveLength(3);
  await expect(page.locator(".map-region-note")).toContainText("지역 없음 0개");
  // 지역이 다 채워져 있으면 '지역 채우기'는 부를 일이 없다.
  await expect(page.locator(".map-region-fill")).toBeDisabled();

  // 기준을 시도로 바꾸면 경기도 3 · 서울특별시 1 두 줄이 된다.
  await page.locator(".map-region-level").selectOption("region");
  const byRegion = await page.locator(".map-region-item").allTextContents();
  expect(byRegion).toHaveLength(2);
  expect(byRegion[0]).toContain("경기도");
  expect(byRegion[0]).toContain("3");

  await page.locator(".map-region-chart").click();

  // 칠판이 새로 열리고, 그림이 아니라 다시 고칠 수 있는 자료 차트 그룹이 들어간다.
  await expect(page.locator(".wb-canvas")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator(".map-region-modal")).toHaveCount(0);
  const board = await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "board");
    if (!doc) return null;
    const items = (doc.boardState && doc.boardState.items) || [];
    const chart = items.find(item => item.role === "education-chart");
    return {
      name: doc.name,
      active: doc.id === activeId,
      images: items.filter(item => item.type === "image").length,
      chart: chart ? { type:chart.chartSpec.type, title:chart.chartSpec.title,
        rows:chart.chartSpec.rows.map(row => [row.label, row.values[0]]) } : null
    };
  });
  expect(board).not.toBeNull();
  expect(board.name).toBe("지역 통계 – 우리 지역");
  expect(board.active).toBe(true);
  expect(board.images).toBe(0);
  expect(board.chart).not.toBeNull();
  expect(board.chart.type).toBe("bar");
  expect(board.chart.title).toBe("우리 지역 · 시도별 표시 수");
  expect(board.chart.rows).toEqual([["경기도", 3], ["서울특별시", 1]]);
  expect(errors).toEqual([]);
});

/* 카카오에만 있는 기능은 폴백이 없다. 그렇다고 감추지는 않는다 — 감추면 이런 기능이 있다는
   것조차 모르고 지나가기 때문이다. 대신 흐리게(is-unavailable) 두고, 눌러 보면 무엇이 모자란지
   알려 준다. 갖춰야 할 것은 셋이다: 공급자=카카오 · 런처 · REST 키. */
test("주변 시설 버튼은 카카오 검색이 갖춰지기 전에는 흐리고, 눌러 보면 까닭을 알려 준다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  const nearby = page.locator(".map-nearby");
  await expect(nearby).toBeVisible();
  await expect(nearby).toHaveClass(/is-unavailable/);

  // 눌러도 찾기 창은 열리지 않고, 무엇을 갖춰야 하는지 알려 준다.
  await nearby.click();
  await expect(page.locator("#toast")).toContainText("카카오");
  await expect(page.locator(".map-nearby-modal")).toHaveCount(0);

  /* 공급자를 카카오로 바꾸고 런처가 키를 들고 있다고 알리면(설정 창이 쓰는 그 이벤트) 열어 둔
     지도의 버튼도 그 자리에서 밝아진다 — 지도를 다시 열 필요가 없다. */
  await page.evaluate(() => {
    saveAppSettings({ mapSearchProvider:"kakao" });
    window.__classDockMapSearchKeyStatus = { available:true, hasKey:true };
    window.dispatchEvent(new CustomEvent("classdock-map-search-status-change"));
  });
  await expect(nearby).not.toHaveClass(/is-unavailable/);
});

/* 주소 자동 채우기는 사람마다의 습관이라 .map 파일이 아니라 이 브라우저에 남는다. */
test("주소 자동 채우기 상태는 지도를 다시 열어도 이어진다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  const toggle = page.locator(".map-auto-address");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("mn.mapAutoAddress"))).toBe("1");
  // 켜 두어도 문서 자체는 고쳐지지 않는다(저장 안 됨 ● 이 켜지면 안 된다).
  expect(await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "map");
    return mapDocContentKey(doc.mapDoc) === doc.savedContentKey;
  })).toBe(true);

  await page.evaluate(() => { closeDoc(docs.find(d => d.kind === "map").id); newMapScratch(); });
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await expect(page.locator(".map-auto-address")).toHaveAttribute("aria-pressed", "true");
});
