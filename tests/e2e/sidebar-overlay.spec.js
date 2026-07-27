const { test, expect } = require("@playwright/test");

// 사이드바는 본문을 밀어내지 않고 그 위에 뜨는 서랍이다. 다른 e2e 는 본문을 만지려고
// 서랍을 접은 상태로 시작하므로(helpers.js collapseSidebar), "서랍이 열려 있을 때" 쪽은
// 여기서만 지킨다 — 백드롭이 본문 클릭을 받아 서랍을 닫고, 닫은 상태가 기억되는지.

async function openTextDoc(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(
    { name: "drawer-note.txt", mimeType: "text/plain", buffer: Buffer.from("서랍 확인용 문서", "utf8") });
  await expect(page.locator("#activeFileName")).toHaveText("drawer-note.txt");
}

test("파일을 열면 사이드바가 본문 위에 뜨고 백드롭이 함께 깔린다", async ({ page }) => {
  await openTextDoc(page);
  await expect(page.locator("#sidebar")).toHaveClass(/is-open/);
  await expect(page.locator("#sidebarBackdrop")).toHaveClass(/is-open/);
  // 서랍이 열린 동안에는 백드롭이 본문 클릭을 가져간다 — 본문 위 좌표를 실제로 덮고 있는지 확인
  const covered = await page.evaluate(() => {
    const content = document.querySelector("#content").getBoundingClientRect();
    const hit = document.elementFromPoint(content.left + content.width / 2, content.top + content.height / 2);
    return !!(hit && hit.closest("#sidebarBackdrop"));
  });
  expect(covered).toBe(true);
});

test("백드롭을 누르면 서랍이 닫히고 본문을 바로 쓸 수 있다", async ({ page }) => {
  await openTextDoc(page);
  await page.locator("#sidebarBackdrop").click();
  await expect(page.locator("#sidebarBackdrop")).not.toHaveClass(/is-open/);
  await expect(page.locator("#sidebar")).not.toHaveClass(/is-open/);
  // 닫힌 뒤에는 본문 클릭이 그대로 통한다(읽기 전용 보기 → 편집 진입)
  await page.getByRole("button", { name: /편집/ }).first().click();
  await expect(page.locator(".code-input").first()).toBeVisible();
});

test("한 번 닫아 두면 다시 열어도 접힌 채로 시작한다", async ({ page }) => {
  await openTextDoc(page);
  await page.locator("#sidebarBackdrop").click();
  await expect(page.locator("#sidebarBackdrop")).not.toHaveClass(/is-open/);

  await page.reload();
  await expect(page.locator("#sidebar")).not.toHaveClass(/is-open/);
  expect(await page.evaluate(() => localStorage.getItem("sidebarCollapsed"))).toBe("true");
});

test("사이드바 토글 버튼으로 다시 열 수 있다", async ({ page }) => {
  await openTextDoc(page);
  await page.locator("#sidebarBackdrop").click();
  await expect(page.locator("#sidebar")).not.toHaveClass(/is-open/);

  await page.locator("#sidebarToggle").click();
  await expect(page.locator("#sidebar")).toHaveClass(/is-open/);
  await expect(page.locator("#sidebarBackdrop")).toHaveClass(/is-open/);
});
