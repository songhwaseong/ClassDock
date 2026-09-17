const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 줄 번호로 이동(Ctrl+G): 찾기와 섞지 않은 전용 창.
// 치는 동안엔 화면만 미리 옮기고(캐럿은 그대로), Enter 로 확정, Esc 면 보던 자리로 되돌아온다.
const LONG = Array.from({ length: 200 }, (_, i) => "line" + (i + 1) + " = " + (i + 1)).join("\n");

async function openPy(page, body) {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "goto.py", mimeType: "text/x-python", buffer: Buffer.from(body, "utf8")
  });
  await expect(page.locator("textarea.code-input")).toBeVisible();
  await page.locator("textarea.code-input").click();
  await page.keyboard.press("Control+Home");     // 클릭한 자리가 아니라 항상 1줄에서 시작

}

const ta = (page) => page.locator("textarea.code-input");
const caretLine = (page) => ta(page).evaluate((el) => el.value.slice(0, el.selectionStart).split("\n").length);
const scrollTop = (page) => ta(page).evaluate((el) => el.scrollTop);

test.describe("줄 번호로 이동", () => {
  test("Ctrl+G 로 열고 숫자를 넣으면 그 줄로 캐럿이 간다", async ({ page }) => {
    await openPy(page, LONG);
    expect(await caretLine(page)).toBe(1);

    await page.keyboard.press("Control+g");
    await expect(page.locator(".code-goto")).toBeVisible();
    // 안내 문구는 한/EN 로 바뀌므로 숫자만 본다(전체 줄 수 → 고른 줄 / 전체).
    await expect(page.locator(".code-goto-hint")).toHaveText(/\b200\b/);

    await page.locator(".code-goto-input").fill("120");
    await expect(page.locator(".code-goto-hint")).toHaveText(/120\s*\/\s*200/);
    expect(await caretLine(page)).toBe(1);                 // 확정 전에는 캐럿을 옮기지 않는다
    expect(await scrollTop(page)).toBeGreaterThan(0);      // 화면만 미리 옮겨 보여 준다

    await page.keyboard.press("Enter");
    await expect(page.locator(".code-goto")).toBeHidden();
    expect(await caretLine(page)).toBe(120);
  });

  test("Esc 로 닫으면 보던 자리로 되돌아온다", async ({ page }) => {
    await openPy(page, LONG);
    await page.keyboard.press("Control+g");
    await page.locator(".code-goto-input").fill("180");
    expect(await scrollTop(page)).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(page.locator(".code-goto")).toBeHidden();
    expect(await scrollTop(page)).toBe(0);                 // 미리보기로 옮긴 화면을 원래대로
    expect(await caretLine(page)).toBe(1);
  });

  test("줄 수를 넘는 숫자는 마지막 줄로 당기고 그렇다고 알려 준다", async ({ page }) => {
    await openPy(page, LONG);
    await page.keyboard.press("Control+g");
    await page.locator(".code-goto-input").fill("9999");
    await expect(page.locator(".code-goto-hint")).toHaveClass(/is-bad/);
    await expect(page.locator(".code-goto-hint")).toHaveText(/\b200\b/);   // 마지막 줄로 당겼다고 알려 준다

    await page.keyboard.press("Enter");
    expect(await caretLine(page)).toBe(200);
  });

  test("숫자가 아니면 이동하지 않고 창도 열어 둔다", async ({ page }) => {
    await openPy(page, LONG);
    await page.keyboard.press("Control+g");
    await page.locator(".code-goto-input").fill("abc");
    await expect(page.locator(".code-goto-hint")).toHaveClass(/is-bad/);

    await page.keyboard.press("Enter");
    await expect(page.locator(".code-goto")).toBeVisible();
    expect(await caretLine(page)).toBe(1);
  });

  // 읽기 전용 보기(편집기가 아직 안 뜬 화면)에서도 같은 창을 쓴다 — 줄을 보러 가려고 편집 모드로
  // 넘어가지는 않는다. 대용량이라 편집이 잠긴 파일에서 유일한 이동 수단이기도 하다.
  test.describe("읽기 전용 보기", () => {
    async function openTxt(page) {
      await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
      await collapseSidebar(page);
      await page.goto("/");
      await page.locator("#fileInput").setInputFiles({
        name: "goto.txt", mimeType: "text/plain", buffer: Buffer.from(LONG, "utf8")
      });
      await expect(page.locator(".code-host")).toBeVisible();
      await expect(page.locator("textarea.code-input")).toHaveCount(0);   // 보기 화면으로 열린다
    }
    const wrapTop = (page) => page.locator(".code-host").evaluate((el) => el.scrollTop);
    // 노란 띠의 위치를 줄 번호로 되읽는다. 띠 높이는 글자 상자라 줄 간격보다 작으므로,
    // 나눗셈에는 본문(pre)의 line-height 를 쓴다.
    const jumpedLine = (page) => page.evaluate(() => {
      const bar = document.querySelector(".readonly-jump-line");
      const pre = document.querySelector(".code-host pre");
      if (!bar || bar.hidden || !pre) return 0;
      const cs = getComputedStyle(pre);
      const pt = parseFloat(cs.paddingTop) || 0, lh = parseFloat(cs.lineHeight) || 1;
      return Math.round((parseFloat(bar.style.top) - pt) / lh) + 1;
    });

    test("편집 모드로 넘어가지 않고 그 자리에서 이동한다", async ({ page }) => {
      await openTxt(page);
      await page.keyboard.press("Control+g");
      await expect(page.locator(".code-goto-flow")).toBeVisible();

      await page.locator(".code-goto-input").fill("120");
      await expect(page.locator(".code-goto-hint")).toHaveText(/120\s*\/\s*200/);
      await page.keyboard.press("Enter");

      await expect(page.locator(".code-goto")).toBeHidden();
      expect(await jumpedLine(page)).toBe(120);
      await expect(page.locator("textarea.code-input")).toHaveCount(0);   // 보기 화면 그대로
    });

    test("Esc 로 닫으면 보던 자리로 되돌아온다", async ({ page }) => {
      await openTxt(page);
      await page.keyboard.press("Control+g");
      await page.locator(".code-goto-input").fill("180");
      expect(await wrapTop(page)).toBeGreaterThan(0);

      await page.keyboard.press("Escape");
      await expect(page.locator(".code-goto")).toBeHidden();
      expect(await wrapTop(page)).toBe(0);
    });
  });

  // 따라치기 중 캐럿이 튀면 '지금 치는 자리'와 어긋나 채점이 통째로 밀린다 → 아예 막는다.
  test("따라치기 중에는 열리지 않는다", async ({ page }) => {
    await openPy(page, "x = 1\ny = 2");
    await page.locator(".run-practice").click();
    await expect(page.locator(".code-edit.code-practice")).toHaveCount(1);

    await page.keyboard.press("Control+g");
    await expect(page.locator(".code-goto")).toBeHidden();
    await expect(page.locator(".code-edit.code-practice")).toHaveCount(1);   // 연습도 계속된다
  });
});

/* 줄바꿈 보기: 긴 줄이 여러 줄로 접히면 "줄 번호 × 줄높이"는 실제 자리보다 한참 위를 가리킨다.
   맨 아래 짧은 줄(61줄)로 가면 그 줄이 화면 안에 있어야 한다 — 마커 글자의 실제 자리를 따로 재서 본다. */
const WRAPPED = Array.from({ length: 60 }, (_, i) => ("줄" + i + " 가나다라마바사 ").repeat(40)).join("\n") + "\nGOTO_MARK 끝줄\n";
for (const [label, repeat, mode] of [["일반 편집기", 1, "edit"], ["가벼운 편집기(대용량)", 45, "light"], ["읽기 전용 보기", 1, "view"]]){
  test("줄바꿈 보기에서도 " + label + "의 줄 이동이 그 줄을 보여 준다", async ({ page }) => {
    const body = Array.from({ length: repeat }, () => WRAPPED).join("");
    const target = WRAPPED.split("\n").length - 1;       // 첫 GOTO_MARK 줄(1-based)
    await page.addInitScript(() => { try { localStorage.setItem("mn.textWrap", "1"); localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
    await collapseSidebar(page);
    await page.goto("/");
    await page.locator("#fileInput").setInputFiles({ name: "wrap.txt", mimeType: "text/plain", buffer: Buffer.from(body, "utf8") });
    await expect(page.locator("#activeFileName")).toHaveText("wrap.txt");
    if (mode === "light") await page.locator("#content .text-edit-btn", { hasText: "편집" }).first().click();
    else if (mode === "edit") await page.locator("#content .code-host").first().dblclick();
    if (mode !== "view") await expect(ta(page)).toBeVisible();
    if (mode === "light") await expect(page.locator(".code-host-light")).toHaveCount(1);
    await page.keyboard.press("Control+g");
    await page.locator(".code-goto-input:visible").fill(String(target));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    // 마커 글자가 그려진 실제 자리: 편집기는 textarea 와 같은 규칙의 미러로, 보기는 Range 로 잰다.
    const r = await page.evaluate((mode) => {
      if (mode === "view"){
        const wrap = document.querySelector(".code-host-readonly");
        const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
        let node; while ((node = walker.nextNode())){
          const at = node.nodeValue.indexOf("GOTO_MARK");
          if (at < 0) continue;
          const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 9);
          const b = range.getBoundingClientRect(), w = wrap.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, viewTop: w.top, viewBottom: w.bottom };
        }
        return null;
      }
      const t = document.querySelector("textarea.code-input"), cs = getComputedStyle(t);
      const m = document.createElement("div");
      m.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;box-sizing:border-box";
      for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "padding", "whiteSpace", "overflowWrap", "wordBreak", "letterSpacing", "tabSize"]) m.style[k] = cs[k];
      m.style.width = t.clientWidth + "px";
      const at = t.value.indexOf("GOTO_MARK");
      const span = document.createElement("span"); span.textContent = "GOTO_MARK";
      m.append(t.value.slice(0, at), span);
      document.body.appendChild(m);
      const top = span.getBoundingClientRect().top - m.getBoundingClientRect().top - t.scrollTop;
      m.remove();
      const tr = t.getBoundingClientRect();
      const band = document.querySelector(".jump-line:not([hidden])");
      const bb = band && band.getBoundingClientRect();
      return { top: tr.top + top, bottom: tr.top + top + parseFloat(cs.lineHeight), viewTop: tr.top, viewBottom: tr.bottom,
        caret: t.value.slice(0, t.selectionStart).split("\n").length, band: bb ? { top: bb.top, bottom: bb.bottom } : null };
    }, mode);
    expect(r).not.toBeNull();
    expect(r.top).toBeGreaterThanOrEqual(r.viewTop);
    expect(r.bottom).toBeLessThanOrEqual(r.viewBottom);
    if (mode !== "view") expect(r.caret).toBe(target);
    if (mode === "edit"){                                   // 노란 띠도 그 줄 위에
      expect(r.band).not.toBeNull();
      expect(Math.abs(r.band.top - r.top)).toBeLessThan(4);
    }
  });
}
