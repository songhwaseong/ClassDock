const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// markDocumentDirty 로 통일하기 전에는 편집기가 상단 배지만 갱신하고 사이드바를 다시 그리지
// 않아서, 편집을 해도 사이드바의 "저장 후 수정됨" 표시가 예전 상태로 남았다.
// 표시는 렌더 직후 icons.js 가 "●" 글자를 SVG 아이콘으로 바꾸므로 textContent 대신
// hidden/title 로 확인한다. title 문구를 고정하려고 언어는 한국어로 못박는다.
test("텍스트를 편집하면 상단 배지와 사이드바 표시가 함께 켜지고, 되돌리면 함께 꺼진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");

  // 사이드바 표시: 숨김이면 "", 아니면 title(저장 후 수정됨 / 앱 작업공간에 저장됨)
  const sidebarMark = () => page.evaluate(() => {
    const el = document.querySelector(".sb-saved");
    return el && !el.hidden ? el.title : "";
  });

  await page.locator("#fileInput").setInputFiles({
    name: "dirty-dot.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("dirty-dot.txt");

  await page.getByRole("button", { name: /편집/ }).first().click();
  const editor = page.locator(".code-input").first();
  await expect(editor).toBeVisible();

  // 편집 전: 상단 배지도 사이드바 표시도 꺼져 있다
  await expect(page.locator("#activeDocStatus")).toBeHidden();
  await expect.poll(sidebarMark).toBe("");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("!");

  // 편집 후: 둘 다 켜져야 한다 (사이드바 쪽이 핵심 — 이전에는 여기서 안 켜졌다)
  await expect(page.locator("#activeDocStatus")).toBeVisible();
  await expect(page.locator("#activeDocStatus")).toHaveClass(/dirty/);
  await expect.poll(sidebarMark).toBe("저장 후 수정됨");

  // 원래 내용으로 되돌리면 둘 다 꺼져야 한다
  await page.keyboard.press("Backspace");
  await expect(page.locator("#activeDocStatus")).toBeHidden();
  await expect.poll(sidebarMark).toBe("");

  expect(errors).toEqual([]);
});
