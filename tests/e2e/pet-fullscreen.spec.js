const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* ⛶ 문서 전체화면에서도 픽셀펫이 보여야 한다.
 *
 * #content 만 전체화면으로 올리면 브라우저는 그 요소의 자손만 그린다.
 * body 에 붙어 있던 펫은 z-index 와 무관하게 통째로 사라지므로,
 * 전체화면을 드나들 때 펫을 전체화면 요소 안팎으로 옮겨 붙여야 한다.
 */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

// requestFullscreen 은 사용자 제스처가 있어야 허용된다. 클릭은 본문 위 오버레이(#dropzone)가
// 가져가므로 키 입력을 쓴다 — 키 입력도 사용자 제스처라 전체화면 요청이 허용된다.
async function keyToRun(page, fnName){
  await page.evaluate((name) => {
    window.__fsGesture = (e) => {
      if (e.key !== "F9") return;
      window.removeEventListener("keydown", window.__fsGesture, true);
      window[name]();
    };
    window.addEventListener("keydown", window.__fsGesture, true);
  }, fnName);
  await page.keyboard.press("F9");
}

const petHostName = (page) => page.evaluate(() => {
  const el = document.querySelector(".pixel-pet");
  if (!el) return "(펫 없음)";
  const parent = el.parentElement;
  return parent === document.body ? "body" : (parent.id || parent.tagName.toLowerCase());
});

test("문서 전체화면을 드나들면 펫이 전체화면 요소 안팎으로 따라 옮겨진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);

  await page.evaluate(() => petStart(1));
  await expect(page.locator(".pixel-pet")).toHaveCount(1);
  expect(await petHostName(page)).toBe("body");

  await keyToRun(page, "enterViewerFullscreen");
  await page.waitForFunction(() => document.fullscreenElement === document.getElementById("content"));
  await expect.poll(() => petHostName(page)).toBe("content");

  await keyToRun(page, "exitViewerFullscreen");
  await page.waitForFunction(() => !document.fullscreenElement);
  // fullscreenElement 는 fullscreenchange 가 도착하기 직전에 먼저 바뀐다 — 이벤트 처리까지 기다린다
  await expect.poll(() => petHostName(page)).toBe("body");

  await page.evaluate(() => petStop());
  expect(errors).toEqual([]);
});

test("전체화면 중에 태어난 펫도 전체화면 요소 안에 붙는다", async ({ page }) => {
  await boot(page);

  await keyToRun(page, "enterViewerFullscreen");
  await page.waitForFunction(() => document.fullscreenElement === document.getElementById("content"));

  await page.evaluate(() => petStart(1));
  await expect(page.locator(".pixel-pet")).toHaveCount(1);
  expect(await petHostName(page)).toBe("content");

  await page.evaluate(() => petStop());
  await keyToRun(page, "exitViewerFullscreen");
});
