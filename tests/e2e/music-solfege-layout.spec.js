const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 계이름은 오선 밖 전용 줄에 그린다. 대보표에서는 그 줄이 두 오선 사이에 놓이는데, 아랫줄의
// 덧줄 음도 같은 자리를 쓰므로 계이름을 켠 동안만 사이를 벌려 계이름 몫의 칸을 만든다.
// 여기서만 확인할 수 있는 것 — VexFlow 가 실제로 그린 오선·글자 좌표가 서로 비켜서는지,
// 그만큼 SVG 높이가 늘어 아랫단이 잘리지 않는지(계산은 화면 밖에서 알 수 없다).

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// 아랫줄에 가온다 언저리(덧줄) 음을 두어 계이름 줄과 자리를 다투게 만든다.
const GRAND_SHEET = `(() => {
  const sheet = musicEmpty("계이름 자리");
  sheet.grandStaff = true;
  sheet.showSolfege = true;
  const bar = () => musicMeasure(
    [musicNote("C", 5), musicNote("D", 5), musicNote("E", 5, { alter:-1 }), musicNote("F", 5)],
    { bassNotes:[musicNote("C", 4), musicNote("D", 4), musicNote("E", 4, { alter:-1 }), musicNote("F", 4)] });
  sheet.measures = [bar(), bar()];
  return sheet;
})()`;

async function openScore(page, source){
  await page.evaluate((build) => {
    const sheet = (0, eval)(build);
    return handleFiles([new File([musicSerialize(sheet)], sheet.title + ".msheet", { type:"application/json" })],
      { isScratch:true });
  }, source);
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
}

const scoreHeight = (page) => page.locator(".music-score svg").last()
  .evaluate((svg) => Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height);

test("대보표 계이름은 아랫줄 오선 위에 제 칸을 얻고 임시표는 작은 윗첨자로 붙는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page, GRAND_SHEET);

  // 1) 윗줄 계이름은 아랫줄 오선 첫 줄에 닿지 않는다 — 덧줄 음이 쓸 자리를 남겨 둔다.
  const clearance = await page.locator(".music-score svg").last().evaluate((svg) => {
    const staves = [...svg.querySelectorAll(".vf-stave")].map((el) => el.getBoundingClientRect());
    const bassTop = Math.min(...staves.filter((box) => box.top > Math.min(...staves.map((s) => s.top)) + 20)
      .map((box) => box.top));
    const labels = [...svg.querySelectorAll(".music-solfege")].filter((el) => el.dataset.staff === "treble");
    return { count:labels.length, gap:Math.min(...labels.map((el) => bassTop - el.getBoundingClientRect().bottom)) };
  });
  expect(clearance.count).toBe(8);
  // 칸을 벌리기 전에는 10px 남짓이라 아랫줄 덧줄 음이 계이름 위에 얹혔다. 덧줄 두세 줄이 들어갈 만큼 띄운다.
  expect(clearance.gap).toBeGreaterThan(30);

  // 2) 임시표는 계이름 글자보다 작아야 한 칸이 넓어지지 않는다.
  const markSize = await page.locator(".music-score svg .music-solfege-mark").first().evaluate((el) => ({
    mark:parseFloat(getComputedStyle(el).fontSize),
    name:parseFloat(getComputedStyle(el.parentNode).fontSize),
    text:el.parentNode.textContent
  }));
  expect(markSize.mark).toBeLessThan(markSize.name);
  expect(markSize.text).toBe("미♭");

  // 3) 벌린 칸은 SVG 높이에도 들어간다 — 안 그러면 그림·메모로 보낸 악보에서 아랫줄이 잘린다.
  const withSolfege = await scoreHeight(page);
  await page.locator(".music-tab", { hasText:"악보/가사" }).last().click();
  await page.locator(".music-score-tools button", { hasText:/^계이름$/ }).last().click();
  await expect(page.locator(".music-score svg .music-solfege")).toHaveCount(0);
  expect(withSolfege - await scoreHeight(page)).toBe(26);

  expect(errors).toEqual([]);
});

test("붙일 오선을 고르면 그 줄만 계이름이 남고 자리도 그만큼만 잡는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page, GRAND_SHEET);
  const bothHeight = await scoreHeight(page);
  const staffOf = () => page.locator(".music-score svg .music-solfege")
    .evaluateAll((els) => els.map((el) => el.dataset.staff));

  const pickSolfege = async (label) => {
    await page.locator(".music-tab", { hasText:"악보/가사" }).last().click();
    await page.locator(".music-score-tools button", { hasText:"조판 ▾" }).click();
    await page.locator(".music-context-menu button", { hasText:/^계이름$/ }).click();
    await page.locator(".music-context-menu button", { hasText:label }).click();
    await expect(page.locator(".music-context-menu")).toHaveCount(0);
  };

  // 윗줄만 — 아랫줄 계이름이 빠져도 두 오선 사이의 칸은 그대로 있어야 한다.
  await pickSolfege("윗줄(오른손)만");
  expect(new Set(await staffOf())).toEqual(new Set(["treble"]));
  expect(await scoreHeight(page)).toBe(bothHeight);

  // 아랫줄만 — 계이름 줄이 대보표 아래로 내려가므로 사이를 벌려 둘 까닭이 없다.
  await pickSolfege("아랫줄(왼손)만");
  expect(new Set(await staffOf())).toEqual(new Set(["bass"]));
  expect(bothHeight - await scoreHeight(page)).toBe(26);

  // 끄기까지 같은 목록에서 한다.
  await pickSolfege("끄기");
  await expect(page.locator(".music-score svg .music-solfege")).toHaveCount(0);

  expect(errors).toEqual([]);
});
