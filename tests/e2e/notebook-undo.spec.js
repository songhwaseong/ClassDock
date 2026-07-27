const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 노트북 셀 작업(추가·삭제·형식 변경)의 되돌리기·다시실행을 화면 기준으로 고정한다.
// 스냅샷이 노트북 전체 ipynb 문자열이라, 단계 수(24)뿐 아니라 총 용량(12MB) 상한도 함께 걸린다.

async function openNotebook(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newNotebookScratch());
  await expect(page.locator(".nbv-cell").first()).toBeVisible();
}

const undoBtn = (page) => page.locator('.nbv-history[title*="되돌리기"]');
const redoBtn = (page) => page.locator('.nbv-history[title*="다시 실행"]');
const cellCount = (page) => page.locator(".nbv-cell").count();
const cellTypes = (page) => page.evaluate(() => {
  const all = (typeof docs !== "undefined") ? docs : [];
  const doc = all.find(d => d.notebookModel);
  return doc ? doc.notebookModel.cells.map(c => c.type) : [];
});

// 명령 모드(셀 선택 상태)로 들어간 뒤 키를 누른다
async function commandKey(page, key){
  await page.locator(".nbv-cell").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press(key);
}

test("노트북: 셀 추가를 되돌리고 다시 실행한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openNotebook(page);

  await expect(undoBtn(page)).toBeDisabled();
  const before = await cellCount(page);

  await commandKey(page, "b");                       // 아래에 코드 셀 추가
  await expect.poll(() => cellCount(page)).toBe(before + 1);
  await expect(undoBtn(page)).toBeEnabled();

  await undoBtn(page).click();
  await expect.poll(() => cellCount(page)).toBe(before);
  await expect(redoBtn(page)).toBeEnabled();

  await redoBtn(page).click();
  await expect.poll(() => cellCount(page)).toBe(before + 1);
  await expect(redoBtn(page)).toBeDisabled();

  expect(errors).toEqual([]);
});

test("노트북: 셀 삭제를 되돌린다", async ({ page }) => {
  await openNotebook(page);
  await commandKey(page, "b");
  await commandKey(page, "b");
  const before = await cellCount(page);
  expect(before).toBeGreaterThanOrEqual(2);

  await page.locator(".nbv-cell").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");                    // d,d = 셀 삭제
  await page.keyboard.press("d");
  await expect.poll(() => cellCount(page)).toBe(before - 1);

  await undoBtn(page).click();
  await expect.poll(() => cellCount(page)).toBe(before);
});

test("노트북: 셀 형식 변경(코드↔마크다운)도 되돌린다", async ({ page }) => {
  await openNotebook(page);
  await expect.poll(() => cellTypes(page).then(t => t[0])).toBe("code");

  await commandKey(page, "m");                       // 마크다운으로
  await expect.poll(() => cellTypes(page).then(t => t[0])).toBe("markdown");

  await undoBtn(page).click();
  await expect.poll(() => cellTypes(page).then(t => t[0])).toBe("code");

  await redoBtn(page).click();
  await expect.poll(() => cellTypes(page).then(t => t[0])).toBe("markdown");
});

test("노트북: 되돌린 뒤 새 작업을 하면 다시실행 기록은 버려진다", async ({ page }) => {
  await openNotebook(page);
  const before = await cellCount(page);

  await commandKey(page, "b");
  await commandKey(page, "b");
  await expect.poll(() => cellCount(page)).toBe(before + 2);

  await undoBtn(page).click();
  await expect.poll(() => cellCount(page)).toBe(before + 1);
  await expect(redoBtn(page)).toBeEnabled();

  await commandKey(page, "m");                       // 새 갈래(형식 변경)
  await expect(redoBtn(page)).toBeDisabled();
});

// 작업 이름은 "무엇을 되돌렸는지"를 가리켜야 한다. 되돌리기와 다시실행이 서로 다른 단계에서
// 이름을 꺼내오므로(떠난 단계 vs 들어간 단계) 쉽게 어긋난다.
test("노트북: 되돌림·다시실행 안내에 무슨 작업이었는지 이름이 나온다", async ({ page }) => {
  await openNotebook(page);
  const status = page.locator(".nbv-status");

  await commandKey(page, "m");                       // 셀 형식 변경
  await undoBtn(page).click();
  await expect(status).toHaveText("되돌림: 셀 형식 변경");

  await redoBtn(page).click();
  await expect(status).toHaveText("다시 실행: 셀 형식 변경");
});

test("노트북: 작업이 여러 번이면 각 단계의 이름을 제대로 짚는다", async ({ page }) => {
  await openNotebook(page);
  const status = page.locator(".nbv-status");

  await commandKey(page, "m");                       // 1) 셀 형식 변경
  await commandKey(page, "b");                       // 2) 코드 셀 추가

  await undoBtn(page).click();
  await expect(status).toHaveText("되돌림: 코드 셀 추가");
  await undoBtn(page).click();
  await expect(status).toHaveText("되돌림: 셀 형식 변경");

  await redoBtn(page).click();
  await expect(status).toHaveText("다시 실행: 셀 형식 변경");
  await redoBtn(page).click();
  await expect(status).toHaveText("다시 실행: 코드 셀 추가");
});

test("노트북: Ctrl+Z / Ctrl+Y 단축키도 같은 히스토리를 쓴다", async ({ page }) => {
  await openNotebook(page);
  const before = await cellCount(page);

  await commandKey(page, "b");
  await expect.poll(() => cellCount(page)).toBe(before + 1);

  // 새 셀은 편집 모드로 열린다 — 편집기 안에서는 Ctrl+Z 가 글자 되돌리기라, 명령 모드로 빠져나온다
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect.poll(() => cellCount(page)).toBe(before);

  // 되돌리면 노트북을 다시 그리느라 포커스가 풀린다(단축키는 노트북 안에서만 받는다) → 셀을 다시 잡는다
  await page.locator(".nbv-cell").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+y");
  await expect.poll(() => cellCount(page)).toBe(before + 1);
});
