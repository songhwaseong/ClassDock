const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// B급 수학·과학 도구: 변환 기하 · 동적 측정 · 화학(주기율표·반응식 균형) · 확률 실험.

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-canvas").last()).toBeVisible();
}

const boardItems = (page) => page.evaluate(() => {
  const doc = docs.find((d) => d.id === activeId);
  return (doc.boardState.items || []).map((item) => ({ type:item.type, role:item.role || "", text:item.text || "", label:item.educationLabel || "" }));
});

const stageBox = (page) => page.evaluate(() => {
  const rect = docs.find((d) => d.id === activeId).el.querySelector(".wb-canvas").getBoundingClientRect();
  return { x:rect.left, y:rect.top, width:rect.width, height:rect.height };
});

// 도구막대 도구 순서: 선택0 펜1 형광펜2 지우개3 직선4 화살표5 사각형6 원7 글자8
const useTool = (page, index) => page.locator(".wb-tools .wb-tool").nth(index).click();

async function dragOnBoard(page, from, to){
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps:8 });
  await page.mouse.up();
}

test("고른 도형에 길이·넓이를 붙이고, 변환으로 바뀌면 값도 따라 바뀐다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  const stage = await stageBox(page);

  await useTool(page, 6);                                             // 사각형
  await dragOnBoard(page, { x:stage.x + 120, y:stage.y + 120 }, { x:stage.x + 120 + 37.8 * 4, y:stage.y + 120 + 37.8 * 2 });
  await useTool(page, 0);                                             // 선택
  await page.mouse.click(stage.x + 130, stage.y + 122);

  await page.getByRole("button", { name:/^측정 —/ }).last().click();
  let items = await boardItems(page);
  expect(items).toHaveLength(2);
  const label = items.find((item) => item.role === "measure");
  expect(label.text).toMatch(/cm² *$/);
  expect(label.text).toContain("8.0cm²");                             // 4cm × 2cm

  // 닮음 2배(원본을 대신) → 같은 라벨이 4배가 된 넓이를 가리킨다
  await page.getByRole("button", { name:/^변환 —/ }).last().click();
  const panel = page.locator(".wb-transform-panel").last();
  await expect(panel).toBeVisible();
  await panel.locator(".wb-transform-kinds button", { hasText:"닮음" }).click();
  await panel.locator(".wb-graph-check input").uncheck();             // 원본 남기지 않기
  await panel.locator(".wb-formula-insert").click();

  items = await boardItems(page);
  expect(items).toHaveLength(2);
  expect(items.find((item) => item.role === "measure").text).toContain("32.0cm²");
  expect(errors).toEqual([]);
});

test("선대칭·회전은 원본을 남긴 사본을 만든다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  const stage = await stageBox(page);

  await useTool(page, 4);                                             // 직선
  await dragOnBoard(page, { x:stage.x + 100, y:stage.y + 100 }, { x:stage.x + 200, y:stage.y + 160 });
  await useTool(page, 0);
  await page.mouse.click(stage.x + 150, stage.y + 130);

  await page.getByRole("button", { name:/^변환 —/ }).last().click();
  const panel = page.locator(".wb-transform-panel").last();
  await panel.locator(".wb-transform-kinds button", { hasText:"선대칭" }).click();
  await panel.locator(".wb-transform-axis button", { hasText:"세로축" }).click();
  await panel.locator(".wb-formula-insert").click();
  expect((await boardItems(page)).filter((item) => item.type === "line")).toHaveLength(2);

  // 뒤집힌 사본은 원본과 좌우가 반대다(같은 자리에 겹쳐 있지 않다)
  const [first, second] = await page.evaluate(() => {
    const items = docs.find((d) => d.id === activeId).boardState.items;
    return items.filter((item) => item.type === "line").map((item) => Math.round(item.x1));
  });
  expect(first).not.toBe(second);

  await panel.locator(".wb-transform-kinds button", { hasText:"회전" }).click();
  await panel.locator(".wb-formula-insert").click();
  expect((await boardItems(page)).filter((item) => item.type === "line")).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("반응식 계수를 맞춰 넣고, 주기율표에서 원소 카드를 꺼낸다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.locator(".wb-edu-toggle").last().click();
  const panel = page.locator(".wb-edu-panel").last();
  await panel.locator(".wb-edu-tab", { hasText:"화학" }).click();

  const builder = panel.locator(".wb-chem-builder");
  await builder.locator("input").fill("CH4 + O2 -> CO2 + H2O");
  // 미리보기의 → 는 앱 공통 규칙대로 icons.js 가 SVG 화살표로 바꾸므로 글자만 비교한다.
  await expect(builder.locator(".wb-chem-result")).toContainText("CH₄ + 2O₂");
  await expect(builder.locator(".wb-chem-result")).toContainText("CO₂ + 2H₂O");
  await expect(builder.locator(".wb-tool-message")).toHaveText("계수: 1 · 2 · 1 · 2");
  await builder.locator(".wb-formula-insert").click();

  // 잘못된 식은 넣지 않고 이유를 알려 준다
  await builder.locator("input").fill("H2 + O2 -> H2");
  await expect(builder.locator(".wb-tool-message.is-error")).toBeVisible();
  await expect(builder.locator(".wb-formula-insert")).toBeDisabled();

  // 주기율표는 18족 × 7주기로 깔리고, 누르면 원소 카드가 들어간다
  await expect(panel.locator(".wb-edu-grid.wb-periodic .wb-element")).toHaveCount(118);
  await panel.locator(".wb-element", { hasText:"Na" }).first().click();

  const items = await boardItems(page);
  expect(items[0].text).toBe("CH₄ + 2O₂ → CO₂ + 2H₂O");
  expect(items[1]).toMatchObject({ type:"group", role:"education-element", label:"나트륨(Na)" });
  expect(errors).toEqual([]);
});

test("우클릭 메뉴로도 교구·측정·변환·그래프를 꺼낼 수 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  const stage = await stageBox(page);
  const menu = page.locator(".wb-focus-context-menu");

  // ① 빈 곳: 교구 구역에서 자를 꺼내고, 다시 눌러 상태가 반영되는지 본다
  await page.mouse.click(stage.x + 420, stage.y + 300, { button:"right" });
  await expect(menu).toBeVisible();
  await menu.locator(".wb-context-gear-actions button", { hasText:"자" }).first().click();
  expect(await page.evaluate(() => !!docs.find((d) => d.id === activeId).boardGear.ruler)).toBe(true);

  await page.mouse.click(stage.x + 420, stage.y + 300, { button:"right" });
  await expect(menu.locator(".wb-context-gear-actions button.active", { hasText:"자" }).first()).toBeVisible();
  await menu.locator(".wb-context-gear-actions button", { hasText:"교구 치우기" }).click();
  expect(await page.evaluate(() => !!docs.find((d) => d.id === activeId).boardGear.ruler)).toBe(false);

  // ② 빈 곳: 그래프 바로 열기
  await page.mouse.click(stage.x + 420, stage.y + 300, { button:"right" });
  await menu.locator(".wb-context-board button", { hasText:"그래프" }).click();
  await expect(page.locator(".wb-edu-panel").last().locator(".wb-graph-builder")).toBeVisible();
  await page.keyboard.press("Escape");

  // ③ 도형 위: 측정 붙이기 → 다시 열면 "측정 떼기"로 바뀐다
  await useTool(page, 6);
  await dragOnBoard(page, { x:stage.x + 120, y:stage.y + 120 }, { x:stage.x + 260, y:stage.y + 200 });
  await useTool(page, 0);
  await page.mouse.click(stage.x + 130, stage.y + 122, { button:"right" });
  await expect(menu.locator(".wb-context-item")).toBeVisible();
  await menu.locator(".wb-context-item button", { hasText:"측정" }).click();
  expect((await boardItems(page)).filter((item) => item.role === "measure")).toHaveLength(1);

  await page.mouse.click(stage.x + 130, stage.y + 122, { button:"right" });
  await expect(menu.locator(".wb-context-item button", { hasText:"측정 떼기" })).toBeVisible();
  await menu.locator(".wb-context-item button", { hasText:"변환" }).click();
  await expect(page.locator(".wb-transform-panel").last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("주사위를 굴려 만든 자료가 그대로 차트가 된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/자료 차트/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-chart-builder");
  await builder.locator(".wb-sim-count input").fill("600");
  await builder.locator(".wb-sim-row button", { hasText:"주사위" }).first().click();

  await expect(builder.locator("input.wb-chart-title")).toHaveValue("주사위 600회");
  const data = await builder.locator("textarea").inputValue();
  const rows = data.trim().split("\n");
  expect(rows).toHaveLength(6);
  expect(rows.reduce((sum, row) => sum + Number(row.split(",")[1]), 0)).toBe(600);
  await expect(builder.locator(".wb-tool-message")).toContainText("평균");

  await builder.locator(".wb-formula-insert").click();
  expect((await boardItems(page))[0]).toMatchObject({ role:"education-chart", label:"막대그래프" });
  expect(errors).toEqual([]);
});
