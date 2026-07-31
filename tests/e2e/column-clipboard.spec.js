const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// Alt+세로 드래그로 잡은 사각 선택의 복사·잘라내기·붙여넣기.
// 사각 선택은 textarea 의 네이티브 선택이 아니라 오버레이 그림이라 기본 복사로는 아무것도 담기지 않는다
// → 편집기가 줄마다 선택 구간을 직접 잘라 클립보드에 넣는지 확인한다.
async function openPy(page, body) {
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){}
    // 클립보드는 실제로 건드리지 않고 무엇을 담으려 했는지만 기록한다(권한·OS 클립보드에 기대지 않게).
    window.__copied = [];
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } }
      });
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "col-clip.py",
    mimeType: "text/x-python",
    buffer: Buffer.from(body, "utf8")
  });
  await expect(page.locator("textarea.code-input")).toBeVisible();
  await settleEditor(page);
}

// 실행 패널이 자리를 잡으며 편집 영역이 밀린다 — 위치가 멎은 뒤에 좌표를 잰다(column-edit-font.spec.js 와 같은 이유).
async function settleEditor(page) {
  await page.waitForFunction(() => {
    const ta = document.querySelector("textarea.code-input");
    if (!ta) return false;
    const top = ta.getBoundingClientRect().top;
    const stable = window.__prevTop !== undefined && Math.abs(window.__prevTop - top) < 0.5;
    window.__prevTop = top;
    window.__stableFrames = stable ? (window.__stableFrames || 0) + 1 : 0;
    return window.__stableFrames >= 5;
  }, null, { polling: "raf" });
}

// 줄 line 의 prefix 뒤 경계 x, 줄 중앙 y (클라이언트 좌표)
async function boundaryPoint(page, line, prefix) {
  return page.evaluate(({ line, prefix }) => {
    const ta = document.querySelector("textarea.code-input");
    const r = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta);
    const span = document.createElement("span");
    span.style.cssText = "position:fixed;visibility:hidden;white-space:pre;top:-9999px;left:0";
    span.style.fontFamily = cs.fontFamily;
    span.style.fontSize = cs.fontSize;
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

// (lineFrom, fromPrefix 끝) → (lineTo, toPrefix 끝) 사각 선택
async function altDragSelect(page, lineFrom, fromPrefix, lineTo, toPrefix) {
  const a = await boundaryPoint(page, lineFrom, fromPrefix);
  const b = await boundaryPoint(page, lineTo, toPrefix);
  const onEditor = await page.evaluate(({ a, b }) => {
    const ta = document.querySelector("textarea.code-input");
    const at = (p) => {
      const el = document.elementFromPoint(p.x, p.y);
      return el === ta ? "ok" : (el ? el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] : "(없음)");
    };
    return { from: at(a), to: at(b) };
  }, { a, b });
  expect(onEditor).toEqual({ from: "ok", to: "ok" });

  await page.mouse.move(a.x, a.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  // 선택 박스가 실제로 그려졌는지(열 모드 진입) 확인
  await expect(page.locator(".col-sel").first()).toBeVisible();
}

// 신뢰 이벤트 없이 clipboardData 를 실어 보내는 붙여넣기(Ctrl+V 와 같은 경로)
async function pasteText(page, text) {
  await page.evaluate((value) => {
    const ta = document.querySelector("textarea.code-input");
    const data = new DataTransfer();
    data.setData("text", value);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const BODY = "aaaa1111\nbbbb2222\ncccc3333\n";

test("column copy puts the selected rectangle on the clipboard", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openPy(page, BODY);
  await altDragSelect(page, 0, "aaaa", 2, "cccc3333");
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual(["1111\n2222\n3333"]);
  expect(await page.locator("textarea.code-input").inputValue()).toBe(BODY);   // 복사는 본문을 건드리지 않는다
  expect(errors).toEqual([]);
});

test("column cut copies and removes the rectangle", async ({ page }) => {
  await openPy(page, BODY);
  await altDragSelect(page, 0, "aaaa", 2, "cccc3333");
  await page.keyboard.press("Control+x");
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual(["1111\n2222\n3333"]);
  expect(await page.locator("textarea.code-input").inputValue()).toBe("aaaa\nbbbb\ncccc\n");
});

test("column paste spreads one row per selected line", async ({ page }) => {
  await openPy(page, BODY);
  await altDragSelect(page, 0, "aaaa", 2, "cccc3333");
  await pasteText(page, "XX\nYY\nZZ");
  expect(await page.locator("textarea.code-input").inputValue()).toBe("aaaaXX\nbbbbYY\nccccZZ\n");
});

test("single-line paste goes into every selected line", async ({ page }) => {
  await openPy(page, BODY);
  await altDragSelect(page, 0, "aaaa", 2, "cccc3333");
  await pasteText(page, "##");
  expect(await page.locator("textarea.code-input").inputValue()).toBe("aaaa##\nbbbb##\ncccc##\n");
});
