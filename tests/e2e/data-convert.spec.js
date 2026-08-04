const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 형식 변환 창 (설계: docs/형식변환-설계.md Phase 2)
 *
 * 변환 규칙 자체는 tests/data-convert.test.js 가 지킨다. 여기서 지키는 것은 화면 쪽 계약이다.
 *   - 팔레트에서 열리는가
 *   - 입력이 바뀌면 미리보기와 손실 배너가 따라 오는가
 *   - 결과가 실제로 새 탭이 되는가(원본은 그대로인가)
 */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

const modal = (page) => page.locator(".data-convert-modal");
const input = (page) => page.locator(".data-convert-input");
const lossText = (page) => page.locator(".data-convert-loss-text");
const formats = (page) => page.locator(".data-convert-format");

async function openConvert(page){
  await page.evaluate(() => window.openDataConvert());
  await expect(modal(page)).toBeVisible();
}

test("팔레트에서 형식 변환 창을 연다", async ({ page }) => {
  await boot(page);
  await page.locator("#commandPaletteOpen").click();
  await page.locator(".cmdk-input").fill("형식 변환");
  await expect(page.locator(".cmdk-item-label")).toContainText(["형식 변환 (JSON·CSV·표·마크다운)"]);
  await page.keyboard.press("Enter");
  await expect(modal(page)).toBeVisible();
});

test("JSON 을 넣으면 CSV 미리보기가 격자로 뜨고 손실 없음을 알린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await openConvert(page);

  await input(page).fill('[{"이름":"홍길동","연차":3},{"이름":"김철수","연차":5}]');
  // 입력 형식은 자동 인식(JSON), 출력은 기본 CSV
  await expect(formats(page).first()).toHaveValue("json");
  await expect(formats(page).nth(1)).toHaveValue("csv");

  const grid = page.locator(".data-convert-grid");
  await expect(grid).toBeVisible();
  await expect(grid.locator("th")).toHaveText(["이름", "연차"]);
  await expect(grid.locator("tbody tr")).toHaveCount(2);
  await expect(lossText(page)).toHaveText("손실 없이 변환됩니다.");
  expect(errors).toEqual([]);
});

test("입력 디바운스 중에는 이전 변환 결과를 내보낼 수 없다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill('[{"a":1}]');
  await expect(page.locator(".data-convert-grid")).toBeVisible();

  const disabledImmediately = await input(page).evaluate((area) => {
    area.value = '[{"a":2}]';
    area.dispatchEvent(new Event("input", { bubbles:true }));
    const copy = Array.from(document.querySelectorAll(".data-convert-card .btn"))
      .find(button => button.textContent === "복사");
    return !!copy && copy.disabled;
  });
  expect(disabledImmediately).toBe(true);
  await expect(page.locator(".data-convert-grid tbody td")).toHaveText("2");
});

test("중첩 구조를 표로 바꾸면 손실을 먼저 알리고 항목을 펼쳐 보여준다", async ({ page }) => {
  await boot(page);
  await openConvert(page);

  await input(page).fill('[{"이름":"홍길동","주소":{"시":"서울"}}]');
  await expect(lossText(page)).toContainText("손실됩니다");

  const list = page.locator(".data-convert-loss-list");
  await expect(list).toBeHidden();
  await page.locator(".data-convert-loss-head").click();
  await expect(list).toBeVisible();
  await expect(list.locator("code").first()).toHaveText("nested-flattened");
  // 평탄화된 컬럼 이름이 실제로 경로 표기여야 한다
  await expect(page.locator(".data-convert-grid th")).toHaveText(["이름", "주소.시"]);
});

test("원문 보기로 바꾸면 CSV 텍스트를 그대로 보여준다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill('[{"a":1}]');
  await expect(page.locator(".data-convert-grid")).toBeVisible();
  await page.locator(".data-convert-view-btn", { hasText: "원문" }).click();
  await expect(page.locator(".data-convert-raw")).toContainText("a");
  await expect(page.locator(".data-convert-grid")).toHaveCount(0);
});

test("잘못된 입력은 창을 죽이지 않고 오류만 보여준다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await openConvert(page);
  await input(page).fill("{ 이건 JSON 이 아니다");
  await expect(page.locator(".data-convert-error")).toBeVisible();
  await expect(page.locator(".data-convert-modal")).toBeVisible();
  expect(errors).toEqual([]);
});

test("변환 결과를 새 탭으로 열면 원본이 아닌 새 문서가 된다", async ({ page }) => {
  await boot(page);
  await openConvert(page);

  await input(page).fill("이름,연차\n홍길동,3");
  await expect(formats(page).first()).toHaveValue("csv");
  await formats(page).nth(1).selectOption("json");
  await expect(page.locator(".data-convert-raw")).toContainText("홍길동");

  await page.locator(".data-convert-card .btn.primary").click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator("#activeFileName")).toHaveText("변환.json");
});

test("XML 을 넣으면 알아서 인식하고 표로 펴 준다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill("<직원들><직원><이름>홍길동</이름></직원><직원><이름>김철수</이름></직원></직원들>");
  await expect(formats(page).first()).toHaveValue("xml");
  await formats(page).nth(1).selectOption("csv");
  await expect(page.locator(".data-convert-grid th")).toHaveText(["이름"]);
  await expect(page.locator(".data-convert-grid tbody tr")).toHaveCount(2);
});

test("XML 로 내보낼 때만 요소 이름 칸이 나온다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill('[{"a":1},{"a":2}]');
  const rootField = page.locator(".data-convert-opt", { hasText: "바깥 요소" });
  await expect(rootField).toBeHidden();
  await formats(page).nth(1).selectOption("xml");
  await expect(rootField).toBeVisible();
  await rootField.locator("input").fill("직원들");
  await expect(page.locator(".data-convert-raw")).toContainText("<직원들>");
});

test("HTML 표를 붙여넣으면 그대로 읽는다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill("<table><tr><th>이름</th><th>연차</th></tr><tr><td>홍길동</td><td>3</td></tr></table>");
  await expect(formats(page).first()).toHaveValue("html");
  await formats(page).nth(1).selectOption("json");
  await expect(page.locator(".data-convert-raw")).toContainText('"연차": 3');
});

test("JSON 문서를 열면 도구막대에 변환 버튼이 생기고 그 내용으로 창이 열린다", async ({ page }) => {
  await boot(page);
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-convert.json",
    mimeType: "application/json",
    buffer: Buffer.from('[{"이름":"홍길동","연차":3}]', "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-convert.json");
  const button = page.locator(".text-view-bar .text-edit-btn", { hasText: "변환" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(modal(page)).toBeVisible();
  await expect(input(page)).toHaveValue('[{"이름":"홍길동","연차":3}]');
  await expect(formats(page).first()).toHaveValue("json");
});

test("표 블록을 변환 창으로 보내면 CSV 로 채워지고 입력 형식이 고정된다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => MNTableExport.openConvert(
    { id:"t1", type:"table", header:true, rows:[["이름", "연차"], ["홍길동", "3"]] },
    { baseName:"메모 표" }
  ));
  await expect(modal(page)).toBeVisible();
  // textarea 는 넣은 값의 CRLF 를 LF 로 정규화해 보관한다
  await expect(input(page)).toHaveValue("이름,연차\n홍길동,3");
  await expect(formats(page).first()).toHaveValue("csv");
  // 부른 쪽이 형식을 알고 넘겼으므로 자동 인식 표시는 없어야 한다
  await expect(page.locator(".data-convert-auto")).toBeHidden();
  await formats(page).nth(1).selectOption("json");
  await expect(page.locator(".data-convert-raw")).toContainText('"연차": 3');
});

test("CSV 문서를 연 채 변환 창을 열면 시트 내용이 채워진다", async ({ page }) => {
  await boot(page);
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-convert.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("이름,연차\n홍길동,3\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-convert.csv");
  await expect(page.locator(".csv-pagenav")).toBeVisible();   // 표 렌더가 끝나야 시트를 내줄 수 있다
  await openConvert(page);
  await expect(input(page)).toHaveValue("이름,연차\n홍길동,3");
  await expect(formats(page).first()).toHaveValue("csv");
});

test("표 편집기 버튼은 표 형식일 때만 뜨고 xlsx 탭을 연다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill('[{"이름":"홍길동","연차":3}]');
  const sheetBtn = page.locator(".data-convert-card .btn", { hasText: "표 편집기로" });
  await expect(sheetBtn).toBeVisible();
  await formats(page).nth(1).selectOption("json");
  await expect(sheetBtn).toBeHidden();
  await formats(page).nth(1).selectOption("csv");
  await expect(sheetBtn).toBeVisible();
  await sheetBtn.click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator("#activeFileName")).toHaveText("변환.xlsx");
});

test("YAML 은 고른 순간에 라이브러리를 싣고 변환한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await openConvert(page);
  // 변환 창을 여는 것만으로는 39KB 를 싣지 않는다
  expect(await page.evaluate(() => typeof jsyaml !== "undefined")).toBe(false);

  await input(page).fill('[{"이름":"홍길동","연차":3}]');
  await formats(page).nth(1).selectOption("yaml");
  await expect(page.locator(".data-convert-raw")).toContainText("이름: 홍길동");
  expect(await page.evaluate(() => typeof jsyaml !== "undefined")).toBe(true);
  await expect(lossText(page)).toHaveText("손실 없이 변환됩니다.");
  expect(errors).toEqual([]);
});

test("YAML 을 넣으면 표로 펴서 보여준다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await input(page).fill("- 이름: 홍길동\n  연차: 3\n- 이름: 김철수\n  연차: 5\n");
  await formats(page).first().selectOption("yaml");
  await formats(page).nth(1).selectOption("csv");
  await expect(page.locator(".data-convert-grid th")).toHaveText(["이름", "연차"]);
  await expect(page.locator(".data-convert-grid tbody tr")).toHaveCount(2);
});

test("Esc 로 닫힌다", async ({ page }) => {
  await boot(page);
  await openConvert(page);
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
});
