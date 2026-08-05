const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 텍스트 파일: 읽기 전용 보기 ↔ 편집을 오갈 때 '보던 자리'가 그대로 남아야 한다.
// 예전엔 편집기에서 '보기로'를 누르면 보기 화면을 처음부터 다시 그려서 늘 파일 맨 위로 튀었고,
// 방금 고친 줄을 다시 스크롤해 찾아 내려가야 했다.
const LONG = Array.from({ length: 400 }, (_, i) => "line" + (i + 1) + " 내용 " + (i + 1)).join("\n");
// 6000줄이 넘으면 보기 화면이 청크(가상 렌더)로 그려진다 — 청크마다 붙는 여백 때문에
// 스크롤 값을 그대로 복사하면 편집기가 점점 다른 자리에서 열렸다.
const HUGE = Array.from({ length: 9000 }, (_, i) => "line" + (i + 1) + " 내용 " + (i + 1)).join("\n");
// 아주 긴 줄이 섞인 문서 — 가로 스크롤이 생긴다. 짧은 줄로 돌아올 때 그 가로 스크롤을 그대로
// 물려받으면 글자가 거터 아래로 숨어 화면이 깨진 것처럼 보였다.
const WIDE = (() => {
  const rows = [];
  for (let i = 1; i <= 60; i++) rows.push(i % 2 ? "" : "설명 " + i + " 번째 줄입니다.");
  rows.push("표: " + Array.from({ length: 80 }, (_, i) => "항목" + i + " 값" + i).join(" | "));
  for (let i = 62; i <= 140; i++) rows.push(i % 2 ? "" : "응답 객체에는 사용량 정보가 포함됩니다. " + i);
  return rows.join("\n");
})();

async function openTxt(page, body, name){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: name || "long.txt", mimeType: "text/plain", buffer: Buffer.from(body || LONG, "utf8")
  });
  await expect(page.locator(".code-host-readonly")).toBeVisible();
}

// 편집기의 캐럿 줄과, 그 줄이 화면의 어느 높이에 있는지.
const editorCaret = (page) => page.evaluate(() => {
  const ta = document.querySelector("textarea.code-input");
  const cs = getComputedStyle(ta);
  const lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop);
  const line = ta.value.slice(0, ta.selectionStart).split("\n").length;
  return {
    line,
    clientY: ta.getBoundingClientRect().top + pad + (line - 1) * lh - ta.scrollTop,
    firstVisibleLine: Math.max(1, Math.round((ta.scrollTop - pad) / lh) + 1)
  };
});

// 읽기 화면에서 그 줄(1-based)의 화면 y 좌표. 없으면 null.
const lineClientY = (page, line) => page.evaluate((n) => {
  const host = document.querySelector(".code-host-readonly");
  if (!host) return null;
  const gutter = host.querySelector(".code-gutter");
  const pre = host.querySelector(".code-pre");
  if (!gutter || !pre) return null;
  const cs = getComputedStyle(pre);
  const lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop);
  return pre.getBoundingClientRect().top + pad + (n - 1) * lh;
}, line);

test.describe("텍스트 보기 ↔ 편집 위치 유지", () => {
  test("편집하다 '보기로' 누르면 편집하던 줄이 화면의 같은 높이에 남는다", async ({ page }) => {
    await openTxt(page);

    // 아래쪽으로 스크롤한 뒤 그 자리를 더블클릭 → 편집 모드(이 자리에서 이어서 편집)
    const host = page.locator(".code-host-readonly");
    await host.evaluate((el) => { el.scrollTop = 2000; });
    const box = await host.boundingBox();
    await page.mouse.dblclick(box.x + 120, box.y + 140);   // 거터를 피해 본문 글자를 겨냥
    await expect(page.locator("textarea.code-input")).toBeVisible();

    const before = await editorCaret(page);
    expect(before.line).toBeGreaterThan(50);          // 맨 위가 아니라 실제로 아래쪽 줄을 잡았다

    await page.type("textarea.code-input", "X");      // 편집(저장하지 않아도 자리 유지)
    await page.locator("button.run-revert").click();  // '보기로'
    await expect(page.locator(".code-host-readonly")).toBeVisible();

    const after = await lineClientY(page, before.line);
    expect(after).not.toBeNull();
    expect(Math.abs(after - before.clientY)).toBeLessThan(24);   // 같은 줄이 화면의 같은 높이(한 줄 오차 안)
    await expect(page.locator(".readonly-jump-line")).toBeHidden();   // 화면이 그대로 이어지므로 노란 줄 표시는 없다
  });

  test("✎ 편집 버튼도 보던 자리에서 열린다(맨 위로 튀지 않는다)", async ({ page }) => {
    await openTxt(page);
    const host = page.locator(".code-host-readonly");

    // 먼저 맨 위 본문에 선택을 남겨 둔다. 스크롤하더라도 DOM 선택은 그 자리에 계속 남는다.
    await host.evaluate((el) => {
      const node = el.querySelector(".code-pre code").firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await host.evaluate((el) => { el.scrollTop = 2000; });

    // 보기 화면에서 지금 맨 위에 걸린 줄
    const topLine = await host.evaluate((el) => {
      const pre = el.querySelector(".code-pre"), cs = getComputedStyle(pre);
      const lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop);
      return Math.max(1, Math.round((el.getBoundingClientRect().top - pre.getBoundingClientRect().top - pad) / lh) + 1);
    });
    expect(topLine).toBeGreaterThan(50);

    await page.locator(".text-view-bar button", { hasText: "편집" }).click();   // 화면 밖의 예전 선택은 무시
    await expect(page.locator("textarea.code-input")).toBeVisible();

    const after = await editorCaret(page);
    expect(Math.abs(after.firstVisibleLine - topLine)).toBeLessThanOrEqual(2);   // 같은 줄이 맨 위에
    expect(Math.abs(after.line - topLine)).toBeLessThanOrEqual(2);               // 캐럿도 그 자리에서 시작
  });

  test("청크로 그려지는 대용량 파일도 더블클릭한 줄이 화면의 같은 높이에서 열린다", async ({ page }) => {
    await openTxt(page, HUGE, "huge.txt");
    const host = page.locator(".code-host-readonly");
    await expect(page.locator(".code-chunk").first()).toBeAttached();   // 청크 렌더가 맞는지 확인
    await host.evaluate((el) => { el.scrollTop = 40000; });

    const box = await host.boundingBox();
    const clickY = box.y + box.height * 0.5;                            // 가운데를 겨냥(아래끝 보정에 걸리지 않게)
    await page.mouse.dblclick(box.x + 120, clickY);
    await expect(page.locator("textarea.code-input")).toBeVisible();

    const after = await editorCaret(page);
    expect(after.line).toBeGreaterThan(1000);                           // 실제로 깊은 줄을 잡았다
    expect(Math.abs(after.clientY - clickY)).toBeLessThan(45);          // 더블클릭한 높이 그대로(두 줄 오차 안)
  });

  test("짧은 줄로 돌아올 땐 가로 스크롤이 따라오지 않는다", async ({ page }) => {
    await openTxt(page, WIDE, "wide.txt");
    const host = page.locator(".code-host-readonly");
    await host.evaluate((el) => { el.scrollTop = 1500; });

    const box = await host.boundingBox();
    await page.mouse.dblclick(box.x + 200, box.y + 200);                // 짧은 한글 줄
    await expect(page.locator("textarea.code-input")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector("textarea.code-input").scrollLeft)).toBe(0);

    // 편집 중 긴 줄을 보려고 가로로 스크롤한 상태에서 '보기로'
    await page.evaluate(() => { document.querySelector("textarea.code-input").scrollLeft = 400; });
    await page.locator("button.run-revert").click();
    await expect(host).toBeVisible();

    const back = await host.evaluate((el) => {
      const pre = el.querySelector(".code-pre"), gutter = el.querySelector(".code-gutter");
      return { scrollLeft: el.scrollLeft, preLeft: pre.getBoundingClientRect().left,
        gutterRight: gutter.getBoundingClientRect().right };
    });
    expect(back.scrollLeft).toBe(0);                                    // 짧은 줄엔 가로 스크롤이 의미 없다
    expect(back.preLeft).toBeGreaterThanOrEqual(back.gutterRight - 1);  // 글자가 줄번호 아래로 숨지 않는다
  });

  test("긴 줄을 보던 가로 위치는 편집기로 이어진다", async ({ page }) => {
    await openTxt(page, WIDE, "wide.txt");
    const host = page.locator(".code-host-readonly");
    await host.evaluate((el) => { el.scrollTop = 1120; el.scrollLeft = 600; });

    const box = await host.boundingBox();
    await page.mouse.dblclick(box.x + 200, box.y + 160);                // 긴 줄(표)의 오른쪽 부분
    await expect(page.locator("textarea.code-input")).toBeVisible();

    const ta = await page.evaluate(() => {
      const el = document.querySelector("textarea.code-input");
      return { line: el.value.slice(0, el.selectionStart).split("\n").length, scrollLeft: el.scrollLeft };
    });
    expect(ta.line).toBe(61);                                           // 긴 줄을 잡았다
    expect(ta.scrollLeft).toBe(600);                                    // 보던 가로 위치 그대로
  });
});
