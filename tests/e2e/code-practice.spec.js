const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 코드 따라치기(타자 연습): 교본을 흐리게 깔고 그 위에 똑같이 치면 맞은 글자는 제 색, 틀린 글자는 빨강.
// 이 기능의 안전선은 "본문(textarea)이 연습 내내 원본 그대로"라는 것 — 저장·자동저장이 치다 만 글자를
// 파일에 덮어쓰지 않는 근거이므로 단계마다 값을 확인한다.
const CODE = "x = 1\nif x:\n    print(x)";

async function openPy(page, body) {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "practice.py", mimeType: "text/x-python", buffer: Buffer.from(body, "utf8")
  });
  await expect(page.locator("textarea.code-input")).toBeVisible();
}

const editorValue = (page) => page.locator("textarea.code-input").inputValue();

test.describe("코드 따라치기", () => {
  test("교본을 흐리게 깔고, 맞으면 제 색·틀리면 빨강으로 표시한다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();

    await expect(page.locator(".code-edit.code-practice")).toHaveCount(1);
    await expect(page.locator(".code-practice .tp-ghost")).toHaveText(CODE);
    expect(await editorValue(page)).toBe(CODE);              // 본문은 건드리지 않는다

    await page.keyboard.type("x =");
    await expect(page.locator(".code-practice .tp-ok")).toHaveText("x =");
    await expect(page.locator(".code-practice .tp-bad")).toHaveCount(0);
    expect(await editorValue(page)).toBe(CODE);

    await page.keyboard.type("!");                            // 틀린 글자 — 관대 모드라 막지 않고 빨갛게만
    await expect(page.locator(".code-practice .tp-bad")).toHaveText("!");   // 내가 친 글자를 그대로 보여 준다
    expect(await editorValue(page)).toBe(CODE);               // 틀리게 쳐도 본문 글자는 밀리지 않는다

    await page.keyboard.press("Backspace");                   // 지우고 다시 치면 표시도 사라진다
    await expect(page.locator(".code-practice .tp-bad")).toHaveCount(0);
    await expect(page.locator(".code-practice .tp-ok")).toHaveText("x =");
  });

  // 정확도는 '지금 남아 있는 빨간 글자' 기준 — 틀린 걸 지우고 다시 똑바로 치면 도로 올라간다.
  test("틀린 자리를 고치면 정확도가 도로 올라간다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();
    const info = page.locator(".run-practice-info");

    await page.keyboard.type("x");
    await expect(info).toHaveText(/정확도 100%/);
    await page.keyboard.type("!");                            // 틀림
    await expect(info).not.toHaveText(/정확도 100%/);
    await page.keyboard.press("Backspace");
    await page.keyboard.type(" ");                            // 고쳐 씀
    await expect(info).toHaveText(/정확도 100%/);
  });

  test("줄 앞 들여쓰기는 자동으로 넘어가고, 편집 도우미는 끼어들지 않는다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();

    await page.keyboard.type("x = 1");
    await page.keyboard.press("Enter");                       // 자동 들여쓰기가 아니라 교본의 줄바꿈만
    await page.keyboard.type("if x:");
    await page.keyboard.press("Enter");                       // 다음 줄 4칸은 자동 통과
    expect(await editorValue(page)).toBe(CODE);

    await page.keyboard.type("print(");                       // 짝 괄호 자동 닫기가 꺼져 있어야 한다
    expect(await editorValue(page)).toBe(CODE);
    await expect(page.locator(".code-practice .tp-bad")).toHaveCount(0);
    await expect(page.locator(".code-practice .tp-ghost")).toHaveText("x)");
  });

  // 자동으로 넘어간 들여쓰기를 학생이 배운 대로 직접 또 치는 일이 잦다. 그걸 틀렸다고 세면 그때부터
  // 한 칸씩 밀려 맞게 친 뒷글자가 전부 빨개진다 — "맞게 쳤는데 빨간색" 의 진짜 원인이라 따로 지킨다.
  test("자동으로 넘어간 들여쓰기를 직접 또 쳐도 틀린 것으로 세지 않는다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();

    await page.keyboard.type("x = 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("if x:");
    await page.keyboard.press("Enter");
    await page.keyboard.type("    print(x)");                 // 4칸을 직접 치고 이어서 코드

    await expect(page.locator(".code-edit.code-practice")).toHaveCount(0);   // 빨간 표시 없이 그대로 완주
    await expect(page.locator(".run-practice")).toHaveText("따라치기");
    expect(await editorValue(page)).toBe(CODE);
  });

  // 줄 끝 공백은 화면에 보이지 않는다 — 여기서 Enter 를 쳤다고 틀렸다고 하면 억울하고, 뒤가 전부 밀린다.
  test("줄 끝의 안 보이는 공백은 Enter 로 그냥 넘어간다", async ({ page }) => {
    const trailing = "a = 1   \nb = 2";
    await openPy(page, trailing);
    await page.locator(".run-practice").click();

    await page.keyboard.type("a = 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("b = 2");

    await expect(page.locator(".code-edit.code-practice")).toHaveCount(0);
    expect(await editorValue(page)).toBe(trailing);
  });

  // 한글은 고정폭 글꼴에서 두 칸이라 영문 자리에 들어가면 그 줄이 통째로 밀린다 → 아예 넘어가지 않는다.
  test("영문 자리엔 한글이, 한글 자리엔 영문이 들어가지 않는다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();

    await page.keyboard.type("한");                            // 한/영 키를 안 누른 상태
    await expect(page.locator(".code-practice .tp-block")).toHaveText("x");   // 막힌 자리를 깜빡여 알린다
    await expect(page.locator(".code-practice .tp-ok")).toHaveCount(0);       // 한 칸도 나가지 않았다
    await expect(page.locator(".code-practice .tp-ghost")).toHaveText(CODE.slice(1));

    await page.keyboard.type("x");                             // 영문으로 바꿔 치면 그대로 진행
    await expect(page.locator(".code-practice .tp-ok")).toHaveText("x");
  });

  test("한글 자리(주석)에는 영문이 들어가지 않는다", async ({ page }) => {
    await openPy(page, "# 안녕\nx = 1");
    await page.locator(".run-practice").click();

    await page.keyboard.type("# ");
    await page.keyboard.type("a");                             // 한글 자리에 영문
    await expect(page.locator(".code-practice .tp-block")).toHaveText("안");
    await expect(page.locator(".code-practice .tp-ok")).toHaveText("# ");
  });

  test("끝까지 치면 스스로 끝나고 원래 코드 화면으로 돌아온다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();

    await page.keyboard.type("x = 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("if x:");
    await page.keyboard.press("Enter");
    await page.keyboard.type("print(x)");

    await expect(page.locator(".code-edit.code-practice")).toHaveCount(0);
    await expect(page.locator(".run-practice")).toHaveText("따라치기");
    expect(await editorValue(page)).toBe(CODE);
    await expect(page.locator(".code-pre .tp-ghost")).toHaveCount(0);   // 평소 구문 강조로 복귀
  });

  test("Esc 로 그만두면 본문이 그대로 남는다", async ({ page }) => {
    await openPy(page, CODE);
    await page.locator(".run-practice").click();
    await page.keyboard.type("x = ");
    await page.keyboard.press("Escape");

    await expect(page.locator(".code-edit.code-practice")).toHaveCount(0);
    expect(await editorValue(page)).toBe(CODE);
    await expect(page.locator(".run-practice")).toHaveText("따라치기");
  });
});
