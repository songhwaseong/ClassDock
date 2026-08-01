const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 표 편집 우클릭 메뉴: 상단 도구막대 기능을 갈래별 하위 메뉴(▸)로 담는다.
// 하위 메뉴는 부모 안이 아니라 body 에 따로 뜨므로, "바깥 클릭으로 닫히지 않는지"까지 화면 기준으로 고정한다.

async function openSheet(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newSpreadsheetScratch());
  await expect(page.locator('td[data-mcol]').first()).toBeVisible();
}

const cell = (page, r, c) => page.locator(`td[data-mrow="${r}"][data-mcol="${c}"]`);
const menuItem = (page, label) => page.locator('.xlsx-context-menu button', { hasText: label });

async function rightClickCell(page, r, c){
  await cell(page, r, c).click({ button: "right" });
  await expect(page.locator('.xlsx-context-menu').first()).toBeVisible();
}

test("표 우클릭: 갈래 항목에 마우스를 올리면 하위 메뉴가 오른쪽에 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSheet(page);
  await rightClickCell(page, 0, 0);

  // 최상위에는 갈래만 보인다(예전처럼 모든 항목이 한 줄씩 늘어서지 않는다)
  await expect(menuItem(page, "삽입·삭제")).toBeVisible();
  await expect(menuItem(page, "글꼴")).toBeVisible();
  await expect(menuItem(page, "저장")).toBeVisible();
  await expect(page.locator('.xlsx-context-sub')).toHaveCount(0);

  await menuItem(page, "정렬").hover();
  await expect(page.locator('.xlsx-context-sub')).toHaveCount(1);
  await expect(page.locator('.xlsx-context-sub button', { hasText: "오름차순" })).toBeVisible();

  // 하위 메뉴는 부모 항목 오른쪽에 놓인다
  const boxes = await page.evaluate(() => {
    const parent = [...document.querySelectorAll('.xlsx-context-menu:not(.xlsx-context-sub) button')]
      .find(b => b.textContent.includes("정렬"));
    const sub = document.querySelector('.xlsx-context-sub');
    return { parentRight: parent.getBoundingClientRect().right, subLeft: sub.getBoundingClientRect().left };
  });
  expect(boxes.subLeft).toBeGreaterThan(boxes.parentRight - 10);

  // 다른 갈래로 옮기면 하위 메뉴가 교체된다(두 개가 겹쳐 뜨지 않는다)
  await menuItem(page, "글꼴").hover();
  await expect(page.locator('.xlsx-context-sub')).toHaveCount(1);
  await expect(page.locator('.xlsx-context-sub button', { hasText: "맑은 고딕" })).toBeVisible();
  await expect(page.locator('.xlsx-context-sub button', { hasText: "오름차순" })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("표 우클릭: 하위 메뉴에서 서식을 고르면 선택 셀에 적용된다", async ({ page }) => {
  await openSheet(page);
  await cell(page, 0, 0).dblclick();
  await page.keyboard.type("가나다");
  await page.keyboard.press("Enter");

  // 글꼴
  await rightClickCell(page, 0, 0);
  await menuItem(page, "글꼴").hover();
  await page.locator('.xlsx-context-sub button', { hasText: "궁서" }).click();
  await expect(page.locator('.xlsx-context-menu')).toHaveCount(0);
  await expect.poll(() => cell(page, 0, 0).evaluate(el => getComputedStyle(el).fontFamily)).toContain("궁서");

  // 굵게 — 갈래 안의 평범한 항목
  await rightClickCell(page, 0, 0);
  await menuItem(page, "글자").hover();
  await page.locator('.xlsx-context-sub button', { hasText: "굵게" }).click();
  await expect.poll(() => cell(page, 0, 0).evaluate(el => getComputedStyle(el).fontWeight)).toBe("700");

  // 맞춤
  await rightClickCell(page, 0, 0);
  await menuItem(page, "맞춤").hover();
  await page.locator('.xlsx-context-sub button', { hasText: "가운데" }).first().click();
  await expect.poll(() => cell(page, 0, 0).evaluate(el => getComputedStyle(el).textAlign)).toBe("center");

  // 채우기 색(팔레트 조각) — 선택 강조가 덮으므로 다른 셀을 눌러 선택을 옮긴 뒤 확인한다
  await rightClickCell(page, 0, 0);
  await menuItem(page, "채우기·테두리").hover();
  await page.locator('.xlsx-context-sub button', { hasText: "하늘" }).click();
  await cell(page, 2, 2).click();
  await expect.poll(() => cell(page, 0, 0).evaluate(el => getComputedStyle(el).backgroundColor))
    .toBe("rgb(191, 219, 254)");
});

test("표 우클릭: 표시형식 하위 메뉴는 도구막대 셀렉트와 같은 목록을 쓴다", async ({ page }) => {
  await openSheet(page);
  await cell(page, 0, 0).dblclick();
  await page.keyboard.type("0.25");
  await page.keyboard.press("Enter");

  await rightClickCell(page, 0, 0);
  await menuItem(page, "표시형식").hover();
  const labels = await page.locator('.xlsx-context-sub button').allInnerTexts();
  const selectLabels = await page.locator('select[title^="표시형식"] option').allInnerTexts();
  expect(labels).toEqual(selectLabels.filter(t => t !== "표시형식"));

  await page.locator('.xlsx-context-sub button', { hasText: "백분율 0%" }).first().click();
  await expect.poll(() => cell(page, 0, 0).innerText()).toBe("25%");
});

test("표 우클릭: Esc 는 하위 메뉴부터 닫고, 하위 메뉴 클릭은 바깥 클릭이 아니다", async ({ page }) => {
  await openSheet(page);
  await rightClickCell(page, 0, 0);
  await menuItem(page, "계산").hover();
  await expect(page.locator('.xlsx-context-sub')).toHaveCount(1);

  // 하위 메뉴 위에서 눌러도(=body 에 따로 뜬 층) 메뉴 전체가 닫히면 안 된다
  await page.locator('.xlsx-context-sub').dispatchEvent("pointerdown");
  await expect(page.locator('.xlsx-context-menu:not(.xlsx-context-sub)')).toHaveCount(1);
  await expect(page.locator('.xlsx-context-sub')).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator('.xlsx-context-sub')).toHaveCount(0);
  await expect(page.locator('.xlsx-context-menu')).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator('.xlsx-context-menu')).toHaveCount(0);
});

test("표 우클릭: 시트 탭 메뉴(하위 없음)는 그대로 동작한다", async ({ page }) => {
  await openSheet(page);
  await page.locator('.xlsx-tab').first().click({ button: "right" });
  await expect(menuItem(page, "새 시트")).toBeVisible();
  await menuItem(page, "새 시트").click();
  await expect(page.locator('.xlsx-tab')).toHaveCount(3);   // 기존 시트 + 새 시트 + '＋' 탭
});
