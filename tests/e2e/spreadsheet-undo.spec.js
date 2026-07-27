const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 표 편집기의 되돌리기·다시실행 동작을 화면 기준으로 고정한다.
// "새 표"는 진짜 XLSX 를 만들어 편집 모드로 열기 때문에, CSV 의 copy-on-write 가 아니라
// 시트 전체를 복제하는 무거운 경로를 그대로 지나간다.

async function openSheet(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newSpreadsheetScratch());
  await expect(page.locator('td[data-mcol]').first()).toBeVisible();
}

const cell = (page, r, c) => page.locator(`td[data-mrow="${r}"][data-mcol="${c}"]`);
// 다른 편집기의 되돌리기 버튼도 DOM 에 있으므로 표 편집 도구모음으로 좁힌다.
const undoBtn = (page) => page.locator('.xlsx-editgroup-history button[title*="되돌리기"]');
const redoBtn = (page) => page.locator('.xlsx-editgroup-history button[title*="다시실행"]');

// 셀을 더블클릭해 값을 넣고 Enter 로 확정
async function typeCell(page, r, c, text){
  const td = cell(page, r, c);
  await td.dblclick();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect.poll(() => cell(page, r, c).innerText()).toBe(text);
}

const textOf = (page, r, c) => cell(page, r, c).innerText();

test("표: 셀 편집을 되돌리고 다시 실행한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSheet(page);

  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeDisabled();

  await typeCell(page, 0, 0, "가");
  await expect(undoBtn(page)).toBeEnabled();
  await typeCell(page, 0, 1, "나");

  // 되돌리기 두 번 → 값이 실제로 사라져야 한다
  await undoBtn(page).click();
  await expect.poll(() => textOf(page, 0, 1)).toBe("");
  await expect.poll(() => textOf(page, 0, 0)).toBe("가");

  await undoBtn(page).click();
  await expect.poll(() => textOf(page, 0, 0)).toBe("");
  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeEnabled();

  // 다시실행 → 되살아나야 한다
  await redoBtn(page).click();
  await expect.poll(() => textOf(page, 0, 0)).toBe("가");
  await redoBtn(page).click();
  await expect.poll(() => textOf(page, 0, 1)).toBe("나");
  await expect(redoBtn(page)).toBeDisabled();

  expect(errors).toEqual([]);
});

test("표: 되돌린 뒤 새로 편집하면 다시실행 기록은 버려진다", async ({ page }) => {
  await openSheet(page);
  await typeCell(page, 0, 0, "가");
  await typeCell(page, 0, 1, "나");

  await undoBtn(page).click();
  await expect.poll(() => textOf(page, 0, 1)).toBe("");
  await expect(redoBtn(page)).toBeEnabled();

  await typeCell(page, 1, 0, "새값");                 // 새 갈래
  await expect(redoBtn(page)).toBeDisabled();

  await undoBtn(page).click();
  await expect.poll(() => textOf(page, 1, 0)).toBe("");
  await expect.poll(() => textOf(page, 0, 0)).toBe("가");
});

test("표: Ctrl+Z / Ctrl+Y 단축키도 같은 히스토리를 쓴다", async ({ page }) => {
  await openSheet(page);
  await typeCell(page, 0, 0, "가");

  await page.locator('.selectable-sheet').first().click();   // 셀 편집 밖에서 눌러야 히스토리 단축키가 동작
  await page.keyboard.press("Control+z");
  await expect.poll(() => textOf(page, 0, 0)).toBe("");
  await page.keyboard.press("Control+y");
  await expect.poll(() => textOf(page, 0, 0)).toBe("가");
});

test("표: 행 삭제 같은 구조 변경도 되돌린다", async ({ page }) => {
  await openSheet(page);
  await typeCell(page, 0, 0, "첫줄");
  await typeCell(page, 1, 0, "둘째줄");

  // 2행의 셀을 선택한 뒤 '행·열·시트' 메뉴를 열어 '선택행 삭제'
  await cell(page, 1, 0).click();
  await page.locator('.xlsx-tool-menu-structure > summary').click();
  await page.locator('button[title="현재 선택한 행 삭제"]').click();
  await expect.poll(() => textOf(page, 1, 0)).not.toBe("둘째줄");

  await undoBtn(page).click();
  await expect.poll(() => textOf(page, 1, 0)).toBe("둘째줄");
  await expect.poll(() => textOf(page, 0, 0)).toBe("첫줄");
});
