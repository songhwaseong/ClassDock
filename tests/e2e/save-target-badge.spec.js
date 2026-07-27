const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 저장 위치 배지.
 *
 * "저장하면 원본이 바뀌나?"는 이 앱에서 가장 자주 헷갈리는 지점이라 README 맨 위에
 * 경고 문단이 있었다. 배지가 그 답을 화면에서 항상 보여 주도록 고정한다.
 *   · 원본에 직접 쓸 수 있으면 "원본 저장"
 *   · 사본으로만 저장되면 "사본 저장"(예전에는 배지가 아예 없어 "저장할 수 없는 문서"와 구분이 안 됐다)
 *   · 저장 동선이 없는 미리보기 문서에서는 아무 배지도 띄우지 않는다
 */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

const badge = (page) => page.locator("#originalSaveBadge");

test("파일 입력으로 연 편집 가능한 문서는 '사본 저장'으로 안내한다", async ({ page }) => {
  await boot(page);
  // setInputFiles 로 온 파일에는 파일 핸들이 없다 = 원본에 직접 쓸 수 없는 상태.
  await page.locator("#fileInput").setInputFiles({
    name: "저장위치.py",
    mimeType: "text/x-python",
    buffer: Buffer.from("print(1)\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("저장위치.py");
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toHaveText("사본 저장");
  await expect(badge(page)).toHaveAttribute("title", /원본은 그대로 두고/);
  await expect(badge(page)).toHaveClass(/is-copy/);
});

test("원본에 바로 쓰는 문서는 '원본 저장'으로 안내한다", async ({ page }) => {
  await boot(page);
  await page.locator("#fileInput").setInputFiles({
    name: "원본저장.py",
    mimeType: "text/x-python",
    buffer: Buffer.from("print(1)\n", "utf8")
  });
  await expect(badge(page)).toHaveText("사본 저장");
  // 폴더로 연 문서와 같은 상태(원본 저장 모드)를 만들면 배지도 함께 바뀌어야 한다.
  await page.evaluate(() => {
    const doc = docs.find((d) => d.name === "원본저장.py");
    doc.originalSaveMode = true;
    updateOriginalSaveBadge(doc);
  });
  await expect(badge(page)).toHaveText("원본 저장");
  await expect(badge(page)).toHaveAttribute("title", /원본이 바로 바뀝니다/);
  await expect(badge(page)).not.toHaveClass(/is-copy/);
});

test("저장 동선이 없는 문서에는 배지를 띄우지 않는다", async ({ page }) => {
  await boot(page);
  await expect(badge(page)).toBeHidden();                 // 빈 화면
  await page.locator("#fileInput").setInputFiles({
    name: "읽기전용.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("그냥 보기만 하는 글\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("읽기전용.txt");
  // 텍스트는 읽기 전용 보기로 먼저 열린다 — 저장 버튼이 없으므로 배지도 없다.
  await expect(badge(page)).toBeHidden();
});

test("배지 안내는 화면 낭독기에도 같은 내용으로 전달된다", async ({ page }) => {
  await boot(page);
  await page.locator("#fileInput").setInputFiles({
    name: "읽어주기.py",
    mimeType: "text/x-python",
    buffer: Buffer.from("print(1)\n", "utf8")
  });
  await expect(badge(page)).toBeVisible();
  const label = await badge(page).getAttribute("aria-label");
  expect(label).toContain("사본 저장");
  expect(label).toContain("원본은 그대로 두고");
});
