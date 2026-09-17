const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { buildPdf } = require("../fixtures/build-pdf");

/* 찾기 강조가 "찾은 글자 위"에 놓이는지 — 글자 수·줄 번호로 어림하던 자리가 어긋났던 두 경우. */

test("PDF 찾기: 좁은 글자 뒤의 넓은 글자도 제자리에 칠한다", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });   // 환영 창이 Ctrl+F 를 가로채지 않게
  await collapseSidebar(page);
  await page.goto("/");
  // Helvetica 폭: i=222, 공백=278, W=944 (1000분의 1 em). 글자 수로 나누면 WWWW 가 한참 오른쪽에 칠해진다.
  await page.locator("#fileInput").setInputFiles({ name: "a.pdf", mimeType: "application/pdf",
    buffer: buildPdf([["iiiiiiiiiiii WWWW"]]) });
  await expect(page.locator("#activeFileName")).toHaveText("a.pdf");
  await expect(page.locator("#content .page").first()).toBeVisible();
  await page.keyboard.press("Control+f");
  await page.locator(".pdf-find-input").fill("WWWW");
  const box = page.locator(".pdf-find-box").first();
  await expect(box).toBeVisible();
  const r = await box.evaluate(b => {
    const zoom = b.getBoundingClientRect().width / parseFloat(b.style.width);
    return { left: parseFloat(b.style.left), width: parseFloat(b.style.width),
      scale: b.closest(".page").getBoundingClientRect().width / zoom / 595 };
  });
  const expLeft = (72 + (12 * 222 + 278) * 24 / 1000) * r.scale, expW = 4 * 944 * 24 / 1000 * r.scale;
  expect(Math.abs(r.left - expLeft)).toBeLessThan(expW * 0.15);
  expect(Math.abs(r.width - expW)).toBeLessThan(expW * 0.15);
});

// 긴 줄이 접히는 줄바꿈 보기에서는 "줄 번호 × 줄높이"가 실제 자리보다 한참 위를 가리켰다.
const wrappedText = (lines) => Array.from({ length: lines }, (_, i) => ("줄" + i + " 가나다라마바사 ").repeat(40)).join("\n") +
  "\n앞말 TARGET_WORD here\n";
for (const [label, lines, boxSel] of [["일반 편집기", 60, ".find-hi-active"], ["가벼운 편집기(대용량)", 2600, ".lite-hit"]]){
  test("줄바꿈 보기 찾기: " + label + "도 찾은 곳으로 스크롤하고 칠한다", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("mn.textWrap", "1"); localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
    await collapseSidebar(page);
    await page.goto("/");
    await page.locator("#fileInput").setInputFiles({ name: "wrap.txt", mimeType: "text/plain", buffer: Buffer.from(wrappedText(lines)) });
    await expect(page.locator("#activeFileName")).toHaveText("wrap.txt");
    if (lines > 1000) await page.locator("#content .text-edit-btn", { hasText: "편집" }).first().click();
    else await page.locator("#content .code-host").first().click();
    await page.keyboard.press("Control+f");
    const ta = page.locator("textarea.code-input").first();
    await expect(ta).toBeVisible();
    const input = page.locator(".code-find-input:visible, .ro-find-input:visible").first();
    await input.fill("TARGET_WORD");
    await input.press("Enter");
    await expect(page.locator(boxSel).first()).toBeVisible();
    const r = await page.evaluate((sel) => {
      const t = document.querySelector("textarea.code-input"), tr = t.getBoundingClientRect();
      const b = document.querySelector(sel).getBoundingClientRect();
      return { wrap: t.wrap, top: b.top, bottom: b.bottom, taTop: tr.top, taBottom: tr.bottom };
    }, boxSel);
    expect(r.wrap).toBe("soft");
    expect(r.top).toBeGreaterThanOrEqual(r.taTop);
    expect(r.bottom).toBeLessThanOrEqual(r.taBottom);
  });
}

// 줄바꿈을 끈 긴 줄: 오른쪽 끝의 매치로 가면 가로로도 옮겨 보여 주고, 앞쪽 매치로 돌아오면 다시 왼쪽으로.
const wideText = (repeat) => Array.from({ length: repeat }, () =>
  "측정 시작\n" + "가나다라마바사 ".repeat(60) + "측정 끝\n짧은 줄\n").join("") + "마지막\n";
for (const [label, repeat, boxSel] of [["일반 편집기", 1, ".find-hi-active"], ["가벼운 편집기(대용량)", 2400, ".lite-hit"]]){
  test("긴 줄 찾기: " + label + "는 오른쪽 끝 매치로 가로 스크롤한다", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("mn.textWrap", "0"); localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
    await collapseSidebar(page);
    await page.goto("/");
    await page.locator("#fileInput").setInputFiles({ name: "wide.txt", mimeType: "text/plain", buffer: Buffer.from(wideText(repeat)) });
    await expect(page.locator("#activeFileName")).toHaveText("wide.txt");
    if (repeat > 1) await page.locator("#content .text-edit-btn", { hasText: "편집" }).first().click();
    else await page.locator("#content .code-host").first().dblclick();
    const ta = page.locator("textarea.code-input").first();
    await expect(ta).toBeVisible();
    await page.keyboard.press("Control+f");
    const input = page.locator(".code-find-input:visible, .ro-find-input:visible").first();
    await input.fill("측정");
    const boxInView = () => page.evaluate((sel) => {
      const t = document.querySelector("textarea.code-input"), tr = t.getBoundingClientRect();
      const b = document.querySelector(sel).getBoundingClientRect();
      return { scrollLeft: t.scrollLeft, inside: b.left >= tr.left && b.right <= tr.right && b.top >= tr.top && b.bottom <= tr.bottom,
        sel: t.value.slice(t.selectionStart, t.selectionEnd), before: t.value.slice(Math.max(0, t.selectionStart - 3), t.selectionStart) };
    }, boxSel);
    // 첫 매치(줄 맨 앞)에서 시작해 두 번째 매치(긴 줄 끝)로 간다.
    let r;
    for (let i = 0; i < 3; i++){
      await input.press("Enter");
      await page.waitForTimeout(100);
      r = await boxInView();
      if (r.before === "바사 ") break;                       // 긴 줄 끝의 "측정"
    }
    expect(r.before).toBe("바사 ");
    expect(r.scrollLeft).toBeGreaterThan(0);
    expect(r.inside).toBe(true);
    await input.press("Enter");                            // 다음 매치(다음 묶음의 줄 맨 앞)로 → 왼쪽으로 돌아온다
    await page.waitForTimeout(100);
    r = await boxInView();
    expect(r.scrollLeft).toBe(0);
    expect(r.inside).toBe(true);
  });
}
