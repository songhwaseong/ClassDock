// 설정 '연결' 탭 — 인터넷 서비스 인증키(지도 검색·환율·지하철·공공데이터포털)를 한 줄씩 접어 둔다.
const { test, expect } = require("@playwright/test");

test("연결 탭은 서비스를 접힌 한 줄로 보여 주고 배지로 키 상태를 알린다", async ({ page }) => {
  // 런처가 없는 정적 서버라 지하철만 키가 있는 것처럼 답해 두 상태(등록됨 / EXE에서만)를 함께 본다.
  await page.route("**/subway-key-status", (route) => route.fulfill({
    status:200, contentType:"application/json",
    body:JSON.stringify({ hasKey:true, remembered:true, persistentSupported:true })
  }));
  await page.addInitScript(() => { try { localStorage.setItem("uiLang", "ko"); } catch(_){} });
  await page.goto("/");
  await page.locator("#settingsOpen").click();

  // 일반 탭에는 더 이상 키 입력칸이 없다.
  const general = page.locator('[data-settings-panel="general"]');
  await expect(general).toBeVisible();
  await expect(general.locator("input[type=password]")).toHaveCount(0);

  await page.locator('[data-settings-tab="connect"]').click();
  const panel = page.locator('[data-settings-panel="connect"]');
  await expect(panel).toBeVisible();
  const items = panel.locator("details.conn-item");
  await expect(items).toHaveCount(4);
  await expect(panel.locator("details.conn-item[open]")).toHaveCount(0);
  await expect(page.locator("#settingSubwayKey")).toBeHidden();

  await expect(page.locator("#settingSubwayBadge")).toHaveText("키 등록됨");
  await expect(page.locator("#settingSubwayBadge")).toHaveAttribute("data-kind", "ok");
  await expect(page.locator("#settingTagoBadge")).toHaveText("EXE에서만");
  await expect(items.filter({ has:page.locator("#settingTagoKey") }).locator(".conn-name")).toHaveText("공공데이터포털");
  await expect(page.locator("#settingMapSearchBadge")).toHaveText("OpenStreetMap");

  // 펼치면 입력칸이 보이고, 다른 줄을 펼치면 앞 줄은 닫힌다(한 번에 하나).
  await items.filter({ has:page.locator("#settingSubwayKey") }).locator("summary").click();
  await expect(page.locator("#settingSubwayKey")).toBeVisible();
  await items.filter({ has:page.locator("#settingMapSearchProvider") }).locator("summary").click();
  await expect(page.locator("#settingSubwayKey")).toBeHidden();

  // 카카오를 고르면 키 칸이 나오고 배지도 따라 바뀐다.
  await page.locator("#settingMapSearchProvider").selectOption("kakao");
  await expect(page.locator("#settingMapSearchKey")).toBeVisible();
  await expect(page.locator("#settingMapSearchBadge")).toHaveText("EXE에서만");
});

test("영어 화면에서는 환율·지하철 키 상태 문구도 영어로 나온다", async ({ page }) => {
  await page.route("**/subway-key-status", (route) => route.fulfill({
    status:200, contentType:"application/json",
    body:JSON.stringify({ hasKey:true, remembered:true, persistentSupported:true })
  }));
  await page.addInitScript(() => { try { localStorage.setItem("uiLang", "en"); } catch(_){} });
  await page.goto("/");
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="connect"]').click();
  await expect(page.locator("#settingExchangeRateStatus")).toHaveText("Exchange rate key settings are available in ClassDock.exe.");
  await expect(page.locator("#settingSubwayStatus")).toHaveText("The subway key is stored encrypted for this Windows user.");
  await expect(page.locator("#settingTagoStatus")).toHaveText("Data.go.kr key settings are available in ClassDock.exe.");
});
