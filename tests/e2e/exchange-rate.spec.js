const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 환율 창
 *
 * 환율 해석 규칙 자체는 tests/exchange-rate.test.js 가 지킨다. 여기서 지키는 것은 화면 쪽 계약이다.
 *   - 런처 없이 열면 조회를 막고 이유를 밝히는가
 *   - 받아 온 값이 표·계산기로 이어지는가(고시 단위 100인 통화 포함)
 *   - 추이가 실제로 칠판 그래프가 되는가
 *
 * e2e 정적 서버에는 /exchange-rate 가 없다 — 런처가 하는 일이라, 여기서는 그 응답을
 * 진짜 API 가 주는 모양 그대로 흉내 내어 화면만 검사한다.
 */

const KOREAEXIM_BODY = JSON.stringify([
  { result:1, cur_unit:"JPY(100)", cur_nm:"일본 옌(100)", ttb:"940.6", tts:"959.6", deal_bas_r:"950.12" },
  { result:1, cur_unit:"USD", cur_nm:"미국 달러", ttb:"1,370.9", tts:"1,397.5", deal_bas_r:"1,384.2" }
]);
const ECB_BODY = JSON.stringify({
  amount:1.0, base:"EUR", date:"2026-08-21", rates:{ JPY:185.66, KRW:1619.41, USD:1.1699 }
});

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
}

/* 런처 흉내 — 인증키가 있다고 답하고, 출처에 맞는 본문을 돌려준다.
   options.rates 가 false 면 프록시 능력 자체가 없는(= 런처 아닌) 환경이 된다. */
async function stubLauncher(page, options = {}){
  const hasRates = options.rates !== false;
  await page.route("**/can-proxy-rates", (route) =>
    hasRates ? route.fulfill({ status:200, contentType:"text/plain", body:"yes" })
             : route.fulfill({ status:404, contentType:"text/plain", body:"Not found" }));
  await page.route("**/exchange-rate-key-status", (route) => route.fulfill({
    status:200, contentType:"application/json",
    body:JSON.stringify({ hasKey:options.hasKey !== false, remembered:true, persistentSupported:true })
  }));
  await page.route("**/exchange-rate?**", (route) => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source === "koreaexim") return route.fulfill({ status:200, contentType:"application/json", body:KOREAEXIM_BODY });
    if (source === "ecb") return route.fulfill({ status:200, contentType:"application/json", body:ECB_BODY });
    return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({
      base:"EUR", rates:{ "2026-08-20":{ KRW:1631.08, USD:1.1681 }, "2026-08-21":{ KRW:1619.41, USD:1.1699 } }
    }) });
  });
}

const modal = (page) => page.locator(".exchange-rate-modal");
const status = (page) => page.locator(".exchange-rate-status");
const rows = (page) => page.locator(".exchange-rate-table tbody tr");

async function openRates(page){
  await page.evaluate(() => window.openExchangeRate());
  await expect(modal(page)).toBeVisible();
}

test("런처로 열지 않았으면 조회를 막고 이유를 밝힌다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page, { rates:false });
  await page.goto("/");
  await openRates(page);
  await expect(status(page)).toContainText("ClassDock");
  // 조회할 수 없는 상태에서는 출처·기준일도 만지지 못하게 한다.
  await expect(page.locator(".exchange-rate-head select")).toBeDisabled();
});

test("고시환율을 표로 보여 주고 100단위 통화도 바르게 계산한다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page);
  await page.goto("/");
  await openRates(page);

  await expect(status(page)).toContainText("수출입은행 고시환율");
  await expect(rows(page)).toHaveCount(2);
  // 송금 보낼 때·받을 때는 이 출처에만 있는 칸이다.
  await expect(page.locator(".exchange-rate-table thead th")).toHaveCount(5);
  await expect(page.locator(".exchange-rate-table thead th").nth(2)).toHaveText("매매기준율");

  // 표에서 엔을 고르면 계산기·추이에 함께 걸린다.
  await rows(page).filter({ hasText:"JPY" }).click();
  await page.locator(".exchange-rate-amount").fill("100");
  // 100엔 고시값(950.12원)이 그대로 나와야 한다 — 1엔당으로 접었다 펴며 어긋나면 안 된다.
  await expect(page.locator(".exchange-rate-out")).toHaveText("950.12");

  // ⇄ 로 방향을 뒤집으면 고른 통화 칸이 오른쪽으로 옮겨 간다.
  await page.locator(".exchange-rate-swap").click();
  await expect(page.locator(".exchange-rate-slot").nth(1).locator("select")).toHaveCount(1);
  await page.locator(".exchange-rate-amount").fill("950.12");
  await expect(page.locator(".exchange-rate-out")).toHaveText("100.000");
});

test("이름·코드로 통화를 거른다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page);
  await page.goto("/");
  await openRates(page);
  await expect(rows(page)).toHaveCount(2);
  await page.locator(".exchange-rate-filter").fill("달러");
  await expect(rows(page)).toHaveCount(1);
  await page.locator(".exchange-rate-filter").fill("없는통화");
  await expect(page.locator(".exchange-rate-empty")).toBeVisible();
});

test("인증키가 없으면 키 없이 되는 ECB 로 연다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page, { hasKey:false });
  await page.goto("/");
  await openRates(page);
  await expect(status(page)).toContainText("ECB 참고환율");
  // 송금 칸이 없는 출처라 머리글이 세 칸이고, 기준율 칸 이름도 "참고환율"이다.
  await expect(page.locator(".exchange-rate-table thead th")).toHaveCount(3);
  await expect(page.locator(".exchange-rate-table thead th").nth(2)).toHaveText("참고환율");
});

/* 칠판 쪽 입구(💱) — 팔레트가 새 칠판을 만드는 것과 달리 지금 서 있는 보드에 넣는다.
   런처 능력이 없으면 버튼 자체가 없어야 한다(눌러도 "런처로 열어야 해요"만 뜨는 버튼은 없느니만 못하다). */
test("런처가 환율을 못 받으면 칠판 💱 버튼이 아예 없다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page, { rates:false });
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-tools")).toBeVisible();
  await expect(page.locator(".wb-rate")).toBeHidden();
});

test("칠판 💱 는 새 칠판을 만들지 않고 이 보드에 표와 그래프를 넣는다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page, { hasKey:false });
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-rate")).toBeVisible();

  const boardCount = () => page.evaluate(() => {
    const all = (typeof docs === "undefined") ? [] : docs;
    return all.filter(d => d.kind === "board").length;
  });
  expect(await boardCount()).toBe(1);

  await page.locator(".wb-rate").click();
  await expect(modal(page)).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  // 보드에 넣기 모드에서만 나오는 버튼이고, 추이 버튼도 "그래프 넣기"로 바뀐다.
  await expect(page.locator(".exchange-rate-modal .modal-actions .btn.primary")).toHaveText("표 넣기");
  await expect(page.locator(".exchange-rate-series .btn")).toHaveText("그래프 넣기");

  // 내보내기는 보이는 대로 — 거른 뒤 넣으면 거른 것만 들어간다(29종을 통째로 올리면 못 읽는다).
  await page.locator(".exchange-rate-filter").fill("달러");
  await expect(rows(page)).toHaveCount(1);
  await page.locator(".exchange-rate-modal .modal-actions .btn.primary").click();
  await expect(modal(page)).toHaveCount(0);

  const cells = await page.evaluate(() => {
    const all = (typeof docs === "undefined") ? [] : docs;
    const doc = all.find(d => d.kind === "board" && d.boardState);
    const table = doc.boardState.items.find(i => i.role === "education-table");
    return table.items.filter(i => i.type === "text").map(i => i.text);
  });
  expect(cells).toContain("USD");
  expect(cells).not.toContain("JPY");

  const placed = await page.evaluate(() => {
    const all = (typeof docs === "undefined") ? [] : docs;
    const doc = all.find(d => d.kind === "board" && d.boardState);
    return {
      boards: all.filter(d => d.kind === "board").length,
      tables: doc.boardState.items.filter(i => i.role === "education-table").length
    };
  });
  expect(placed).toEqual({ boards:1, tables:1 });     // 새 칠판을 만들지 않았다

  // 같은 보드에 추이 그래프까지 이어서 넣는다.
  await page.locator(".wb-rate").click();
  await expect(rows(page).first()).toBeVisible();
  await page.locator(".exchange-rate-series select").first().selectOption("USD");
  await page.locator(".exchange-rate-series .btn").click();
  await expect(modal(page)).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const all = (typeof docs === "undefined") ? [] : docs;
    const doc = all.find(d => d.kind === "board" && d.boardState);
    return doc.boardState.items.filter(i => i.role === "education-chart").length;
  }), { timeout:15_000 }).toBe(1);
  expect(await boardCount()).toBe(1);
});

test("추이는 새 칠판의 선그래프가 된다", async ({ page }) => {
  await boot(page);
  await stubLauncher(page, { hasKey:false });     // 기간 조회가 한 번에 되는 ECB 로
  await page.goto("/");
  await openRates(page);
  await expect(rows(page).first()).toBeVisible();

  await page.locator(".exchange-rate-series select").first().selectOption("USD");
  await page.locator(".exchange-rate-series .btn").click();

  // 칠판이 열리고 그래프 묶음이 실제로 놓였는지는 문서 상태로 확인한다.
  // docs 는 전역 let 이라 window 의 속성이 아니다 — 이름 그대로 읽어야 한다.
  await expect(modal(page)).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const all = (typeof docs === "undefined") ? [] : docs;
    const doc = all.find(d => d.kind === "board" && d.boardState);
    if (!doc) return null;
    return doc.boardState.items.filter(item => item.role === "education-chart").length;
  }), { timeout:15_000 }).toBe(1);
});
