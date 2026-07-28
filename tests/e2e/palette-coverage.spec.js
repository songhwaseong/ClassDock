const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 명령 팔레트가 "지금 화면의 도구"를 실제로 찾아내는지 지킨다.
 *
 * 팔레트 항목 다수는 각 뷰어의 도구막대 버튼을 클래스로 찾아 누르는 방식이라,
 * 뷰어 쪽 클래스 이름이 바뀌면 조용히 사라진다(오류도 안 난다). 문서 종류별로 열어 두고
 * 기대하는 항목이 실제로 뜨는지 확인해, 그 조용한 소실을 잡는다.
 */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function paletteLabels(page, query){
  await page.locator("#commandPaletteOpen").click();
  await expect(page.locator(".cmdk-overlay")).toBeVisible();
  if (query) await page.locator(".cmdk-input").fill(query);
  const labels = await page.locator(".cmdk-item-label").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cmdk-overlay")).toBeHidden();
  return labels;
}

async function openPython(page){
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-palette.py",
    mimeType: "text/x-python",
    buffer: Buffer.from("print('안녕')\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-palette.py");
  await expect(page.locator(".run-go")).toBeVisible();
}

test("사용법 문서는 문서를 열지 않아도 팔레트에서 찾을 수 있다", async ({ page }) => {
  await boot(page);
  expect(await paletteLabels(page, "사용법")).toContain("자세한 사용법 문서");
});

test("도움말 창에 자세한 사용법 버튼이 있다", async ({ page }) => {
  await boot(page);
  await page.locator("#helpOpen").click();
  await expect(page.locator("#helpManual")).toBeVisible();
});

test("파이썬을 열면 편집기 도구가 팔레트에 나타난다", async ({ page }) => {
  await boot(page);
  const before = await paletteLabels(page, "");
  expect(before).not.toContain("단계 실행 (변수 추적)");
  await openPython(page);
  const labels = await paletteLabels(page, "");
  for (const wanted of ["단계 실행 (변수 추적)", "코드 진단", "파이썬 라이브러리 설치", "노트북으로 변환", "현재 코드 실행"]){
    expect(labels).toContain(wanted);
  }
});

test("맞춤법 검사는 검사할 수 있는 문서에서만 뜬다", async ({ page }) => {
  await boot(page);
  expect(await paletteLabels(page, "맞춤법")).not.toContain("한국어 맞춤법 검사");
  await openPython(page);
  expect(await paletteLabels(page, "맞춤법")).toContain("한국어 맞춤법 검사");
});

test("표를 열면 표 도구가 팔레트에 나타난다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => newSpreadsheetScratch());
  await expect(page.locator("td[data-mcol]").first()).toBeVisible();
  const labels = await paletteLabels(page, "");
  expect(labels).toContain("표 편집·정렬 모드 켜기 / 끄기");
  expect(labels).toContain("표에서 찾기");
});

test("화이트보드를 열면 판서 도구가 팔레트에 나타난다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-canvas").first()).toBeVisible();
  const labels = await paletteLabels(page, "");
  expect(labels).toContain("화이트보드 전부 지우기");
  expect(labels).toContain("화이트보드 녹화");
});

test("노트북을 열면 셀 실행·목차 도구가 팔레트에 나타난다", async ({ page }) => {
  await boot(page);
  const ipynb = JSON.stringify({
    cells: [{ cell_type: "code", source: ["print(1)\n"], metadata: {}, outputs: [], execution_count: null }],
    metadata: {}, nbformat: 4, nbformat_minor: 5
  });
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-palette.ipynb",
    mimeType: "application/json",
    buffer: Buffer.from(ipynb, "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-palette.ipynb");
  await expect(page.locator(".nbv-runall")).toBeVisible();
  const labels = await paletteLabels(page, "");
  for (const wanted of ["노트북 전체 셀 실행", "커널 다시 시작 후 전체 실행", "노트북 목차", "노트북 PDF로 내보내기"]){
    expect(labels).toContain(wanted);
  }
});

test("팔레트에서 표 편집 모드를 실제로 켤 수 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => newSpreadsheetScratch());
  await expect(page.locator("td[data-mcol]").first()).toBeVisible();
  // "새 빈 표"는 바로 편집 모드로 열린다 — 팔레트 명령은 그 상태를 토글해야 한다.
  const toggle = page.locator(".xlsx-editmode-btn");
  await expect(toggle).toHaveClass(/active/);

  const runPaletteEditToggle = async () => {
    await page.locator("#commandPaletteOpen").click();
    await page.locator(".cmdk-input").fill("표 편집");
    await page.keyboard.press("Enter");
  };
  await runPaletteEditToggle();
  await expect(toggle).not.toHaveClass(/active/);   // 읽기 전용으로
  await runPaletteEditToggle();
  await expect(toggle).toHaveClass(/active/);       // 다시 편집 모드로
  expect(errors).toEqual([]);
});

test("팔레트에서 표 찾기를 실행하면 찾기 메뉴가 실제로 열린다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => newSpreadsheetScratch());
  await expect(page.locator("td[data-mcol]").first()).toBeVisible();
  const menu = page.locator(".xlsx-tool-menu-find");
  await expect(menu).not.toHaveAttribute("open", "");
  await page.locator("#commandPaletteOpen").click();
  await page.locator(".cmdk-input").fill("표에서 찾기");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("open", "");
  // '찾기·바꿈' 메뉴는 .xlsx-find-input 클래스를 찾기·바꾸기 두 칸에 함께 쓴다(클래스만으로는 하나로 못 좁힘).
  await expect(menu.getByPlaceholder("찾을 내용")).toBeVisible();
  await expect(menu.getByPlaceholder("바꿀 내용")).toBeVisible();
});
