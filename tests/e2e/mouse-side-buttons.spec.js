const { test, expect } = require("@playwright/test");

// 마우스 4·5번(뒤로/앞으로) 버튼은 Playwright 의 page.mouse 가 못 만든다(left/right/middle 뿐).
// CDP 로 직접 눌러 실제 브라우저 경로를 그대로 태운다 — 그래야 "뒤로가기가 정말 막히는지"까지 확인된다.
const BUTTON_MASK = { back: 8, forward: 16 };

async function openTwoDocs(page) {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles(
    { name: "ref-note.txt", mimeType: "text/plain", buffer: Buffer.from("참고용 문서", "utf8") });
  await expect(page.locator("#activeFileName")).toHaveText("ref-note.txt");
  await page.locator("#fileInput").setInputFiles(
    { name: "work-note.txt", mimeType: "text/plain", buffer: Buffer.from("작업용 문서", "utf8") });
  await expect(page.locator("#activeFileName")).toHaveText("work-note.txt");
  await expect(page.locator("#tabBar .tab")).toHaveCount(2);
}

async function pressSideButton(page, button) {
  const cdp = await page.context().newCDPSession(page);
  const common = { x: 400, y: 300, button, buttons: BUTTON_MASK[button], clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...common, buttons: 0 });
  await cdp.detach();
}

test("측면 버튼 뒤로/앞으로가 이전·다음 탭으로 이동한다", async ({ page }) => {
  await openTwoDocs(page);

  await pressSideButton(page, "back");
  await expect(page.locator("#activeFileName")).toHaveText("ref-note.txt");

  await pressSideButton(page, "forward");
  await expect(page.locator("#activeFileName")).toHaveText("work-note.txt");
});

test("설정을 꺼도 측면 버튼이 화면을 벗어나게 하지는 않는다", async ({ page }) => {
  // 돌아갈 히스토리 항목을 먼저 만들어 둔다 — 안 그러면 "뒤로가기가 막혔다"가 공짜로 통과한다.
  await page.goto("/?history-seed=1");
  await openTwoDocs(page);
  const before = page.url();
  await page.evaluate(() => { appSettings.mouseSideButtons = false; });

  await pressSideButton(page, "back");

  await expect(page.locator("#activeFileName")).toHaveText("work-note.txt");   // 탭 이동은 안 한다
  expect(page.url()).toBe(before);                                             // 페이지는 그대로
  await expect(page.locator("#tabBar .tab")).toHaveCount(2);                   // 열어 둔 문서도 살아 있다
});

test("모달이 열려 있으면 측면 버튼이 탭을 바꾸지도, 모달을 닫지도 않는다", async ({ page }) => {
  await openTwoDocs(page);
  await page.locator("#settingsOpen").click();
  await expect(page.locator("#settingsModal")).toBeVisible();

  await pressSideButton(page, "back");

  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#activeFileName")).toHaveText("work-note.txt");
});
