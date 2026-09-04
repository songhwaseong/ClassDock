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

test("그리는 방법 다섯 가지를 골라 그리고 도함수를 겹쳐 넣는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/함수 그래프/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-graph-builder");

  // ① 함수 + 도함수 겹쳐 그리기
  await builder.locator(".wb-graph-rows").first().locator(".wb-graph-input").first().fill("x^3 - 3x");
  await builder.locator(".wb-graph-analysis label", { hasText:"도함수" }).locator("input").check();
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  // ② 매개변수 — 식 칸이 x(t)·y(t) 두 개짜리로 바뀌고, 해석 도구 줄은 사라진다
  await builder.locator(".wb-graph-modes button", { hasText:"매개변수" }).click();
  await expect(builder.locator(".wb-graph-rows").first()).toBeHidden();
  await expect(builder.locator(".wb-graph-analysis")).toBeHidden();
  const pair = builder.locator(".wb-graph-rows").last().locator(".wb-graph-row").first();
  await pair.locator("input").nth(0).fill("3 cos(t)");
  await pair.locator("input").nth(1).fill("3 sin(t)");
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  // ③ 극좌표 — 다시 한 줄짜리 식 칸을 쓰고 θ 를 그대로 받는다
  await builder.locator(".wb-graph-modes button", { hasText:"극좌표" }).click();
  await expect(builder.locator(".wb-graph-rows").first()).toBeVisible();
  await builder.locator(".wb-graph-rows").first().locator(".wb-graph-input").first().fill("4 cos(2θ)");
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  // ④ 음함수 — 등호가 있는 식을 그대로 받고, 다시 x 범위 칸을 쓴다
  await builder.locator(".wb-graph-modes button", { hasText:"음함수" }).click();
  await expect(builder.locator(".wb-graph-range").first()).toBeVisible();
  await builder.locator(".wb-graph-rows").first().locator(".wb-graph-input").first().fill("x^2 + y^2 = 9");
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  // ⑤ 수열 — 같은 칸이 t(θ) 대신 항의 번호 n 이 된다
  await builder.locator(".wb-graph-modes button", { hasText:"수열" }).click();
  await builder.locator(".wb-graph-rows").first().locator(".wb-graph-input").first().fill("2n + 1");
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual([
    "함수 그래프", "매개변수 곡선", "극좌표 그래프", "음함수 그래프", "수열 그래프"
  ]);
  expect(items.every((item) => item.role === "education-plot")).toBe(true);
  expect(errors).toEqual([]);
});

test("조각적 정의 함수는 if 와 부등호로 구간마다 다른 식을 그린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/함수 그래프/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-graph-builder");
  await builder.locator(".wb-graph-rows").first().locator(".wb-graph-input").first().fill("if(0 <= x < 2, x^2, 4)");
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();
  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["함수 그래프"]);
  expect(errors).toEqual([]);
});

test("보드에 놓인 그래프의 슬라이더를 끌면 그 자리에서 곡선이 다시 그려진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/함수 그래프/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-graph-builder");
  await builder.locator(".wb-graph-input").first().fill("a x");
  await builder.locator(".wb-formula-insert").click();

  // 그래프 안에 손잡이 자리가 함께 저장된다
  const slider = await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const plot = doc.boardState.items[0];
    return { value:plot.sliders[0].value, name:plot.sliders[0].name, count:plot.sliders.length };
  });
  expect(slider).toMatchObject({ name:"a", count:1 });

  // 손잡이를 오른쪽 끝까지 끌면 값이 최댓값(10)이 되고, 되돌리기 한 번으로 원래대로 온다
  const box = await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const plot = doc.boardState.items[0], handle = plot.sliders[0];
    const rect = doc.el.querySelector(".wb-canvas").getBoundingClientRect();
    const scale = plot.w / plot.sourceW;
    return {
      x:rect.left + plot.x + handle.x1 * scale + (handle.x2 - handle.x1) * scale * (handle.value - handle.min) / (handle.max - handle.min),
      y:rect.top + plot.y + handle.y * scale,
      endX:rect.left + plot.x + handle.x2 * scale + 20
    };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.endX, box.y, { steps:6 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    return { value:doc.boardState.items[0].sliders[0].value, count:doc.boardState.items.length };
  });
  expect(dragged).toEqual({ value:10, count:1 });
  await page.keyboard.press("Escape");                 // 도구상자가 열려 있으면 되돌리기 단축키가 판에 가지 않는다
  await page.keyboard.press("Control+z");
  const undone = await page.evaluate(() => docs.find((d) => d.id === activeId).boardState.items[0].sliders[0].value);
  expect(undone).toBe(1);
  expect(errors).toEqual([]);
});

test("같은 식에서 값의 표를 만들고, 표를 두 번 누르면 다시 고칠 수 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/함수 그래프/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-graph-builder");
  await builder.locator(".wb-graph-input").first().fill("2x + 1");
  await builder.locator(".wb-graph-table-insert").click();

  let items = await boardItems(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ type:"group", role:"education-table", label:"값의 표" });

  await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const table = doc.boardState.items[0];
    const canvas = doc.el.querySelector(".wb-canvas"), rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX:rect.left + table.x + table.w / 2, clientY:rect.top + table.y + table.h / 2, bubbles:true }));
  });
  await expect(builder.locator(".wb-graph-table-insert")).toHaveText("표 바꾸기");
  await builder.locator(".wb-graph-table-insert").click();
  items = await boardItems(page);
  expect(items).toHaveLength(1);                       // 새로 넣지 않고 그 자리에 갈아 끼운다
  expect(errors).toEqual([]);
});

test("자료에서 상자그림·요약 카드·도수분포표를 만든다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/자료 차트/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-chart-builder");
  await builder.locator("textarea").fill("62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77");
  await builder.locator(".wb-chart-types button", { hasText:"상자그림" }).click();
  await builder.locator(".wb-formula-insert").click();
  await builder.locator(".wb-chart-extras > summary").click();          // 통계 구획 펴기
  await builder.locator(".wb-chart-stats").click();
  await builder.locator(".wb-chart-frequency").click();

  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["상자그림", "자료 요약", "도수분포표"]);
  expect(errors).toEqual([]);
});

test("균형 맞춘 반응식에서 몰 계산표를 만든다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.locator(".wb-edu-toggle").last().click();
  const panel = page.locator(".wb-edu-panel").last();
  await panel.locator(".wb-edu-tab", { hasText:"화학" }).click();
  const builder = panel.locator(".wb-chem-builder");
  await builder.locator(".wb-chem-input").fill("CH4 + O2 -> CO2 + H2O");
  await expect(builder.locator(".wb-chem-mole")).toBeVisible();
  await builder.locator(".wb-graph-number[title='아는 물질의 양']").fill("8");
  await expect(builder.locator(".wb-chem-mole-result")).toContainText("CO₂ 0.499mol(21.95g)");
  await builder.locator(".wb-chem-mole-insert").click();

  const items = await boardItems(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ type:"group", role:"education-table", label:"화학량론" });
  expect(errors).toEqual([]);
});

test("수 모형 탭에서 분수·양팔 저울을 넣고 두 번 눌러 다시 고친다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.locator(".wb-edu-toggle").last().click();
  const panel = page.locator(".wb-edu-panel").last();
  await panel.locator(".wb-edu-tab", { hasText:"수 모형" }).click();
  const builder = panel.locator(".wb-number-builder");
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await builder.locator(".wb-formula-insert").click();               // 분수(기본 3/4, 2/3)

  let items = await boardItems(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ type:"group", role:"education-tool", label:"분수 모형" });

  // 보드의 도구를 두 번 누르면 만든 재료를 든 채 그 종류의 칸이 돌아온다
  await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const model = doc.boardState.items[0];
    const canvas = doc.el.querySelector(".wb-canvas"), rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX:rect.left + model.x + model.w / 2, clientY:rect.top + model.y + model.h / 2, bubbles:true }));
  });
  await expect(builder.locator(".wb-formula-insert")).toHaveText("바꾸기");
  await builder.locator(".wb-graph-input").fill("1/2, 2/4, 3/6");
  await builder.locator(".wb-formula-insert").click();
  items = await boardItems(page);
  expect(items).toHaveLength(1);                                     // 그 자리에 갈아 끼운다

  // 세로로 긴 그림(원 분수)이라도 미리보기가 창을 밀어내 ‘넣기’ 단추를 가리면 안 된다
  await builder.locator("select").selectOption("circle");
  await builder.locator(".wb-graph-input").fill("3/4, 2/3, 5/6");
  const fits = await panel.evaluate((el) => {
    const insert = el.querySelector(".wb-number-builder .wb-formula-insert").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return insert.bottom <= box.bottom + 1;
  });
  expect(fits).toBe(true);

  // 종류를 바꾸면 그 종류의 칸만 나타나고, 넣으면 새 항목이 된다
  await builder.locator(".wb-tool-kinds button", { hasText:"양팔 저울" }).click();
  await expect(builder.locator(".wb-formula-insert")).toHaveText("넣기");
  await builder.locator(".wb-formula-insert").click();
  items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["분수 모형", "양팔 저울"]);
  expect(errors).toEqual([]);
});

test("과학 계산 탭에서 광선도·퍼넷 사각형·회로를 계산해 넣는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.locator(".wb-edu-toggle").last().click();
  const panel = page.locator(".wb-edu-panel").last();
  await panel.locator(".wb-edu-tab", { hasText:"과학 계산" }).click();
  const builder = panel.locator(".wb-lab-builder");
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await builder.locator(".wb-formula-insert").click();                 // 볼록렌즈 f=4, a=6

  // 물체를 초점 안쪽으로 옮기면 허상이 된다(같은 항목을 고쳐 넣는다)
  await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const model = doc.boardState.items[0];
    const canvas = doc.el.querySelector(".wb-canvas"), rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX:rect.left + model.x + model.w / 2, clientY:rect.top + model.y + model.h / 2, bubbles:true }));
  });
  await expect(builder.locator(".wb-formula-insert")).toHaveText("바꾸기");
  await builder.locator("input[title='물체까지의 거리(cm)']").fill("3");
  await builder.locator(".wb-formula-insert").click();
  const virtual = await page.evaluate(() => {
    const items = docs.find((d) => d.id === activeId).boardState.items;
    return items[0].items.filter((item) => item.type === "text").map((item) => item.text);
  });
  expect(virtual.some((text) => text.includes("허상"))).toBe(true);

  await builder.locator(".wb-tool-kinds button", { hasText:"퍼넷 사각형" }).click();
  await builder.locator(".wb-formula-insert").click();
  await builder.locator(".wb-tool-kinds button", { hasText:"회로 계산" }).click();
  await builder.locator(".wb-formula-insert").click();

  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["볼록렌즈 광선도", "퍼넷 사각형", "회로 계산"]);
  expect(items.every((item) => item.role === "education-tool")).toBe(true);
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

test("띠그래프·누적 막대·도수분포다각형을 같은 자료 칸에서 만든다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/자료 차트/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-chart-builder");
  await builder.locator("textarea").fill("과목, 1반, 2반\n국어, 7, 9\n수학, 12, 8\n영어, 5, 11");
  await builder.locator(".wb-chart-types button", { hasText:"띠그래프" }).click();
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await builder.locator(".wb-formula-insert").click();
  await builder.locator(".wb-chart-types button", { hasText:"누적 막대" }).click();
  await builder.locator(".wb-formula-insert").click();

  // 도수분포다각형은 값 목록으로 그린다. ‘누적’ 칸은 이 종류에서만 켜진다.
  await builder.locator("textarea").fill("62\n71\n75\n78\n80\n83\n85\n88\n91\n95\n72\n77");
  await builder.locator(".wb-chart-types button", { hasText:"도수분포다각형" }).click();
  await builder.locator(".wb-formula-insert").click();
  await builder.locator(".wb-chart-extras > summary").click();          // 통계 구획 펴기
  await builder.locator(".wb-chart-extras").getByRole("checkbox", { name:"누적" }).check();
  await builder.locator(".wb-formula-insert").click();

  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["띠그래프", "누적 막대그래프", "도수분포다각형", "누적도수분포곡선"]);
  expect(items.every((item) => item.role === "education-chart")).toBe(true);
  expect(errors).toEqual([]);
});

test("가로 막대와 버블을 같은 자료 칸에서 만든다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);
  await page.getByRole("button", { name:/자료 차트/ }).last().click();
  const builder = page.locator(".wb-edu-panel").last().locator(".wb-chart-builder");

  // 이름이 긴 항목은 가로 막대로 — 세로 막대에서는 이름이 서로 겹친다
  await builder.locator("textarea").fill("책 읽기, 7\n운동하기, 12\n이야기 나누기, 5\n그림 그리기, 9");
  await builder.locator(".wb-chart-types button", { hasText:"가로 막대" }).click();
  await expect(builder.locator(".wb-tool-preview")).toBeVisible();
  await builder.locator(".wb-formula-insert").click();

  // 버블은 셋째 값이 점의 크기다
  await builder.locator("textarea").fill("1, 60, 5\n2, 68, 20\n3, 74, 45");
  await builder.locator(".wb-chart-types button", { hasText:"버블" }).click();
  await expect(builder.locator(".wb-tool-message.is-error")).toHaveCount(0);
  await builder.locator(".wb-formula-insert").click();

  const items = await boardItems(page);
  expect(items.map((item) => item.label)).toEqual(["가로 막대그래프", "버블 차트"]);
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
