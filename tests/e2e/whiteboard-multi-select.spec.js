const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 선택 도구에서 Ctrl 을 누른 채 빈 곳을 끌면 선택 상자가 생기고, 상자 안에 통째로 들어온 항목을 한꺼번에 고른다.
   고른 것 중 하나를 잡아 끌면 전부 같이 옮겨지고(되돌리기 한 번), Delete 는 전부 지우며, Esc 는 선택만 푼다. */

async function openBoard(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.keyboard.press("Alt+b");
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();
  return canvas;
}

const pickTool = (page, tool) => page.locator(`.wb-tool.wb-toolvis-${tool}`).click();
const rects = (page) => page.evaluate(() => {
  const doc = docs.find((d) => d.id === activeId);
  return doc.boardState.items.filter((it) => it.type === "rect").map((it) => ({ x:Math.min(it.x1, it.x2), y:Math.min(it.y1, it.y2) }));
});
const itemSummary = (page) => page.evaluate(() => {
  const doc = docs.find((d) => d.id === activeId);
  return doc.boardState.items.map((it) => ({ type:it.type, color:it.color || "", children:(it.items || []).length,
    x:it.type === "rect" ? Math.min(it.x1, it.x2) : it.x }));
});

async function drag(page, canvas, from, to, modifier){
  const box = await canvas.boundingBox();
  expect(box, "캔버스가 화면에 있어야 한다").not.toBeNull();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps:8 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

async function drawThreeRects(page, canvas){
  await pickTool(page, "rect");
  await drag(page, canvas, [60, 60], [120, 110]);
  await drag(page, canvas, [160, 60], [220, 110]);
  await drag(page, canvas, [400, 260], [460, 310]);    // 선택 상자 밖에 둘 것
  await pickTool(page, "select");
  expect(await rects(page)).toHaveLength(3);
}

test("Ctrl+끌기로 여러 개를 고르고 함께 옮긴 뒤 되돌리기 한 번에 돌아온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);
  const before = await rects(page);

  await drag(page, canvas, [30, 30], [260, 140], "Control");      // 앞의 둘만 감싼다
  await drag(page, canvas, [90, 85], [140, 185]);                  // 그중 하나를 잡고 (+50,+100)

  const after = await rects(page);
  expect(after[0].x - before[0].x).toBeCloseTo(50, 0);
  expect(after[0].y - before[0].y).toBeCloseTo(100, 0);
  expect(after[1].x - before[1].x).toBeCloseTo(50, 0);
  expect(after[1].y - before[1].y).toBeCloseTo(100, 0);
  expect(after[2]).toEqual(before[2]);                             // 상자 밖 항목은 그대로

  await page.keyboard.press("Control+z");
  expect(await rects(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("여러 개를 고른 채 Delete 는 전부 지우고, Esc 는 선택만 푼다", async ({ page }) => {
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);

  await drag(page, canvas, [30, 30], [260, 140], "Control");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  expect(await rects(page)).toHaveLength(3);                       // 선택이 풀려 아무것도 안 지워진다

  await drag(page, canvas, [30, 30], [260, 140], "Control");
  await page.keyboard.press("Delete");
  expect(await rects(page)).toHaveLength(1);

  await page.keyboard.press("Control+z");
  expect(await rects(page)).toHaveLength(3);
});

test("Ctrl+클릭으로 하나씩 더하고, 선택 밖을 누르면 여러 개 선택이 풀린다", async ({ page }) => {
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);
  const box = await canvas.boundingBox();
  // page.mouse.click 은 modifiers 옵션을 모른다 — 키를 직접 누르고 있어야 한다.
  const click = async (x, y, modifiers = []) => {
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(box.x + x, box.y + y);
    for (const key of modifiers) await page.keyboard.up(key);
  };

  await click(90, 60);                                             // 첫째(테두리) 고르기
  await click(430, 260, ["Control"]);                              // 셋째 더하기
  await page.keyboard.press("Delete");
  expect(await rects(page)).toHaveLength(1);                       // 둘째만 남는다
  await page.keyboard.press("Control+z");

  await drag(page, canvas, [30, 30], [260, 140], "Control");
  await click(560, 380);                                           // 빈 곳 클릭 → 선택 해제
  await page.keyboard.press("Delete");
  expect(await rects(page)).toHaveLength(3);
});

test("Ctrl+G 로 묶으면 한 덩어리로 움직이고, Ctrl+Shift+G 로 풀면 옮긴 자리에서 고른 채로 돌아온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);
  const before = await rects(page);

  await drag(page, canvas, [30, 30], [260, 140], "Control");
  await page.keyboard.press("Control+g");
  const grouped = await itemSummary(page);
  expect(grouped.map((it) => it.type)).toEqual(["group", "rect"]);
  expect(grouped[0].children).toBe(2);
  // 도구막대 단추도 '묶기'가 아니라 다시 '분리'로 돌아와 있어야 한다(그룹 한 개가 골라진 상태).
  await expect(page.locator(".wb-ungroup").first()).toHaveText("분리");

  await drag(page, canvas, [90, 85], [140, 185]);                  // 그룹을 (+50,+100)
  await page.keyboard.press("Control+Shift+g");
  const after = await rects(page);
  expect(after).toHaveLength(3);
  expect(after[0].x - before[0].x).toBeCloseTo(50, 0);
  expect(after[1].y - before[1].y).toBeCloseTo(100, 0);
  expect(after[2]).toEqual(before[2]);

  await page.keyboard.press("Delete");                             // 푼 조각 둘이 골라져 있다
  expect(await rects(page)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("여러 개 위에서 우클릭하면 선택을 지킨 채 복제·색 바꾸기·맨 뒤로를 한꺼번에 한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);
  const box = await canvas.boundingBox();
  const menu = page.locator(".wb-focus-context-menu");
  const rightClick = (x, y) => page.mouse.click(box.x + x, box.y + y, { button:"right" });

  await drag(page, canvas, [30, 30], [260, 140], "Control");
  await rightClick(90, 85);
  await expect(menu.locator(".wb-context-target")).toHaveText("2개 항목");
  await expect(menu.locator(".wb-context-item button", { hasText:"측정" })).toBeHidden();
  await menu.locator(".wb-context-item button", { hasText:"복제" }).click();

  let items = await itemSummary(page);
  expect(items).toHaveLength(5);
  expect(items[3].x - items[0].x).toBeCloseTo(24, 0);              // 오른쪽 아래로 비켜 복제
  expect(items[4].x - items[1].x).toBeCloseTo(24, 0);

  // 복제본 둘이 골라져 있다 — 그 위에서 우클릭해 색을 칠한다.
  await rightClick(90 + 24, 85 + 24);
  await expect(menu.locator(".wb-context-target")).toHaveText("2개 항목");
  const swatch = menu.locator(".wb-context-swatch").nth(2);
  const color = await swatch.evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
    return "#" + m.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
  });
  await swatch.click();
  items = await itemSummary(page);
  expect(items[3].color).toBe(color);
  expect(items[4].color).toBe(color);
  expect(items[0].color).not.toBe(color);

  await rightClick(90 + 24, 85 + 24);
  await menu.locator(".wb-context-item button", { hasText:"맨 뒤로" }).click();
  items = await itemSummary(page);
  expect(items[0].color).toBe(color);                              // 고른 둘이 맨 밑 두 층으로
  expect(items[1].color).toBe(color);
  expect(items[2].color).not.toBe(color);

  await page.keyboard.press("Control+z");                          // 맨 뒤로 → 되돌리기 한 번
  items = await itemSummary(page);
  expect(items[3].color).toBe(color);
  expect(errors).toEqual([]);
});

test("맞춤은 전체 상자 가장자리에 맞추고, 간격 고르게는 양 끝을 두고 사이 틈을 같게 한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  const box = await canvas.boundingBox();
  const menu = page.locator(".wb-focus-context-menu");
  await pickTool(page, "rect");
  await drag(page, canvas, [60, 60], [120, 110]);      // 폭 60
  await drag(page, canvas, [150, 150], [230, 200]);    // 폭 80 — 일부러 가운데 쪽으로 치우치게
  await drag(page, canvas, [400, 90], [440, 130]);     // 폭 40
  await pickTool(page, "select");
  await page.keyboard.press("Control+a");

  const openAlign = async () => {
    await page.mouse.click(box.x + 90, box.y + 85, { button:"right" });
    await expect(menu.locator(".wb-context-align-section")).toBeVisible();
  };
  await openAlign();
  await menu.locator(".wb-context-align-section button", { hasText:"위" }).click();
  expect((await rects(page)).map((r) => r.y)).toEqual([60, 60, 60]);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+a");                          // 되돌리기는 선택을 푼다(한 개 선택과 같은 규칙)

  await openAlign();
  await menu.locator(".wb-context-align-section button", { hasText:"가로 간격" }).click();
  const list = await rects(page);
  const widths = [60, 80, 40];
  const gap1 = list[1].x - (list[0].x + widths[0]), gap2 = list[2].x - (list[1].x + widths[1]);
  expect(list[0].x).toBe(60);
  expect(list[2].x).toBe(400);                                     // 양 끝은 그대로
  expect(gap1).toBeCloseTo(gap2, 5);
  expect(errors).toEqual([]);
});

test("화살표 키로 고른 것을 옮기고, 누르고 있던 이동은 되돌리기 한 번에 돌아온다", async ({ page }) => {
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);
  const before = await rects(page);

  await drag(page, canvas, [30, 30], [260, 140], "Control");
  for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowRight");   // 키 반복처럼 누른 채
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");

  let after = await rects(page);
  expect(after[0].x - before[0].x).toBe(5);
  expect(after[1].y - before[1].y).toBe(10);
  expect(after[2]).toEqual(before[2]);

  await page.keyboard.press("Control+z");                          // Shift+↓ 한 단계
  after = await rects(page);
  expect(after[0].y).toBe(before[0].y);
  expect(after[0].x - before[0].x).toBe(5);
  await page.keyboard.press("Control+z");                          // → 다섯 번이 한 단계
  expect(await rects(page)).toEqual(before);
});

test("그림이 섞여도 묶이고, 복구본·녹화·붙여넣기에서 그룹 안 그림이 살아 있다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  const box = await canvas.boundingBox();
  const menu = page.locator(".wb-focus-context-menu");
  await pickTool(page, "rect");
  await drag(page, canvas, [60, 60], [120, 110]);
  await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 40; c.height = 30;
    const g = c.getContext("2d"); g.fillStyle = "#ff0000"; g.fillRect(0, 0, 40, 30);
    await docs.find((d) => d.id === activeId).insertBoardImage(c.toDataURL("image/png"));
  });
  await expect.poll(() => page.evaluate(() => docs.find((d) => d.id === activeId).boardState.items.length)).toBe(2);

  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  const grouped = await page.evaluate(() => {
    const doc = docs.find((d) => d.id === activeId);
    const group = doc.boardState.items[0];
    const image = group.items.find((it) => it.type === "image");
    doc.flushBoardRecovery();
    const saved = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("화이트보드") && localStorage.getItem(k).includes('"group"'))));
    const savedImage = saved.items[0].items.find((it) => it.type === "image");
    const lesson = lessonSerializeItems(doc.boardState.items)[0].items.find((it) => it.type === "image");
    return {
      count:doc.boardState.items.length, type:group.type, live:!!(image && image.img && image.img.complete),
      savedSrc:String(savedImage.src).slice(0, 15), savedHasImg:"img" in savedImage,
      lessonSrc:String(lesson.src).slice(0, 15),
    };
  });
  expect(grouped).toEqual({ count:1, type:"group", live:true, savedSrc:"data:image/png;", savedHasImg:false, lessonSrc:"data:image/png;" });

  // 그룹을 복사 → 지우기 → 붙여넣기: 붙여넣은 그룹 속 그림도 불러와져 있어야 한다.
  const group = await page.evaluate(() => { const g = docs.find((d) => d.id === activeId).boardState.items[0]; return { x:g.x, y:g.y, w:g.w, h:g.h }; });
  const inside = { x:box.x + group.x + group.w / 2, y:box.y + group.y + group.h / 2 };
  await page.mouse.click(inside.x, inside.y, { button:"right" });
  await menu.locator(".wb-context-item button", { hasText:"복사" }).click();
  await page.keyboard.press("Delete");
  await page.mouse.click(box.x + 500, box.y + 300, { button:"right" });
  await menu.locator(".wb-context-board button", { hasText:"붙여넣기" }).click();
  await expect.poll(() => page.evaluate(() => {
    const g = docs.find((d) => d.id === activeId).boardState.items[0];
    const image = g && g.items && g.items.find((it) => it.type === "image");
    return !!(image && image.img && image.img.complete);
  })).toBe(true);
  expect(errors).toEqual([]);
});

test("여러 개·그룹 속 수식도 색은 다시 그려 한 번에, S/M/L 은 크기로 바뀐다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  const box = await canvas.boundingBox();
  const menu = page.locator(".wb-focus-context-menu");
  const model = () => page.evaluate(() => docs.find((d) => d.id === activeId).boardState.items.map((it) => ({
    type:it.type, role:it.role || "", color:it.formulaColor || it.color || "", src:it.src || "", x:it.x, y:it.y, w:it.w, h:it.h,
    baseW:it.formulaBaseW, width:it.width, sourceW:it.sourceW,
    children:(it.items || []).map((c) => ({ role:c.role || "", color:c.formulaColor || c.color || "", w:c.w, baseW:c.formulaBaseW, live:!!(c.img && c.img.complete) })),
  })));

  // 수식 둘을 실제 수식 창으로 넣고, 겹치지 않게 자리만 벌려 둔다.
  await page.mouse.click(box.x + 600, box.y + 400, { button:"right" });
  await menu.locator(".wb-context-board button", { hasText:"수학·과학" }).click();
  const panel = page.locator(".wb-edu-panel").last();
  await panel.locator(".wb-edu-tab", { hasText:/^수식$/ }).click();
  for (const source of ["x^2", String.raw`\frac{a}{b}`]){
    const before = (await model()).length;
    // 다른 만들기 창도 같은 입력·넣기 클래스를 쓴다 — 보이는 것만 집는다.
    await panel.locator(".wb-formula-input:visible").fill(source);
    await panel.locator(".wb-formula-insert:visible").click();
    await expect.poll(async () => (await model()).length).toBe(before + 1);
  }
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const items = docs.find((d) => d.id === activeId).boardState.items;
    items[0] = Object.assign({}, items[0], { x:60, y:60 });
    items[1] = Object.assign({}, items[1], { x:320, y:220 });
  });
  await pickTool(page, "rect");
  await drag(page, canvas, [60, 260], [140, 320]);
  await pickTool(page, "select");

  const swatchColor = (swatch) => swatch.evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
    return "#" + m.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
  });
  const start = await model();
  const onFormula = async () => {
    const f = (await model())[0];
    await page.mouse.click(box.x + f.x + f.w / 2, box.y + f.y + f.h / 2, { button:"right" });
    await expect(menu).toBeVisible();
  };

  // ① 여러 개 색: 수식 둘은 새 그림(src)으로, 사각형은 색으로 — 되돌리기 한 번에 전부 돌아온다.
  await page.keyboard.press("Control+a");
  await onFormula();
  await expect(menu.locator(".wb-context-target")).toHaveText("3개 항목");
  const red = menu.locator(".wb-context-swatch").nth(2);
  const redColor = await swatchColor(red);
  await red.click();
  await expect.poll(async () => (await model()).map((it) => it.color)).toEqual([redColor, redColor, redColor]);
  let now = await model();
  expect(now[0].src).not.toBe(start[0].src);
  expect([now[0].x, now[0].w]).toEqual([start[0].x, start[0].w]);   // 색만 바뀌고 자리·크기는 그대로
  await page.keyboard.press("Control+z");
  expect((await model()).map((it) => it.color)).toEqual(start.map((it) => it.color));

  // ② 여러 개 L: 수식은 원래 크기의 1.5배(가운데 기준), 사각형은 굵기 8.
  await page.keyboard.press("Control+a");
  await onFormula();
  await menu.locator(".wb-context-width", { hasText:"L" }).click();
  now = await model();
  expect(now[0].w).toBe(Math.round(start[0].baseW * 1.5));
  expect(now[0].x + now[0].w / 2).toBeCloseTo(start[0].x + start[0].w / 2, 0);
  expect(now[2].width).toBe(8);

  // ③ 묶은 그룹 한 개: 속 수식도 색이 다시 그려지고, S 로 줄이면 그룹 상자가 자식에 맞춰 다시 잡힌다.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  const grouped = (await model())[0];
  await page.mouse.click(box.x + grouped.x + 5, box.y + grouped.y + 5, { button:"right" });
  await expect(menu.locator(".wb-context-target")).toHaveText("그룹");
  const blue = menu.locator(".wb-context-swatch").nth(3);
  const blueColor = await swatchColor(blue);
  await blue.click();
  await expect.poll(async () => (await model())[0].children.map((c) => c.color)).toEqual([blueColor, blueColor, blueColor]);
  expect((await model())[0].children.every((c) => c.role !== "education-formula" || c.live)).toBe(true);

  await page.mouse.click(box.x + grouped.x + 5, box.y + grouped.y + 5, { button:"right" });
  await menu.locator(".wb-context-width", { hasText:"S" }).click();
  const small = (await model())[0];
  const formulaChild = small.children.find((c) => c.role === "education-formula");
  expect(formulaChild.w).toBe(Math.round(formulaChild.baseW * .75));
  expect(small.sourceW).toBeCloseTo(small.w, 5);                     // 비율 1 그대로 상자만 다시 잡힘
  expect(errors).toEqual([]);
});

test("Ctrl+A 로 전부 고르고, 메뉴로 복사한 여러 개를 빈 곳에 붙여넣는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const canvas = await openBoard(page);
  await drawThreeRects(page, canvas);
  const box = await canvas.boundingBox();
  const menu = page.locator(".wb-focus-context-menu");

  await page.keyboard.press("Control+a");
  await page.mouse.click(box.x + 90, box.y + 85, { button:"right" });
  await expect(menu.locator(".wb-context-target")).toHaveText("3개 항목");
  await menu.locator(".wb-context-item button", { hasText:"복사" }).click();
  await page.keyboard.press("Delete");
  expect(await rects(page)).toHaveLength(0);

  await page.mouse.click(box.x + 500, box.y + 300, { button:"right" });
  await menu.locator(".wb-context-board button", { hasText:"붙여넣기" }).click();
  await expect.poll(() => rects(page).then((list) => list.length)).toBe(3);
  await page.keyboard.press("Delete");                             // 붙여넣은 셋이 골라진 채다
  expect(await rects(page)).toHaveLength(0);
  expect(errors).toEqual([]);
});
