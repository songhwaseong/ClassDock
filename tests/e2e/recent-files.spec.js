const { test, expect } = require("@playwright/test");

/* 최근 연 항목 UI.
 *
 * 실제 재열기는 File System Access 핸들이 필요해 자동화 브라우저에서 만들 수 없다.
 * 그래서 여기서는 "목록이 화면에 제대로 뜨는가"와 "핸들이 없는 항목을 눌렀을 때 사용자가
 * 막다른 길에 놓이지 않는가"(안내 + 목록에서 지우기)를 지킨다.
 * 목록 자체의 규칙(중복·상한·순서)은 tests/recent-files.test.js 가 따로 검사한다.
 */

const SEED = [
  { type: "file", name: "수업정리.py", path: "수업정리.py", at: Date.now() - 60_000 },
  { type: "folder", name: "3반 과제", path: "3반 과제", at: Date.now() - 7_200_000 },
  { type: "file", name: "성적.xlsx", path: "성적/성적.xlsx", at: Date.now() - 172_800_000 }
];

async function boot(page, recent){
  await page.addInitScript((rows) => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
      if (rows) localStorage.setItem("mn.recentItems", JSON.stringify(rows));
    } catch(_){}
  }, recent || null);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

test("최근 항목이 없으면 목록 자체가 보이지 않는다", async ({ page }) => {
  await boot(page, null);
  await expect(page.locator("#dzRecent")).toBeHidden();
});

test("최근 항목을 이름·시점과 함께 최신 순으로 보여 준다", async ({ page }) => {
  await boot(page, SEED);
  const items = page.locator(".dz-recent-item");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).locator(".dz-recent-name")).toHaveText("수업정리.py");
  await expect(items.nth(1).locator(".dz-recent-name")).toHaveText("3반 과제");
  await expect(items.nth(2).locator(".dz-recent-name")).toHaveText("성적.xlsx");
  await expect(items.nth(0).locator(".dz-recent-when")).toHaveText("1분 전");
  await expect(items.nth(1).locator(".dz-recent-when")).toHaveText("2시간 전");
  await expect(items.nth(2).locator(".dz-recent-when")).toHaveText("2일 전");
  // 폴더 항목은 경로 전체를 title 로 알려 같은 이름을 구분할 수 있어야 한다.
  await expect(items.nth(2)).toHaveAttribute("title", "성적/성적.xlsx");
});

test("항목의 ×는 목록에서만 지우고 파일 선택창을 열지 않는다", async ({ page }) => {
  await boot(page, SEED);
  await page.locator(".dz-recent-item").first().hover();
  await page.locator(".dz-recent-item").first().locator(".dz-recent-drop").click();
  await expect(page.locator(".dz-recent-item")).toHaveCount(2);
  await expect(page.locator(".dz-recent-item").first().locator(".dz-recent-name")).toHaveText("3반 과제");
  // 목록에서만 사라졌을 뿐 문서를 연 것은 아니다 — 여전히 빈 화면이어야 한다.
  await expect(page.locator("#dropzone")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.recentItems")).length)).toBe(2);
});

test("'목록 지우기'는 전체를 비우고 목록을 감춘다", async ({ page }) => {
  await boot(page, SEED);
  await page.locator("#dzRecentClear").click();
  await expect(page.locator("#dzRecent")).toBeHidden();
  await expect(page.getByText("최근 목록을 지웠어요. 파일은 그대로예요.")).toBeVisible();
});

test("되살릴 수 없는 항목을 누르면 이유와 '목록에서 지우기'를 함께 안내한다", async ({ page }) => {
  await boot(page, SEED);
  await page.locator(".dz-recent-item").first().click();
  await expect(page.getByText(/찾지 못했어요/)).toBeVisible();
  await page.locator(".toast-action", { hasText: "목록에서 지우기" }).click();
  await expect(page.locator(".dz-recent-item")).toHaveCount(2);
});

test("목록이 바뀌면 빈 화면이 즉시 다시 그려진다", async ({ page }) => {
  await boot(page, null);
  await expect(page.locator("#dzRecent")).toBeHidden();
  await page.evaluate(() => MNRecent.rememberFile("새로열림.md", "메모/새로열림.md"));
  await expect(page.locator("#dzRecent")).toBeVisible();
  await expect(page.locator(".dz-recent-item")).toHaveCount(1);
  await expect(page.locator(".dz-recent-name")).toHaveText("새로열림.md");
});
