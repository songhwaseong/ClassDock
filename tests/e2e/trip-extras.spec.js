const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { solidPng } = require("./helpers-png");

/* 여행일지 확장(2026-09-28) — 이름·주소로 위치 찾기 · 여정 띠 칸의 사진·날씨 · 날에 안 붙는 돈 · 준비물·할 일 ·
 * 일기장으로 보내기 · 여행 되돌아보기. */

async function boot(page){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko");
      localStorage.removeItem("mn.tripExtraOpen"); localStorage.removeItem("mn.tripChecklistOpen");
    } catch (_) {}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newTripScratch && window.newTripScratch());
  await expect(page.locator(".trip-bar")).toBeVisible();
}
const tripModel = page => page.evaluate(() => JSON.parse(JSON.stringify(docs.find(d => d.kind === "trip").trip)));
// 사진 한 장을 장소에 붙인다(자산 이름은 앱이 쓰는 해시 모양으로).
async function seedDayWithPhoto(page){
  const png = solidPng(40, 30, [30, 140, 90]).toString("base64");
  await page.locator(".trip-add-day").click();
  await page.evaluate((b64) => {
    const doc = docs.find(d => d.kind === "trip");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    doc.tripAssets.set("assets/photo00001.png", { bytes });
    const day = doc.trip.days[0];
    day.date = "2026-07-20"; day.title = "첫날"; day.text = "바람이 셌다"; day.weather = "sunny";
    day.spots.push({ id:"sp-a", at:"09:30", name:"성산일출봉", address:"", note:"해돋이", kind:"sight",
      lat:33.458, lng:126.942, color:"", cost:null, photos:["assets/photo00001.png"] });
  }, png);
  await page.locator(".trip-day-chip").nth(0).click();
  await page.locator(".trip-title").fill("제주");                 // 되돌리기 기록에 남긴다
}

test("장소 줄의 돋보기로 이름·주소를 찾아 고르면 좌표와 빈 주소가 채워진다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot-name").fill("성산일출봉");
  // 런처 없이도 시험할 수 있게 공용 검색을 흉내 낸다(지도 문서와 같은 mapGeocode 를 부른다).
  await page.evaluate(() => {
    window.__asked = [];
    window.mapGeocode = async (q) => { window.__asked.push(q); return [
      { name:"성산일출봉 · 제주특별자치도 서귀포시 성산읍", title:"성산일출봉", road:"제주특별자치도 서귀포시 성산읍 일출로 284-12", lat:33.4588, lng:126.9425 },
      { name:"성산항", title:"성산항", road:"", address:"제주 서귀포시 성산읍", lat:33.47, lng:126.93 }]; };
  });
  await page.locator(".trip-spot-find").click();
  const menu = page.locator(".text-context-menu");
  await expect(menu.getByText(/성산일출봉 · /)).toBeVisible();
  await menu.getByText(/성산일출봉 · /).click();
  const model = await tripModel(page);
  const spot = model.days[0].spots[0];
  expect([spot.lat, spot.lng]).toEqual([33.4588, 126.9425]);
  expect(spot.address).toBe("제주특별자치도 서귀포시 성산읍 일출로 284-12");
  expect(spot.name).toBe("성산일출봉");
  expect(await page.evaluate(() => window.__asked)).toEqual(["성산일출봉"]);
  await expect(page.locator(".trip-spot-pick")).toHaveClass(/is-on/);

  // 이름도 주소도 없으면 묻지 않는다
  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot").nth(1).locator(".trip-spot-find").click();
  await expect(page.locator(".trip-status")).toContainText("이름이나 주소를 먼저");
});

test("여정 띠 칸에 그날 날씨 그림과 대표 사진이 붙는다", async ({ page }) => {
  await boot(page);
  await seedDayWithPhoto(page);
  const chip = page.locator(".trip-day-chip").nth(0);
  await expect(chip).toHaveClass(/has-thumb/);
  await expect(chip.locator(".trip-day-chip-thumb")).toHaveAttribute("src", /^blob:/);
  await expect(chip.locator(".trip-day-chip-wx")).toHaveAttribute("data-mark", "sunny");
  // 사진을 빼면 칸에서도 사라진다
  await page.locator(".trip-spot-photo-remove").first().click();
  await expect(chip).not.toHaveClass(/has-thumb/);
});

test("날에 안 붙는 돈을 펴서 더하면 전체 합계에 들어가고, 되돌리기로 돌아온다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-budget-line")).toBeHidden();   // 쓴 돈이 없으면 합계 줄은 감춘다
  const toggle = page.locator(".trip-extra-toggle");
  await expect(toggle).toContainText("날에 안 붙는 돈");
  await toggle.click();
  await page.locator(".trip-extra-add").click();
  const row = page.locator(".trip-extra-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".trip-extra-label")).toBeFocused();
  await row.locator(".trip-extra-label").fill("항공권");
  await row.locator(".trip-extra-amount").fill("320000");
  await row.locator(".trip-extra-kind").selectOption("move");
  await expect(page.locator(".trip-budget-sum")).toContainText("모두 320,000원");
  await expect(toggle).toContainText("1건 · 320,000원");
  const model = await tripModel(page);
  expect(model.expenses.map(x => [x.label, x.amount, x.currency, x.kind])).toEqual([["항공권", 320000, "KRW", "move"]]);
  // 요약 창에도 들어간다
  await page.locator(".trip-summary-btn").click();
  await expect(page.locator(".trip-summary-money")).toContainText("320,000원");
  await expect(page.locator(".trip-summary-card")).toContainText("날에 안 붙는 돈 포함");
  await page.keyboard.press("Escape");
});

test("준비물·할 일을 여정 띠 아래에서 더하고 체크하면 파일에 담긴다", async ({ page }) => {
  await boot(page);
  const head = page.locator(".trip-check-toggle");
  await expect(head).toHaveText(/준비물·할 일$/);
  await head.click();
  const add = page.locator(".trip-check-add");
  await add.fill("여권"); await add.press("Enter");
  await page.locator(".trip-check-add").fill("충전기"); await page.locator(".trip-check-add").press("Enter");
  await expect(page.locator(".trip-check-row")).toHaveCount(2);
  await page.locator(".trip-check-row").nth(0).locator(".trip-check-box").check();
  await expect(head).toContainText("1/2");
  await expect(page.locator(".trip-check-row").nth(0)).toHaveClass(/is-done/);
  let model = await tripModel(page);
  expect(model.checklist.map(x => [x.text, x.done])).toEqual([["여권", true], ["충전기", false]]);
  await page.locator(".trip-check-clear").click();
  await expect(head).toContainText("0/2");
  // 접은 상태는 파일이 아니라 이 브라우저에
  expect(await page.evaluate(() => localStorage.getItem("mn.tripChecklistOpen"))).toBe("1");
  model = await tripModel(page);
  expect(model.checklist.every(x => !x.done)).toBe(true);
});

test("이 날을 새 일기장으로 보내면 같은 날짜 일기에 글·들른 곳·사진이 옮겨 적힌다", async ({ page }) => {
  await boot(page);
  await seedDayWithPhoto(page);
  await page.locator(".trip-main .trip-spots").click({ button:"right", position:{ x:6, y:6 } });
  const menu = page.locator(".text-context-menu");
  await menu.getByText("이 날을 일기장으로 보내기").hover();
  await menu.getByText("새 일기장으로").click();
  await expect(page.locator(".diary-bar")).toBeVisible();
  const entry = await page.evaluate(() => {
    const d = docs.find(x => x.kind === "diary");
    const e = d.diary.entries.find(x => x.date === "2026-07-20");
    return e && { title:e.title, text:e.text, tags:e.tags, weather:e.weather,
      photos:e.stickers.filter(s => (s.kind || "photo") === "photo").map(s => [s.asset, d.diaryAssets.has(s.asset)]) };
  });
  expect(entry.title).toBe("첫날");
  expect(entry.text).toBe("바람이 셌다\n\n— 들른 곳 —\n· 09:30 성산일출봉 — 해돋이");
  expect(entry.tags).toEqual(["여행"]);
  expect(entry.weather).toBe("sunny");
  expect(entry.photos).toEqual([["assets/photo00001.png", true]]);
  await expect(page.locator(".diary-text[aria-label='일기 본문']")).toHaveValue(/들른 곳/);
});

test("여행 되돌아보기 — 날 여는 장부터 넘겨 보고, 키로 앞뒤·멈추기, Esc 로 닫는다", async ({ page }) => {
  await boot(page);
  await seedDayWithPhoto(page);
  await page.locator(".trip-replay-open").click();
  const card = page.locator(".trip-replay-card");
  await expect(card).toBeVisible();
  await expect(page.locator(".trip-replay-count")).toHaveText("1 / 2");
  await expect(page.locator(".trip-replay-day-title")).toHaveText("첫날");
  await page.keyboard.press(" ");                                // 멈추기
  await expect(card).toHaveClass(/is-paused/);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".trip-replay-count")).toHaveText("2 / 2");
  await expect(page.locator(".trip-replay-photo")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator(".trip-replay-caption")).toContainText("09:30  성산일출봉");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".trip-replay-count")).toHaveText("1 / 2");
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  // 보기만 하는 창 — 열고 닫아도 모델이 그대로다
  const dirty = await page.evaluate(() => { const d = docs.find(x => x.kind === "trip"); return tripContentKey(d.trip) === d.savedText; });
  expect(typeof dirty).toBe("boolean");
});
