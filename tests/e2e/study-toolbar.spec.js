const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 암기장(.study) 도구막대 — 아이콘 버튼 + ⋯ 메뉴로 줄인 뒤의 약속들.
 * 이 화면에서 실제로 깨졌던 것 셋을 지킨다:
 *  1) 저장 버튼 글자는 documents.js 가 갈아 끼우는데, 아이콘까지 지워지면 안 된다.
 *  2) 모달 제목이 전역 header{color:#fff} 를 물려받아 흰 판에 흰 글자로 사라졌었다.
 *  3) 도구막대가 1024px 창에서 두 줄로 접히며 저장 버튼이 둘째 줄로 밀렸었다. */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newStudyScratch && window.newStudyScratch());
  await expect(page.locator(".study-bar")).toBeVisible();
}

test("저장 버튼은 배지가 글자를 바꾼 뒤에도 아이콘을 잃지 않는다", async ({ page }) => {
  await boot(page);
  const save = page.locator(".study-bar .run-save");
  await expect(save.locator("svg.ui-icon")).toHaveCount(1);
  await expect(save.locator(".run-save-label")).toHaveText("저장");
});

test("1024px 창에서도 도구막대가 한 줄에 들어온다", async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  const bar = page.locator(".study-bar");
  // 한 줄이면 버튼 높이가 1px씩 달라 생기는 차이만 난다. 줄이 늘면 40px 가까이 벌어진다.
  const spread = await bar.evaluate((el) => {
    const tops = Array.from(el.querySelectorAll("button")).map((b) => b.getBoundingClientRect().top);
    return Math.max(...tops) - Math.min(...tops);
  });
  expect(spread).toBeLessThan(10);
});

test("CSV 들이기·내보내기와 순서 섞기는 ⋯ 안에 있고 켜면 표시가 남는다", async ({ page }) => {
  await boot(page);
  const more = page.locator(".study-bar .study-btn").last();
  await more.click();
  const menu = page.locator(".text-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator("button", { hasText: "CSV 들이기" })).toHaveCount(1);
  await expect(menu.locator("button", { hasText: "CSV 내보내기" })).toHaveCount(1);

  await menu.locator("button", { hasText: "순서 섞기" }).click();
  await expect(menu).toHaveCount(0);                                // 고르면 닫힌다
  await expect(more).toHaveClass(/study-on/);                        // 메뉴를 닫아도 켜진 게 보인다
  await more.click();
  await expect(page.locator(".text-context-menu button.is-active")).toHaveCount(1);
});

test("카드 편집 창 제목이 보이고 연필 버튼이 그 창을 연다", async ({ page }) => {
  await boot(page);
  await page.locator(".study-bar .study-primary").first().click();
  const heading = page.locator(".study-modal-card h2");
  await expect(heading).toHaveText("새 암기 카드");
  // 흰 판에 흰 글자였던 자리 — 글자색이 배경색과 같으면 안 된다.
  const [ink, paper] = await Promise.all([
    heading.evaluate((el) => getComputedStyle(el).color),
    page.locator(".study-modal-card header").evaluate((el) => getComputedStyle(el).backgroundColor)
  ]);
  expect(ink).not.toBe(paper);

  await page.locator(".sc-front").fill("조선을 세운 사람은?");
  await page.locator(".sc-save").click();
  await expect(page.locator(".study-list-card")).toHaveCount(1);

  const edit = page.locator(".study-card-edit");
  await expect(edit.locator("svg.ui-icon")).toHaveCount(1);          // '수정' 글자 대신 연필
  await edit.click();
  await expect(page.locator(".study-modal-card h2")).toHaveText("카드 수정");
});
