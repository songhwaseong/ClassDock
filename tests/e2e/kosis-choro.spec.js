const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const aged = require("../fixtures/kosis-aged-2025.json");

/* 색칠 지도 'KOSIS에서 가져오기'. 뜻풀이(지역 이름 잇기)는 tests/kosis-api.test.js 가 지킨다.
   여기서는 런처(/kosis)를 흉내 내고 화면 계약만 본다: 가져오기 → 붙여넣기 칸·제목·단위 → 칠하기.
   자료 표본은 2026-09-19 실제 '고령인구비율(시도/시/군/구)' 2025년 응답(246줄)이다. */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}
async function stubLauncher(page, options = {}){
  const asked = [];
  await page.route("**/can-proxy-kosis", (route) => options.kosis === false
    ? route.fulfill({ status:404, contentType:"text/plain", body:"Not found" })
    : route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route((url) => url.pathname === "/kosis", (route) => {
    const q = new URL(route.request().url()).searchParams;
    asked.push(Object.fromEntries(q));
    if (options.keyInvalid) return route.fulfill({ status:428, contentType:"text/plain", body:"kosis-key-invalid" });
    const json = (body) => route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify(body) });
    if (q.get("op") === "data") return json(q.get("tblId") === "DT_1YL20631" ? aged : []);
    if (q.get("op") === "search") return json([
      { ORG_ID:"101", ORG_NM:"국가데이터처", TBL_ID:"DT_1YL20631", TBL_NM:"고령인구비율(시도/시/군/구)", STRT_PRD_DE:"2000", END_PRD_DE:"2025" },
      { ORG_ID:"101", ORG_NM:"국가데이터처", TBL_ID:"DT_OTHER", TBL_NM:"전국 노인 실태", STRT_PRD_DE:"2020", END_PRD_DE:"2024" }
    ]);
    if (q.get("op") === "meta" && q.get("type") === "ITM") return json([
      { OBJ_ID:"ITEM", OBJ_NM:"항목", ITM_ID:"T10", ITM_NM:"고령인구비율＜br＞(A÷B×100)", UNIT_NM:"%" },
      { OBJ_ID:"SGG", OBJ_NM:"행정구역별", OBJ_ID_SN:"1", ITM_ID:"00", ITM_NM:"전국" },
      { OBJ_ID:"SGG", OBJ_NM:"행정구역별", OBJ_ID_SN:"1", ITM_ID:"11", ITM_NM:"서울특별시" }
    ]);
    if (q.get("op") === "meta" && q.get("type") === "PRD") return json([{ PRD_SE:"년", STRT_PRD_DE:"2000", END_PRD_DE:"2025" }]);
    return route.fulfill({ status:400, contentType:"text/plain", body:"kosis-bad-request" });
  });
  await page.route("**/tile-proxy**", (route) => route.abort());
  return asked;
}
async function openChoropleth(page){
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-choropleth").click();
  const modal = page.locator(".map-choro-modal");
  await expect(modal).toBeVisible();
  return modal;
}

test("런처가 아니면 KOSIS 단추는 보이지 않는다", async ({ page }) => {
  await stubLauncher(page, { kosis:false });
  await openApp(page);
  const modal = await openChoropleth(page);
  await expect(modal.locator(".map-choro-paste")).toBeVisible();
  await expect(modal.locator(".map-choro-kosis-open")).toBeHidden();
});

test("자주 쓰는 통계: 고령인구비율을 시군구로 가져와 모두 맞추고 칠한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked = await stubLauncher(page);
  await openApp(page);
  const modal = await openChoropleth(page);
  await modal.locator(".map-choro-level").selectOption("sgg");
  await modal.locator(".map-choro-kosis-open").click();
  const panel = modal.locator(".map-choro-kosis");
  await expect(panel).toBeVisible();
  await expect(modal.locator(".map-choro-kosis-preset option")).toHaveCount(36);
  // 고르기만 하면 바로 받는다([가져오기]는 다시 받기용).
  await modal.locator(".map-choro-kosis-preset").selectOption("aged");
  await modal.locator(".map-choro-kosis-year").selectOption("2025");

  await expect(modal.locator(".map-choro-kosis-status")).toContainText("가져왔어요");
  await expect(modal.locator(".map-choro-paste")).toHaveValue(/^지역\t고령인구비율\(65세 이상\) \(2025\)\n서울특별시 종로구\t22\.4/);
  await expect(modal.locator(".map-choro-title")).toHaveValue("고령인구비율(65세 이상) (2025)");
  await expect(modal.locator(".map-choro-unit")).toHaveValue("%");
  // 실제 응답의 시군구가 모두 맞는다(2025년 경계 — 광주·전남이 따로 있던 때).
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 228곳");
  await expect(modal.locator(".map-choro-note")).toContainText("2025년 12월 기준");
  await expect(modal.locator(".map-choro-note")).not.toContainText("이름을 못 찾음");
  expect(asked.filter(q => q.op === "data" && q.tblId === "DT_1YL20631").pop()).toMatchObject({ orgId:"101", tblId:"DT_1YL20631", itmId:"T10", objL1:"ALL", startPrdDe:"2025", endPrdDe:"2025" });
  await page.screenshot({ path:"test-results/kosis-choro-panel.png" });

  await modal.locator(".map-choro-apply").click();
  await expect(modal).toHaveCount(0);
  const model = await page.evaluate(() => JSON.parse(JSON.stringify(docs.find(d => d.kind === "map").mapDoc.choropleth)));
  expect(model.level).toBe("sgg");
  expect(Object.keys(model.values).length).toBe(228);
  expect(model.values["서울특별시|종로구"]).toBe(22.4);
  await page.screenshot({ path:"test-results/kosis-choro-map.png" });
  expect(errors).toEqual([]);
});

test("[가져오기]를 누르지 않고 바로 [칠하기]를 눌러도 받아서 칠한다", async ({ page }) => {
  await stubLauncher(page);
  await openApp(page);
  const modal = await openChoropleth(page);
  await modal.locator(".map-choro-kosis-open").click();
  // 고르자마자 곧바로 칠하기 — 받는 중이면 기다렸다가 칠한다.
  await modal.locator(".map-choro-kosis-preset").selectOption("aged");
  await modal.locator(".map-choro-apply").click();
  await expect(modal).toHaveCount(0);
  const model = await page.evaluate(() => JSON.parse(JSON.stringify(docs.find(d => d.kind === "map").mapDoc.choropleth)));
  expect(model.level).toBe("sido");
  expect(Object.keys(model.values).length).toBe(17);
  expect(model.title).toContain("고령인구비율");
});

test("기준을 바꾸면 같은 통계를 새 기준으로 다시 받는다", async ({ page }) => {
  await stubLauncher(page);
  await openApp(page);
  const modal = await openChoropleth(page);
  await modal.locator(".map-choro-kosis-open").click();
  await modal.locator(".map-choro-kosis-preset").selectOption("aged");
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 17곳");
  await modal.locator(".map-choro-level").selectOption("sgg");
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 228곳");
});

test("시도만 있는 통계는 기준을 시도로 바꾸고, 검색 길로도 표를 골라 가져온다", async ({ page }) => {
  await stubLauncher(page);
  await openApp(page);
  const modal = await openChoropleth(page);
  await modal.locator(".map-choro-kosis-open").click();

  await modal.locator(".map-choro-kosis-tab").nth(1).click();
  await modal.locator(".map-choro-kosis-q").fill("고령인구");
  await modal.locator(".map-choro-kosis-q").press("Enter");
  await expect(modal.locator(".map-choro-kosis-result")).toHaveCount(2);
  await modal.locator(".map-choro-kosis-result").first().click();
  await expect(modal.locator(".map-choro-kosis-picked")).toHaveText("고령인구비율(시도/시/군/구)");
  await modal.locator(".map-choro-kosis-table-go").click();
  // 기준이 '시도'라 시도 17곳만 들어간다. 항목 이름의 ＜br＞ 는 지워진다.
  await expect(modal.locator(".map-choro-title")).toHaveValue("고령인구비율 (A÷B×100) (2025)");
  await expect(modal.locator(".map-choro-note")).toContainText("맞춘 지역 17곳");
});

test("키 문제는 설정 연결 탭으로 안내한다", async ({ page }) => {
  await stubLauncher(page, { keyInvalid:true });
  await openApp(page);
  const modal = await openChoropleth(page);
  await modal.locator(".map-choro-kosis-open").click();
  await modal.locator(".map-choro-kosis-go").click();
  await expect(modal.locator(".map-choro-kosis-status")).toContainText("설정 → 연결");
});
