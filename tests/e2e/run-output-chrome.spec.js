const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 실행 화면의 결과 칸 조작 — 파이썬·자바스크립트·자바가 모두 같은 자리, 같은 버튼을 쓴다.
   숨기기는 실행 바가 아니라 결과 칸 오른쪽 위에 있고, 결과 칸은 편집기 옆 ↔ 아래로 옮길 수 있다.
   자바는 실행에 EXE 런처의 JDK 가 필요해 브라우저에서는 실패하지만, ▶ 를 누른 순간 결과 칸이
   열리는 것은 같으므로 배치·조작은 여기서 그대로 확인할 수 있다. */
const JAVA_SOURCE = 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hi");\n    }\n}\n';
const JS_SOURCE = 'console.log("hi");\n';

async function openCode(page, name, mimeType, body, splitKey){
  await page.addInitScript((key) => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.removeItem(key); } catch(_){}
  }, splitKey);
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name, mimeType, buffer: Buffer.from(body, "utf8") });
  await expect(page.locator("textarea.code-input")).toBeVisible();
}

// 세 실행 화면이 같은 계약을 지키는지 한 벌로 확인한다.
async function checkOutputChrome(page, splitKey){
  // 실행 바에는 '결과 숨기기' 글자 버튼이 없다(결과 칸으로 옮겼다).
  await expect(page.locator(".run-bar .run-revert", { hasText: "결과 숨기기" })).toHaveCount(0);
  // 숨기기 버튼은 결과 칸의 자식이다.
  await expect(page.locator(".code-output .out-hide")).toHaveCount(1);
  // 결과가 아직 없으면 위치 토글은 숨어 있다.
  await expect(page.locator(".run-bar .run-layout")).toBeHidden();

  await page.locator(".run-bar .run-go").click();
  await expect(page.locator(".run-split.show-out")).toHaveCount(1);
  const layout = page.locator(".run-bar .run-layout");
  await expect(layout).toBeVisible();
  await expect(layout).toHaveText("Below");
  await expect(page.locator(".code-output .out-hide")).toBeVisible();

  // 아래로 옮기면 분할이 세로가 되고 분할선 방향도 함께 바뀐다.
  await layout.click();
  await expect(page.locator(".run-split.stack-v")).toHaveCount(1);
  await expect(layout).toHaveText("Side");
  await expect(page.locator(".run-split .run-divider")).toHaveAttribute("aria-orientation", "horizontal");
  expect(await page.evaluate((key) => localStorage.getItem(key), splitKey)).toBe("col");

  // 결과 칸을 통째로 갈아끼우는 렌더러가 지나가도 숨기기 버튼은 그대로 남는다.
  await expect(page.locator(".code-output .out-hide")).toHaveCount(1);

  // 숨기기: 결과 칸만 접히고 위치 토글은 남는다(다음 실행 위치를 미리 고를 수 있게).
  await page.locator(".code-output .out-hide").click();
  await expect(page.locator(".run-split.show-out")).toHaveCount(0);
  await expect(layout).toBeVisible();

  // 위치 토글을 다시 누르면 결과 칸이 그 자리로 돌아온다.
  await layout.click();
  await expect(page.locator(".run-split.show-out")).toHaveCount(1);
  await expect(page.locator(".run-split.stack-v")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), splitKey)).toBe("row");
}

test.describe("실행 결과 칸", () => {
  test("자바: 숨기기는 결과 칸 안에 있고, 결과를 편집기 아래·옆으로 옮길 수 있다", async ({ page }) => {
    await openCode(page, "Main.java", "text/x-java-source", JAVA_SOURCE, "javaSplitDir");
    await checkOutputChrome(page, "javaSplitDir");
  });

  test("자바스크립트: 숨기기는 결과 칸 안에 있고, 결과를 편집기 아래·옆으로 옮길 수 있다", async ({ page }) => {
    await openCode(page, "practice.js", "text/javascript", JS_SOURCE, "jsSplitDir");
    await checkOutputChrome(page, "jsSplitDir");
    // 실제로 실행된 결과 위에서도 버튼이 헤더 안에 남아 있다.
    await expect(page.locator(".code-output .out-pre")).toContainText("hi");
    await expect(page.locator(".code-output .out-head .out-hide")).toHaveCount(1);
  });
});
