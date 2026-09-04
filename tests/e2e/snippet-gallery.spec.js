const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 예제 갤러리: 파이썬·자바를 언어 탭 하나로 함께 본다.
// 탭을 바꾸면 난이도 칩 개수와 카드 목록이 그 언어 것으로 다시 그려지고,
// 카드를 누르면 그 언어의 새 코드 문서가 열린다.

async function openGallery(page) {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#dzExamples").click();
  await expect(page.locator(".snippet-modal")).toBeVisible();
}

const langChip = (page, label) => page.locator(".snippet-langbar .snippet-chip", { hasText: label });

test.describe("예제 갤러리", () => {
  test("언어 탭으로 파이썬·자바를 오가고 목록이 다시 그려진다", async ({ page }) => {
    await openGallery(page);
    await expect(page.locator(".snippet-modal h3")).toHaveText("파이썬 예제 갤러리");
    await expect(langChip(page, "파이썬")).toHaveClass(/active/);

    const pythonCards = await page.locator(".snippet-card").count();
    expect(pythonCards).toBeGreaterThan(50);

    await langChip(page, "자바").click();
    await expect(page.locator(".snippet-modal h3")).toHaveText("자바 예제 갤러리");
    await expect(langChip(page, "자바")).toHaveClass(/active/);
    await expect(langChip(page, "파이썬")).not.toHaveClass(/active/);

    // 자바 목록으로 갈아 끼워진다 — 파이썬 카드가 섞여 남아 있으면 안 된다.
    const javaCards = await page.locator(".snippet-card").count();
    expect(javaCards).toBeGreaterThan(0);
    expect(javaCards).toBeLessThan(pythonCards);
    await expect(page.locator(".snippet-card", { hasText: "Hello, Java" })).toBeVisible();
    await expect(page.locator(".snippet-card", { hasText: "Hello, Python" })).toHaveCount(0);

    // 난이도 칩도 그 언어 개수로 다시 센다(전체 = 그 언어의 예제 수).
    await expect(page.locator(".snippet-filter:not(.snippet-langbar) .snippet-chip").first())
      .toHaveText("전체 " + javaCards);
  });

  test("자바 탭에서 카드를 누르면 .java 새 코드가 열린다", async ({ page }) => {
    await openGallery(page);
    await langChip(page, "자바").click();
    await page.locator(".snippet-card", { hasText: "구구단" }).click();

    await expect(page.locator(".snippet-modal")).toHaveCount(0);
    await expect(page.locator("textarea.code-input")).toBeVisible();
    await expect(page.locator("textarea.code-input")).toHaveValue(/public class TimesTable/);
    // 파일 이름은 public 클래스 이름과 같아야 한다(자바 저장 규칙).
    await expect(page.locator(".tab.active .tab-name, .tab.is-active .tab-name").first())
      .toHaveText(/TimesTable\.java/);
  });

  test("짝 링크로 두 언어를 오가고, 건너간 카드가 표시된다", async ({ page }) => {
    await openGallery(page);
    // 파이썬 '구구단' 카드에는 자바 짝이 있다.
    const pyCell = page.locator(".snippet-cell", { has: page.locator(".snippet-title", { hasText: "구구단" }) }).first();
    await pyCell.locator(".snippet-pair").click();

    await expect(page.locator(".snippet-modal h3")).toHaveText("자바 예제 갤러리");
    await expect(langChip(page, "자바")).toHaveClass(/active/);
    const target = page.locator(".snippet-cell.is-target");
    await expect(target).toHaveCount(1);
    await expect(target.locator(".snippet-card")).toHaveAttribute("title", "TimesTable.java");

    // 돌아오는 길도 있다.
    await target.locator(".snippet-pair").click();
    await expect(page.locator(".snippet-modal h3")).toHaveText("파이썬 예제 갤러리");
    await expect(page.locator(".snippet-cell.is-target .snippet-card")).toHaveAttribute("title", "구구단.py");
  });

  test("짝 링크는 걸러 둔 난이도·검색어를 풀고 건너간다", async ({ page }) => {
    await openGallery(page);
    await page.locator(".snippet-search").fill("구구단");
    await expect(page.locator(".snippet-cell:not([hidden])")).toHaveCount(1);

    await page.locator(".snippet-cell:not([hidden]) .snippet-pair").click();
    await expect(page.locator(".snippet-search")).toHaveValue("");          // 검색어를 풀어야 보인다
    await expect(page.locator(".snippet-cell.is-target")).toBeVisible();
    await expect(page.locator(".snippet-filter:not(.snippet-langbar) .snippet-chip").first())
      .toHaveClass(/active/);                                               // 난이도도 '전체' 로
  });

  test("짝이 없는 예제에는 링크를 달지 않는다", async ({ page }) => {
    await openGallery(page);
    await langChip(page, "자바").click();
    const solo = page.locator(".snippet-cell", { has: page.locator(".snippet-title", { hasText: "== 와 equals" }) });
    await expect(solo).toHaveCount(1);
    await expect(solo.locator(".snippet-pair")).toHaveCount(0);
  });

  test("검색은 지금 보고 있는 언어 안에서만 거른다", async ({ page }) => {
    await openGallery(page);
    await langChip(page, "자바").click();
    await page.locator(".snippet-search").fill("구구단");
    await expect(page.locator(".snippet-cell:not([hidden])")).toHaveCount(1);

    await page.locator(".snippet-search").fill("컴프리헨션");          // 파이썬에만 있는 개념
    await expect(page.locator(".snippet-cell:not([hidden])")).toHaveCount(0);
    await expect(page.locator(".snippet-empty")).toBeVisible();
  });
});
