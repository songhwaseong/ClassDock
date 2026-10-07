const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 여행일지 시안 B. 여기서만 확인할 수 있는 것 — 여정이 도구막대 아래 가로 날 띠로 실제로 옆으로
   늘어서는지, 찾기가 돋보기 창에서 되는지, 장소 줄 왼쪽 핀 번호가 지도 핀 번호와 같은지(위치 없는
   장소는 번호 없이 빈 점), 줄 접기·펼치기, 준비물이 장소 목록 아래 돈 칸 옆으로 갔는지. */

async function boot(page){
  await page.setViewportSize({ width:1400, height:900 });
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newTripScratch && window.newTripScratch());
  await expect(page.locator(".trip-bar")).toBeVisible();
}

async function addSpot(page, name){
  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot-name").last().fill(name);
}

test("여정은 도구막대 아래 가로 날 띠로 늘어서고, 도구는 그림만 보인다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  for (let at = 0; at < 3; at++) await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-day-chip")).toHaveCount(3);

  // 날 띠는 본문(.trip-body) 밖, 도구막대와 본문 사이에 있다
  expect(await page.locator(".trip-body .trip-rail").count()).toBe(0);
  const [barBox, stripBox, mainBox] = await Promise.all([".trip-bar", ".trip-days", ".trip-main"].map((sel) => page.locator(sel).boundingBox()));
  expect(stripBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  expect(mainBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height - 1);
  // 날 카드는 같은 줄에서 오른쪽으로 늘어선다
  const chips = await page.locator(".trip-day-chip").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  for (let at = 1; at < chips.length; at++){
    expect(Math.abs(chips[at].y - chips[0].y)).toBeLessThan(2);
    expect(chips[at].x).toBeGreaterThan(chips[at - 1].x);
  }
  // 되돌아보기·요약도 날 띠 끝에 있다
  await expect(page.locator(".trip-days .trip-replay-open")).toBeVisible();
  await expect(page.locator(".trip-days .trip-summary-btn")).toBeVisible();

  // 도구는 그림만 — 이름 칸은 남아 있지만 감춰져 있다
  await expect(page.locator(".trip-undo-btn svg.ui-icon")).toBeVisible();
  await expect(page.locator(".trip-undo-btn .trip-tool-label")).toBeHidden();
  // 도구막대가 한 줄이다(그림 단추 높이 차이만 난다)
  const spread = await page.locator(".trip-bar-actions").evaluate((el) => {
    const tops = [...el.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().top);
    return Math.max(...tops) - Math.min(...tops);
  });
  expect(spread).toBeLessThan(6);
  expect(errors).toEqual([]);
});

test("찾기는 도구막대 돋보기 창에서 하고, 결과를 누르면 그 날로 가며 창이 닫힌다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await addSpot(page, "성산일출봉");
  await page.locator(".trip-add-day").click();
  await expect(page.locator(".trip-day-chip").nth(1)).toHaveClass(/is-on/);

  const pop = page.locator(".trip-search-pop");
  await expect(pop).toBeHidden();
  await page.locator(".trip-search-btn").click();
  await expect(pop).toBeVisible();
  await expect(page.locator(".trip-search-input")).toBeFocused();
  await page.locator(".trip-search-input").fill("성산");
  await expect(page.locator(".trip-search-result")).toHaveCount(1);
  // 찾는 동안에도 날 띠는 그대로 보인다(예전에는 여정 칸이 결과로 바뀌었다)
  await expect(page.locator(".trip-day-chip")).toHaveCount(2);

  await page.locator(".trip-search-result").click();
  await expect(pop).toBeHidden();
  await expect(page.locator(".trip-day-chip").nth(0)).toHaveClass(/is-on/);
  await expect(page.locator(".trip-spot-name")).toHaveValue("성산일출봉");

  // Esc: 글자가 있으면 지우고, 빈 칸에서 한 번 더 누르면 닫는다
  await page.locator(".trip-search-btn").click();
  await expect(page.locator(".trip-search-input")).toHaveValue("성산");
  await page.locator(".trip-search-input").press("Escape");
  await expect(page.locator(".trip-search-input")).toHaveValue("");
  await expect(pop).toBeVisible();
  await page.locator(".trip-search-input").press("Escape");
  await expect(pop).toBeHidden();
});

test("장소는 세로 타임라인 — 핀 번호는 지도와 같고, 줄을 접으면 이름·시각·메모만 남는다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await addSpot(page, "성산일출봉");
  await addSpot(page, "섭지코지");

  // 새로 넣은 줄은 펼쳐져 있다(이름을 채운 뒤에도)
  const rows = page.locator(".trip-spot");
  await expect(rows.nth(0)).toHaveClass(/is-open/);
  await expect(rows.nth(0).locator(".trip-spot-kind")).toBeVisible();

  // 위치가 없으면 번호 없는 빈 점
  await expect(rows.nth(0).locator(".trip-spot-pin")).toHaveClass(/is-unplaced/);
  await expect(rows.nth(0).locator(".trip-spot-pin")).toHaveText("");

  // 둘째 장소만 지도에 찍으면 그 장소가 지도 1번 핀이고, 타임라인도 1번이다
  await rows.nth(1).locator(".trip-spot-pick").click();
  const stage = page.locator(".trip-map-stage");
  await expect(stage).toHaveClass(/is-picking/);
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(stage).not.toHaveClass(/is-picking/);
  await expect(page.locator(".trip-map-pin-num")).toHaveText(["1"]);
  await expect(rows.nth(1).locator(".trip-spot-pin")).toHaveText("1");
  await expect(rows.nth(1).locator(".trip-spot-pin")).not.toHaveClass(/is-unplaced/);
  await expect(rows.nth(0).locator(".trip-spot-pin")).toHaveClass(/is-unplaced/);

  // 접기 — 종류·주소·자리 찍기·빼기가 감춰지고 이름·시각·메모는 남는다. 쓴 돈이 비었으면 돈 칸도 감춘다
  const first = rows.nth(0);
  await first.locator(".trip-spot-more").click();
  await expect(first).not.toHaveClass(/is-open/);
  await expect(first.locator(".trip-spot-more")).toHaveAttribute("aria-expanded", "false");
  for (const sel of [".trip-spot-kind", ".trip-spot-addr", ".trip-spot-pick", ".trip-spot-remove", ".trip-spot-cost"]){
    await expect(first.locator(sel)).toBeHidden();
  }
  for (const sel of [".trip-spot-name", ".trip-spot-at", ".trip-spot-note", ".trip-spot-grip"]){
    await expect(first.locator(sel)).toBeVisible();
  }
  // 다시 그려도(다른 날에 갔다 와도) 접은 채다
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-day-chip").nth(0).click();
  await expect(page.locator(".trip-spot").nth(0)).not.toHaveClass(/is-open/);
  // 펼치기
  await page.locator(".trip-spot").nth(0).locator(".trip-spot-more").click();
  await expect(page.locator(".trip-spot").nth(0).locator(".trip-spot-kind")).toBeVisible();
});

test("접은 줄도 쓴 돈이 있으면 돈을 보여 주고, 준비물은 장소 목록 아래 돈 칸 옆에 있다", async ({ page }) => {
  await boot(page);
  await page.locator(".trip-add-day").click();
  await addSpot(page, "해녀의 부엌");
  const row = page.locator(".trip-spot").first();
  await row.locator(".trip-spot-cost").fill("48000");
  await row.locator(".trip-spot-more").click();
  await expect(row).not.toHaveClass(/is-open/);
  await expect(row.locator(".trip-spot-cost")).toBeVisible();

  const foot = page.locator(".trip-spots .trip-spots-foot");
  await expect(foot.locator(".trip-budget")).toBeVisible();
  await expect(foot.locator(".trip-checklist")).toBeVisible();
  const [budget, check] = await Promise.all([foot.locator(".trip-budget").boundingBox(), foot.locator(".trip-checklist").boundingBox()]);
  // 들른 곳 칸(40%)은 좁아 돈 아래에 준비물이 쌓인다
  expect(check.y).toBeGreaterThan(budget.y + budget.height - 2);
});

const boxOf = (page, sel) => page.locator(sel).first().boundingBox();

test("글쓰기 칸이 넓으면 종이 60% | 들른 곳 40% 로 나란히 서고, 들른 곳은 종이를 내려도 옆에 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.locator(".trip-add-day").click();
  await addSpot(page, "성산일출봉");
  // 종이를 길게 만든다
  await page.locator(".diary-text").fill(Array.from({ length:80 }, (_, i) => (i + 1) + "줄째 이야기").join("\n"));

  await page.locator(".trip-main").evaluate((el) => { el.scrollTop = 0; });   // 글을 채우면 커서 따라 내려가 있다
  const [paper, spots, map] = await Promise.all([boxOf(page, ".trip-write > .diary-paper"), boxOf(page, ".trip-write > .trip-spots"), boxOf(page, ".trip-map-pane")]);
  expect(spots.x).toBeGreaterThan(paper.x + paper.width - 1);      // 종이 오른쪽
  expect(map.x).toBeGreaterThan(spots.x + spots.width - 1);        // 그 오른쪽이 지도
  expect(Math.abs(spots.y - paper.y)).toBeLessThan(4);             // 같은 높이에서 시작
  const ratio = paper.width / (paper.width + spots.width);
  expect(ratio).toBeGreaterThan(0.56); expect(ratio).toBeLessThan(0.64);

  // 글쓰기 칸을 끝까지 내려도 들른 곳 칸은 화면 안에 붙어 있다
  await page.locator(".trip-main").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const [main, after] = await Promise.all([boxOf(page, ".trip-main"), boxOf(page, ".trip-write > .trip-spots")]);
  expect(after.y).toBeGreaterThanOrEqual(main.y - 1);
  expect(after.y + after.height).toBeLessThanOrEqual(main.y + main.height + 1);
  await expect(page.locator(".trip-spot-name")).toBeInViewport();
  expect(errors).toEqual([]);
});

test("지도 칸을 넓혀 글쓰기 칸이 좁아지면 예전처럼 종이 아래로 쌓이고, 종이는 새 폭으로 다시 배치된다", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("mn.tripMapWidth", "240"); } catch (_) {} });
  await boot(page);
  await page.locator(".trip-add-day").click();
  await addSpot(page, "성산일출봉");
  // 긴 줄을 써 두면 종이 폭이 줄 때 줄바꿈이 늘어 글 칸이 길어진다 — 다시 배치해야만 높이가 따라온다
  await page.locator(".diary-text").fill(Array.from({ length:12 }, () => "제주 바다는 생각보다 훨씬 파랗고 바람이 세서 모자가 날아갈 뻔했다").join("\n"));
  let [paper, spots] = await Promise.all([boxOf(page, ".trip-write > .diary-paper"), boxOf(page, ".trip-write > .trip-spots")]);
  expect(spots.x).toBeGreaterThan(paper.x + paper.width - 1);
  const textHeight = () => page.locator(".diary-text").evaluate((el) => parseFloat(el.style.height) || 0);
  const before = await textHeight(), sideWidth = paper.width;

  // 분할 바로 지도를 넓힌다(왼쪽 화살표 = 지도 20px 넓게)
  const divider = page.locator(".trip-map-divider");
  await divider.focus();
  for (let i = 0; i < 25; i++) await divider.press("ArrowLeft");
  [paper, spots] = await Promise.all([boxOf(page, ".trip-write > .diary-paper"), boxOf(page, ".trip-write > .trip-spots")]);
  expect(spots.y).toBeGreaterThan(paper.y + paper.height - 1);     // 종이 아래로
  // 종이가 좁아졌으니 줄바꿈이 늘어 글 칸이 길어진다(폭이 바뀌자 다시 배치했다)
  expect(paper.width).toBeLessThan(sideWidth - 30);
  await expect.poll(textHeight).toBeGreaterThan(before);
});

test("들른 곳 칸과 날 띠는 스크롤 막대 없이 휠로 굴러간다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:640 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  for (let i = 0; i < 12; i++) await addSpot(page, "장소 " + (i + 1));
  const column = page.locator(".trip-write > .trip-spots");
  const state = await column.evaluate((el) => ({
    bar: getComputedStyle(el).scrollbarWidth, gutter: el.offsetWidth - el.clientWidth,
    overflow: el.scrollHeight > el.clientHeight + 10
  }));
  expect(state.bar).toBe("none");
  expect(state.gutter).toBeLessThanOrEqual(2);       // 테두리 몫만 — 막대 폭이 없다
  expect(state.overflow).toBe(true);                 // 넘치는 내용은 있다
  await column.evaluate((el) => { el.scrollTop = 0; });
  const box = await column.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".trip-days .trip-rail-list").evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("none");
});

test("막대를 감춘 두 칸은 아래에 더 있을 때만 옅은 그림자를 띄운다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:640 });
  await boot(page);
  await page.locator(".trip-add-day").click();
  for (let i = 0; i < 12; i++) await addSpot(page, "장소 " + (i + 1));
  await page.locator(".diary-text").fill(Array.from({ length:60 }, (_, i) => (i + 1) + "줄째").join("\n"));

  const shade = (sel) => page.locator(sel).evaluate((el) => ({
    more: el.classList.contains("has-more-below"),
    opacity: getComputedStyle(el, "::after").opacity,
    bar: getComputedStyle(el).scrollbarWidth
  }));
  for (const sel of [".trip-main", ".trip-write > .trip-spots"]){
    await page.locator(sel).evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await expect.poll(async () => (await shade(sel)).more).toBe(true);
    let state = await shade(sel);
    expect(state.bar).toBe("none");
    await expect.poll(async () => (await shade(sel)).opacity).toBe("1");
    // 끝까지 내리면 그림자가 사라진다
    await page.locator(sel).evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
    await expect.poll(async () => (await shade(sel)).more).toBe(false);
    await expect.poll(async () => (await shade(sel)).opacity).toBe("0");
  }
  // 장소를 하나만 남기면(넘치지 않으면) 들른 곳 칸에는 그림자가 없다
  await page.locator(".trip-day-chip").first().click();
  await page.locator(".trip-add-day").click();
  await addSpot(page, "혼자");
  await expect.poll(async () => (await shade(".trip-write > .trip-spots")).more).toBe(false);
});
