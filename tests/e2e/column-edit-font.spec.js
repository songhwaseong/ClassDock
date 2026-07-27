const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// Alt+세로 드래그(열 편집)가 고정폭/가변폭 글꼴 모두에서 '가리킨 글자 경계'에 맞는지 확인한다.
async function openPy(page, body) {
  // 온보딩 모달은 로드 700ms 뒤에 뜬다 — 느린 실행에서 드래그 도중 튀어나와 입력을 삼키므로 미리 끈다.
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "col-edit.py",
    mimeType: "text/x-python",
    buffer: Buffer.from(body, "utf8")
  });
  await expect(page.locator("textarea.code-input")).toBeVisible();
}

// 편집기 좌표계: 줄 line 의 prefix 뒤 경계 x, 줄 중앙 y (클라이언트 좌표)
async function boundaryPoint(page, line, prefix) {
  return page.evaluate(({ line, prefix }) => {
    const ta = document.querySelector("textarea.code-input");
    const r = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta);
    const span = document.createElement("span");
    span.style.cssText = "position:fixed;visibility:hidden;white-space:pre;top:-9999px;left:0";
    span.style.fontFamily = cs.fontFamily;
    span.style.fontSize = cs.fontSize;
    span.style.fontWeight = cs.fontWeight;
    span.style.fontStyle = cs.fontStyle;
    span.style.fontVariantLigatures = cs.fontVariantLigatures;
    span.style.fontFeatureSettings = cs.fontFeatureSettings;
    span.style.fontKerning = cs.fontKerning;
    span.style.letterSpacing = cs.letterSpacing;
    span.style.tabSize = cs.tabSize;
    span.textContent = prefix;
    document.body.appendChild(span);
    const w = span.getBoundingClientRect().width;
    span.remove();
    const lh = parseFloat(cs.lineHeight);
    return {
      x: r.left + parseFloat(cs.paddingLeft) + w,
      y: r.top + parseFloat(cs.paddingTop) + line * lh + lh / 2
    };
  }, { line, prefix });
}

async function altDragInsert(page, prefix, lineFrom, lineTo, typed) {
  const a = await boundaryPoint(page, lineFrom, prefix);
  const b = await boundaryPoint(page, lineTo, prefix);
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.type(typed);
  return page.locator("textarea.code-input").inputValue();
}

test("column edit lands on the pointed boundary (monospace)", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openPy(page, "aaaa1111\naaaa2222\naaaa3333\n");
  const value = await altDragInsert(page, "aaaa", 0, 2, "|");
  expect(value).toBe("aaaa|1111\naaaa|2222\naaaa|3333\n");
  expect(errors).toEqual([]);
});

test("column edit lands on the pointed boundary (proportional font)", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openPy(page, "iiiiWWWW\niiiiMMMM\niiiimmmm\n");
  await page.evaluate(() => window.setCodeFontFamily("Malgun Gothic"));
  await expect(page.locator("textarea.code-input")).toHaveCSS("font-family", /Malgun Gothic/);
  const value = await altDragInsert(page, "iiii", 0, 2, "|");
  expect(value).toBe("iiii|WWWW\niiii|MMMM\niiii|mmmm\n");
  expect(errors).toEqual([]);
});

test("column edit uses the editor's disabled kerning when measuring a long prefix", async ({ page }) => {
  const prefix = "AV".repeat(24);
  await openPy(page, `${prefix}1111\n${prefix}2222\n${prefix}3333\n`);
  await page.evaluate(() => window.setCodeFontFamily("Segoe UI"));
  const value = await altDragInsert(page, prefix, 0, 2, "|");
  expect(value).toBe(`${prefix}|1111\n${prefix}|2222\n${prefix}|3333\n`);
});

test("column edit measures a prefix that ends in indentation spaces", async ({ page }) => {
  await openPy(page, "    iiii = 1\n    WWWW = 2\n    mmmm = 3\n");
  await page.evaluate(() => window.setCodeFontFamily("Malgun Gothic"));
  const value = await altDragInsert(page, "    ", 0, 2, "#");
  expect(value).toBe("    #iiii = 1\n    #WWWW = 2\n    #mmmm = 3\n");
});

test("column edit respects Korean full-width glyphs in a proportional font", async ({ page }) => {
  await openPy(page, "가나다라1111\n가나다라2222\n가나다라3333\n");
  await page.evaluate(() => window.setCodeFontFamily("Malgun Gothic"));
  const value = await altDragInsert(page, "가나다라", 0, 2, "|");
  expect(value).toBe("가나다라|1111\n가나다라|2222\n가나다라|3333\n");
});
