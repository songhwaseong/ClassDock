const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// A급 수학·과학 도구: 함수 그래프·자료 차트·교구(자)·손그림 정리.
// 실제 화면에서 넣어 보고, 보드 모델(wb.items)에 무엇이 남는지로 확인한다.

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => newWhiteboard());
  await expect(page.locator(".wb-canvas").last()).toBeVisible();
}

// 활성 보드의 판서 모델(교구는 여기 들어가지 않는다)
const boardItems = (page) => page.evaluate(() => {
  const doc = docs.find((d) => d.id === activeId);
  return (doc.boardState.items || []).map((item) => ({ type:item.type, role:item.role || "", label:item.educationLabel || "", points:item.points ? item.points.length : 0 }));
});

test("식을 치면 계산한 곡선이 그룹으로 들어가고, 두 번 누르면 다시 고칠 수 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);

  await page.locator(".wb-tools .wb-act", { has:page.locator("svg") }).first().waitFor();
  await page.getByRole("button", { name:/함수 그래프/ }).last().click();
  const panel = page.locator(".wb-edu-panel").last();
  await expect(panel).toBeVisible();
  const builder = panel.locator(".wb-graph-builder");
  const input = builder.locator(".wb-graph-input").first();
  await input.fill("x^2 - 3");
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  let items = await boardItems(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ type:"group", role:"education-plot", label:"함수 그래프" });

  // 매개변수가 있는 식에는 슬라이더가 생긴다
  await input.fill("a x + 1");
  await expect(builder.locator(".wb-graph-param")).toHaveCount(1);

  // 보드의 그래프를 두 번 누르면 그 식이 입력칸에 돌아오고, 바꿔 넣어도 항목 수는 그대로다
  await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const plot = doc.boardState.items[0];
    const canvas = doc.el.querySelector(".wb-canvas"), rect = canvas.getBoundingClientRect();
    const point = { clientX:rect.left + plot.x + plot.w / 2, clientY:rect.top + plot.y + plot.h / 2, bubbles:true };
    canvas.dispatchEvent(new MouseEvent("dblclick", point));
  });
  await expect(input).toHaveValue("x^2 - 3");
  await expect(builder.locator(".wb-formula-insert")).toHaveText("그래프 바꾸기");
  await input.fill("x^3 - 3x");
  await builder.locator(".wb-formula-insert").click();
  items = await boardItems(page);
  expect(items).toHaveLength(1);
  expect(items[0].role).toBe("education-plot");
  expect(errors).toEqual([]);
});

test("자료를 붙여넣으면 막대·원그래프가 벡터로 들어간다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/자료 차트/ }).last().click();
  const panel = page.locator(".wb-edu-panel").last();
  const builder = panel.locator(".wb-chart-builder");
  await builder.locator("textarea").fill("국어, 7\n수학, 12\n영어, 5");
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await builder.locator(".wb-formula-insert").click();

  await builder.locator(".wb-chart-types button", { hasText:"원" }).first().click();
  await builder.locator(".wb-formula-insert").click();

  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["막대그래프", "원그래프"]);
  expect(items.every((item) => item.role === "education-chart")).toBe(true);
  expect(errors).toEqual([]);
});

test("자를 꺼내면 획이 모서리에 붙고, 교구는 저장 그림에 남지 않는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/^자 —/ }).last().click();
  await expect(page.getByRole("button", { name:/^자 —/ }).last()).toHaveAttribute("aria-pressed", "true");

  // 자는 판서가 아니라 손에 든 도구 — 저장·복구 스냅샷에는 없다
  const beforeItems = await boardItems(page);
  expect(beforeItems).toEqual([]);

  // 눈금 모서리에서 조금 떨어진 곳을 비스듬히 그으면 곧은 획이 된다
  const edge = await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const rect = doc.el.querySelector(".wb-canvas").getBoundingClientRect();
    const ruler = doc.boardGear.ruler;
    return { x:rect.left + ruler.x, y:rect.top + ruler.y, length:ruler.length };
  });
  await page.locator(".wb-tools .wb-tool").nth(1).click();               // 펜
  await page.mouse.move(edge.x + 40, edge.y - 12);
  await page.mouse.down();
  await page.mouse.move(edge.x + 140, edge.y - 20, { steps:6 });
  await page.mouse.move(edge.x + 240, edge.y - 5, { steps:6 });
  await page.mouse.up();

  const drawn = await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const stroke = doc.boardState.items[0];
    const ys = (stroke.points || []).map((point) => point.y);
    return { type:stroke.type, spread:Math.max(...ys) - Math.min(...ys) };
  });
  expect(drawn.type).toBe("pen");
  expect(drawn.spread).toBeLessThan(1);                                   // 모서리에 붙어 y 가 한 줄로 모인다
  expect(errors).toEqual([]);
});

test("손그림 정리를 켜면 대충 그린 동그라미가 원이 되고 Ctrl+Z 로 되돌아온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/손그림 정리/ }).last().click();
  await page.locator(".wb-tools .wb-tool").nth(1).click();               // 펜

  const center = await page.evaluate(() => {
    const rect = docs.find((d) => d.id === activeId).el.querySelector(".wb-canvas").getBoundingClientRect();
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  });
  const radius = 90;
  await page.mouse.move(center.x + radius, center.y);
  await page.mouse.down();
  for (let i = 1; i <= 36; i++){
    const angle = i / 36 * Math.PI * 2;
    await page.mouse.move(center.x + radius * Math.cos(angle) + (i % 3 - 1), center.y + radius * Math.sin(angle) + (i % 2 - .5));
  }
  await page.mouse.up();

  expect((await boardItems(page)).map((item) => item.type)).toEqual(["ellipse"]);
  await page.keyboard.press("Control+z");
  expect((await boardItems(page)).map((item) => item.type)).toEqual(["pen"]);
  expect(errors).toEqual([]);
});
