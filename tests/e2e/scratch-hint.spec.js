const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 새로 만든 코드 파일의 안내 문구("여기에 … 작성하고 ▶ 실행")는 본문 글자가 아니라
   비워 둔 첫 줄에 얹은 층이다. 그래서 (1) 저장·실행되는 본문에는 안 들어가고,
   (2) 한 글자만 쳐도 사라지며, (3) 되돌리기로 되살아나지 않는다. */

async function openApp(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
}

async function openFromNewMenu(page, id){
  await page.locator("#dzNew").click();
  await page.locator("#" + id).click();
}

const hint = (page) => page.locator(".code-ghost-hint");
const editor = (page) => page.locator(".code-input").first();

const CASES = [
  { name:"파이썬", open:(page) => page.locator("#dzNewPy").click(),
    word:/파이썬|Python/, body:'print("Hello, Python!")' },
  { name:"자바스크립트", open:(page) => openFromNewMenu(page, "dzNewJs"),
    word:/자바스크립트|JavaScript/, body:'console.log("Hello, JavaScript!");' },
  { name:"자바", open:(page) => openFromNewMenu(page, "dzNewJava"),
    word:/자바 코드|Java code/, body:"public class Main {" }
];

test.describe("새 코드 파일 안내 문구", () => {
  for (const c of CASES){
    test(`${c.name}: 안내는 본문에 없고 첫 입력에 사라진다`, async ({ page }) => {
      await openApp(page);
      await c.open(page);

      await expect(hint(page)).toBeVisible();
      await expect(hint(page)).toHaveText(c.word);   // 한/EN 어느 쪽이든 그때의 UI 언어로 나온다

      // 본문은 빈 첫 줄 + 시작 코드뿐 — 안내 문구는 한 글자도 들어 있지 않다.
      const value = await editor(page).inputValue();
      expect(value.startsWith("\n")).toBe(true);
      expect(value).toContain(c.body);
      expect(value).not.toMatch(/작성하고|Write .* here/);

      // 첫 글자에서 사라진다.
      await editor(page).click();
      await page.keyboard.type("x");
      await expect(hint(page)).toBeHidden();

      // 지워서 본문이 시작값으로 돌아가도 되살아나지 않는다(본문이 아니라 층이므로 undo 와 무관).
      await page.keyboard.press("Control+z");
      await expect(hint(page)).toBeHidden();
    });
  }
});
