const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { buildPdf } = require("../fixtures/build-pdf");

// PDF 위에 올려놓은 체크(✓)를 복사해 다른 쪽에 붙이고, 컨트롤 바 복제 버튼으로 같은 쪽에 하나 더 만든다.
// 신뢰 이벤트 없이 clipboardData 를 실어 copy/paste 를 보낸다(Ctrl+C / Ctrl+V 와 같은 경로).
async function clip(page, type, carry){
  return page.evaluate(({ type, carry }) => {
    const data = new DataTransfer();
    if (carry) for (const [k, v] of Object.entries(carry)) data.setData(k, v);
    document.body.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
    const out = {};
    for (const k of data.types) out[k] = data.getData(k);
    return out;
  }, { type, carry });
}

test("PDF 체크를 복사해 다른 쪽에 붙이고 복제 버튼으로 하나 더 만든다", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "신청서.pdf", mimeType: "application/pdf", buffer: buildPdf([["page one"], ["page two"]])
  });
  await expect(page.locator("#activeFileName")).toHaveText("신청서.pdf");
  await expect.poll(() => page.evaluate(() => state.pages.length)).toBe(2);

  // 체크 하나 올리고 글 고치기를 끝낸 뒤 약간 옮긴 자리·색을 기억한다.
  await page.evaluate(() => {
    const el = addTextElement("check", { pageIndex: 0, fontSize: 40, color: "#dc2626", bold: true, text: "✓" });
    el.querySelector(".text-edit").blur();
    el.style.left = "120px"; el.style.top = "150px";
    selectEl(el, state);
  });
  const copied = await clip(page, "copy");
  expect(copied["application/x-classdock-pdf-item"]).toContain("\"kind\":\"check\"");

  await page.evaluate(() => goToPdfPage(state, 2));
  await expect.poll(() => page.evaluate(() => currentPageIndex(state))).toBe(1);
  await clip(page, "paste", copied);

  const pasted = await page.evaluate(() => {
    const e = state.elements[state.elements.length - 1];
    const t = e.el.querySelector(".text-edit");
    return { count: state.elements.length, pageIndex: e.pageIndex, left: e.el.offsetLeft, top: e.el.offsetTop,
      text: t.textContent, size: getComputedStyle(t).fontSize, color: getComputedStyle(t).color,
      selected: state.selected === e.el };
  });
  expect(pasted).toEqual({ count: 2, pageIndex: 1, left: 120, top: 150, text: "✓",
    size: "40px", color: "rgb(220, 38, 38)", selected: true });

  // 같은 쪽에 다시 붙이면 비켜 난다.
  await clip(page, "paste", copied);
  const again = await page.evaluate(() => { const el = state.elements[2].el; return [el.offsetLeft, el.offsetTop]; });
  expect(again).toEqual([136, 166]);

  // 그 사이 다른 것을 복사했으면(전용 형식이 없음) 붙지 않는다.
  await clip(page, "paste", { "text/plain": "hello" });
  expect(await page.evaluate(() => state.elements.length)).toBe(3);

  // 컨트롤 바 복제 버튼
  await page.locator(".placed.selected .ctrl button.dup").click();
  const dup = await page.evaluate(() => {
    const e = state.elements[state.elements.length - 1];
    return { count: state.elements.length, pageIndex: e.pageIndex, left: e.el.offsetLeft, top: e.el.offsetTop };
  });
  expect(dup).toEqual({ count: 4, pageIndex: 1, left: 152, top: 182 });

  // Esc 로 선택(컨트롤 바)이 풀린다.
  await expect(page.locator(".placed.selected .ctrl")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".placed.selected")).toHaveCount(0);
  expect(await page.evaluate(() => state.selected)).toBeNull();

  // 글을 고치는 중에 Esc 를 눌러도 고치기가 끝나고 선택이 풀린다.
  await page.evaluate(() => addTextElement("text", { pageIndex: 1, text: "메모" }));
  await expect(page.locator(".placed.selected .text-edit[contenteditable='true']")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".placed.selected")).toHaveCount(0);
  await expect(page.locator(".placed .text-edit[contenteditable='true']")).toHaveCount(0);
  await page.evaluate(() => undoPdfEdit(state));
  await expect.poll(() => page.evaluate(() => state.elements.length)).toBe(4);

  // 되돌리기로 복제가 취소된다.
  await page.evaluate(() => undoPdfEdit(state));
  await expect.poll(() => page.evaluate(() => state.elements.length)).toBe(3);
});
