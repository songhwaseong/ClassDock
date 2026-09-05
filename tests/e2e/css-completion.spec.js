const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* CSS 편집 도움(자동완성 · 주석 토글) e2e.
   CSS 는 이름에 하이픈이 들어가고(background-color) 줄 주석이 없는 언어라, 공용 편집기의
   기본 규칙을 그대로 쓰면 접두어가 끊기고 유효하지 않은 주석이 들어간다.
   .css 는 실행이 없는 문서라 보기 화면에서 '편집'을 눌러 편집기로 들어간다. */
const SOURCE = [
  ":root{",
  "  --brand-color: #3366ff;",
  "}",
  "",
  ".box{",
  "",
  "}",
  ""
].join("\n");

async function openCss(page, name = "style.css", body = SOURCE){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name, mimeType: "text/css", buffer: Buffer.from(body, "utf8")
  });
  // 보기 바에는 줄바꿈 토글도 같은 클래스라 글자로 집는다.
  await page.locator("button.text-edit-btn", { hasText: "편집" }).first().click();
  await expect(page.locator("textarea.code-input")).toBeVisible();
}

// .box{ } 안 빈 줄에 커서를 두고 이어서 친다. 앞 테스트에서 친 글자가 남지 않도록 본문을 되돌린다.
async function typeInRule(page, text, source = SOURCE){
  await page.locator("textarea.code-input").click();
  await page.evaluate((src) => {
    const ta = document.querySelector("textarea.code-input");
    ta.value = src;
    ta.dispatchEvent(new Event("input", { bubbles:true }));
    const at = ta.value.indexOf("{\n\n}");
    ta.selectionStart = ta.selectionEnd = at + 2;
  }, source);
  await page.keyboard.type(text);
}

const names = (page) => page.locator(".code-complete-item .code-complete-name");
const editorValue = (page) => page.locator("textarea.code-input").inputValue();

test.describe("CSS 자동완성", () => {
  test("하이픈 뒤에서도 속성 후보가 이어진다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  background-c");
    await expect(names(page).first()).toBeVisible();
    await expect(names(page).filter({ hasText: "background-color" }).first()).toBeVisible();
  });

  test("고른 속성은 하이픈 앞부터 통째로 바뀐다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  background-c");
    await expect(names(page).first()).toBeVisible();
    await names(page).filter({ hasText: "background-color" }).first().click();
    expect(await editorValue(page)).toContain("  background-color");
    // 접두어가 c 로 리셋되면 background-background-color 처럼 겹쳐 들어갔다
    expect(await editorValue(page)).not.toContain("background-background");
  });

  test("내 파일에 이미 쓴 CSS 변수도 후보가 된다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  color: var(--bra");
    await expect(names(page).filter({ hasText: "--brand-color" }).first()).toBeVisible();
  });

  test("@ 를 치면 @media 같은 규칙이 나온다", async ({ page }) => {
    await openCss(page);
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
    await page.keyboard.type("@med");
    await expect(names(page).filter({ hasText: "@media" }).first()).toBeVisible();
  });

  test("클래스 선택자의 점은 멤버 접근이 아니다 — 창이 뜨지 않는다", async ({ page }) => {
    await openCss(page);
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
    await page.keyboard.type("\n.");
    await expect(names(page)).toHaveCount(0);
  });

  test("주석 안에서는 후보 창을 열지 않는다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  /* back");
    await expect(names(page)).toHaveCount(0);
  });

  test("속성을 고르면 콜론까지 들어가고 값 후보가 이어서 열린다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  disp");
    await names(page).filter({ hasText: "display" }).first().click();
    expect(await editorValue(page)).toContain("  display: ");
    // 값 자리가 되면 그 속성의 값이 저절로 뜬다
    await expect(names(page).filter({ hasText: "flex" }).first()).toBeVisible();
    await names(page).filter({ hasText: "flex" }).first().click();
    expect(await editorValue(page)).toContain("  display: flex");
  });

  test("값 자리에는 그 속성이 받는 값만 나온다 — 속성 이름은 섞이지 않는다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  display: b");
    await expect(names(page).filter({ hasText: "block" }).first()).toBeVisible();
    // background-color 는 b 로 시작하지만 값 자리에서는 후보가 아니다
    await expect(names(page).filter({ hasText: "background-color" })).toHaveCount(0);
  });

  test("색을 받는 속성에는 색 이름과 색 함수가 나온다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  color: tr");
    await expect(names(page).filter({ hasText: "transparent" }).first()).toBeVisible();
  });

  test("속성 후보에는 무엇을 하는 속성인지 설명이 붙는다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  z-ind");
    const row = page.locator(".code-complete-item", { hasText: "z-index" }).first();
    await expect(row.locator(".code-complete-signature")).toContainText("겹칠 때");
  });

  test("선택자 뒤 : 에서는 가상 클래스가 나온다", async ({ page }) => {
    await openCss(page);
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
    await page.keyboard.type("\n.card:");
    await expect(names(page).filter({ hasText: "hover" }).first()).toBeVisible();
  });

  test("색 값 후보에는 색 칩이 붙는다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  color: re");
    const row = page.locator(".code-complete-item", { hasText: "red" }).first();
    await expect(row.locator(".code-complete-swatch")).toHaveCSS("background-color", "rgb(255, 0, 0)");
    // 이 파일에 선언한 색 변수도 그 값으로 칩이 붙는다
    await typeInRule(page, "  color: --bra");
    const varRow = page.locator(".code-complete-item", { hasText: "--brand-color" }).first();
    await expect(varRow.locator(".code-complete-swatch")).toHaveCSS("background-color", "rgb(51, 102, 255)");
  });

  test("@media 를 고르면 블록이 통째로 들어가고 커서가 안에 선다", async ({ page }) => {
    await openCss(page);
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.value = "";
      ta.dispatchEvent(new Event("input", { bubbles:true }));
      ta.selectionStart = ta.selectionEnd = 0;
    });
    await page.keyboard.type("@med");
    await names(page).filter({ hasText: "@media" }).first().click();
    expect(await editorValue(page)).toBe("@media (min-width: 768px) {\n  \n}");
    // 커서는 블록 안 빈 줄 — 바로 이어서 칠 수 있다
    expect(await page.evaluate(() => document.querySelector("textarea.code-input").selectionStart))
      .toBe("@media (min-width: 768px) {\n  ".length);
  });

  test("flex-center 스니펫은 세 줄을 들여쓰기에 맞춰 넣는다", async ({ page }) => {
    await openCss(page);
    await typeInRule(page, "  flex-cen");
    await names(page).filter({ hasText: "flex-center" }).first().click();
    expect(await editorValue(page)).toContain("  display: flex;\n  align-items: center;\n  justify-content: center;");
  });

  test("옆 .html 이 쓰는 class 가 선택자 후보로 나온다", async ({ page }) => {
    await openCss(page);
    // 같은 작업공간에 HTML 을 하나 더 연다(탭이 바뀌므로 CSS 탭으로 돌아온다)
    await page.locator("#fileInput").setInputFiles({
      name: "index.html", mimeType: "text/html",
      buffer: Buffer.from('<div class="hero-banner"><p id="lead">x</p></div>', "utf8")
    });
    await page.locator(".tab", { hasText: "style.css" }).first().click();
    await expect(page.locator("textarea.code-input")).toBeVisible();
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
    await page.keyboard.type("\n.hero-b");
    const row = page.locator(".code-complete-item", { hasText: "hero-banner" }).first();
    // 아직 연 적 없는 옆 파일은 백그라운드로 읽는다(팝업은 동기라 그 자리에서 못 읽는다).
    // 다 읽으면 열려 있는 목록을 스스로 다시 만들므로, 더 치지 않아도 후보가 들어온다.
    await expect(row).toBeVisible();
    await expect(row.locator(".code-complete-signature")).toContainText("index.html");
  });

  test(".scss 는 자바스크립트 키워드 대신 CSS·전처리기 키워드를 쓴다", async ({ page }) => {
    await openCss(page, "style.scss", ".box{\n\n}\n");
    await typeInRule(page, "  fun", ".box{\n\n}\n");
    await expect(names(page)).toHaveCount(0);          // function 은 SCSS 후보가 아니다
    await typeInRule(page, "  @mix", ".box{\n\n}\n");
    await expect(names(page).filter({ hasText: "@mixin" }).first()).toBeVisible();
  });
});

// Ctrl+/ — CSS 에는 줄 주석이 없어서, 예전에는 어느 언어든 // (또는 #)을 붙여
// 유효하지 않은 주석이 들어갔다. 이제 줄을 블록 주석으로 감싼다.
test.describe("CSS 주석 토글", () => {
  test("Ctrl+/ 는 줄을 통째로 감싸고 다시 누르면 벗긴다", async ({ page }) => {
    await openCss(page, "style.css", ".box{\n  color: red;\n}\n");
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.selectionStart = ta.selectionEnd = ta.value.indexOf("color");
    });
    await page.keyboard.press("Control+Slash");
    expect(await editorValue(page)).toContain("  /* color: red; */");
    expect(await editorValue(page)).not.toContain("//");
    await page.keyboard.press("Control+Slash");
    expect(await editorValue(page)).toBe(".box{\n  color: red;\n}\n");
  });

  test(".scss 는 줄 주석이 있으므로 // 를 그대로 쓴다", async ({ page }) => {
    await openCss(page, "style.scss", ".box{\n  color: red;\n}\n");
    await page.locator("textarea.code-input").click();
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.code-input");
      ta.selectionStart = ta.selectionEnd = ta.value.indexOf("color");
    });
    await page.keyboard.press("Control+Slash");
    expect(await editorValue(page)).toContain("  // color: red;");
  });
});
