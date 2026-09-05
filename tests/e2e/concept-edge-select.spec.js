const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 관계선 고르기: 선이 2.5px 뿐이라 예전에는 손을 올려도 커서만 바뀌었다.
// 이제 투명한 판정선(.concept-edge-hit)이 밑에 깔려 손만 올려도 옅은 후광이 뜨고,
// 고르면 선이 accent 색으로 굵어지며 진한 후광이 남는다(Ctrl+클릭이면 여러 개).
// 카드는 캔버스 1800×1100의 한복판에 둔다(구석에 두면 선이 화면 밖이라 마우스로 누를 수 없다).
const SUN = { id:"sun", title:"햇빛", x:560, y:420 }, VAPOR = { id:"vapor", title:"수증기", x:1200, y:420 }, CLOUD = { id:"cloud", title:"구름", x:560, y:760 };
const HEAT = { id:"heat", from:"sun", to:"vapor", type:"cause", label:"데워서" }, RISE = { id:"rise", from:"sun", to:"cloud", type:"cause", label:"올라가" };
const doc = (nodes, edges) => JSON.stringify({ type:"classdock-concept", version:1, title:"물의 순환", nodes, edges });
// 구름은 관계가 없는 카드다. 선을 훑을 때 두 끝만 밝아지는지 보려고 함께 둔다.
const ONE_EDGE = doc([SUN, VAPOR, CLOUD], [HEAT]);
const TWO_EDGES = doc([SUN, VAPOR, CLOUD], [HEAT, RISE]);

// 선 위의 한 점을 화면 좌표로 집는다. 판정선은 채움이 없어 상자가 납작하므로 locator 클릭 대신 이 좌표로 누른다.
// 앞쪽 3분의 1 지점을 쓰는 이유: 선은 카드 한복판에서 나오므로 시작 부분은 카드가, 가운데는 관계 이름 글자가 덮고 있다.
const spotOnLine = (page, index) => page.evaluate(i => {
  const path = document.querySelectorAll(".concept-edge-hit")[i], point = path.getPointAtLength(path.getTotalLength() * .35);
  const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
  const under = document.elementFromPoint(screen.x, screen.y);
  if (!under || !under.closest(".concept-edge")) throw new Error("관계선이 화면 밖이거나 가려져 있다: " + (under && under.className.baseVal !== undefined ? under.className.baseVal : under && under.className));
  return { x: screen.x, y: screen.y };
}, index);
const strokeOf = (page, selector) => page.locator(selector).evaluate(el => getComputedStyle(el).stroke);
const ctrlClick = async (page, spot) => { await page.keyboard.down("Control"); await page.mouse.click(spot.x, spot.y); await page.keyboard.up("Control"); };

async function openConcept(page, source = ONE_EDGE, edgeCount = 1){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "물의 순환.concept", mimeType: "application/json", buffer: Buffer.from(source, "utf8")
  });
  await expect(page.locator(".concept-doc")).toBeVisible();
  await expect(page.locator(".concept-edge-hit")).toHaveCount(edgeCount);
  const spots = [];
  for (let index = 0; index < edgeCount; index++) spots.push(await spotOnLine(page, index));
  return spots;
}

test.describe("관계도 관계선 고르기", () => {
  test("손만 올린 선과 골라 둔 선은 눈에 띄게 다르다", async ({ page }) => {
    const [spot] = await openConcept(page);
    const edge = page.locator(".concept-edge"), line = page.locator(".concept-edge-path");

    // 아무것도 안 했을 때: 후광은 없고 선은 제 색·제 굵기.
    await expect(line).toHaveCSS("stroke-width", "2.5px");
    expect(await strokeOf(page, ".concept-edge-halo")).toBe("rgba(0, 0, 0, 0)");
    const plainColor = await strokeOf(page, ".concept-edge-path");
    // 누르는 자리는 늘 투명하다(후광과 따로라 굵기를 마음껏 정할 수 있다).
    expect(await strokeOf(page, ".concept-edge-hit")).toBe("rgba(0, 0, 0, 0)");

    // 손만 올리면: 옅은 후광에 선은 오히려 얌전하게(3px). 고른 것과 헷갈리지 않게 한 단계 낮춰 둔다.
    await page.mouse.move(spot.x, spot.y);
    await expect(line).toHaveCSS("stroke-width", "3px");
    const hoverHalo = await strokeOf(page, ".concept-edge-halo");
    expect(hoverHalo).not.toBe("rgba(0, 0, 0, 0)");
    expect(await strokeOf(page, ".concept-edge-hit")).toBe("rgba(0, 0, 0, 0)");

    // 고르면: accent 색으로 굵어지고(5px) 후광도 진해진다. 손을 치워도 그대로 남는다.
    await page.mouse.click(spot.x, spot.y);
    await expect(edge).toHaveClass(/is-selected/);
    await page.mouse.move(5, 5);
    await expect(line).toHaveCSS("stroke-width", "5px");
    expect(await strokeOf(page, ".concept-edge-path")).not.toBe(plainColor);
    expect(await strokeOf(page, ".concept-edge-halo")).not.toBe(hoverHalo);
  });

  test("마우스로 다른 곳을 만져도 관계선 선택은 남고, Esc 로만 풀린다", async ({ page }) => {
    const [spot] = await openConcept(page);
    const edge = page.locator(".concept-edge");

    await page.mouse.click(spot.x, spot.y);
    await expect(edge).toHaveClass(/is-selected/);

    // 빈 여백을 눌러도(화면 끌기를 시작해도) 그대로 남는다.
    await page.locator(".concept-viewport").click({ position: { x: 20, y: 20 } });
    await expect(edge).toHaveClass(/is-selected/);

    // 카드를 골라도 그대로다. 카드 선택과 관계선 선택은 서로 건드리지 않는다.
    await page.locator(".concept-card", { hasText: "구름" }).click();
    await expect(page.locator(".concept-card.is-selected")).toHaveCount(1);
    await expect(edge).toHaveClass(/is-selected/);
    await expect(page.locator(".concept-present")).toBeVisible();   // 카드를 누르면 큰 카드 보기가 뜬다
    await page.keyboard.press("Escape");                            // 첫 Esc 는 큰 카드 보기부터 닫는다
    await expect(page.locator(".concept-present")).toHaveCount(0);
    await expect(edge).toHaveClass(/is-selected/);

    // Esc 를 누르면 그제야 놓는다.
    await page.keyboard.press("Escape");
    await expect(edge).not.toHaveClass(/is-selected/);
  });

  test("선에 손을 올리면 그 선이 잇는 두 카드도 함께 밝아진다", async ({ page }) => {
    const [spot] = await openConcept(page);
    const linked = page.locator(".concept-card.is-linked");

    await expect(linked).toHaveCount(0);
    await page.mouse.move(spot.x, spot.y);
    await expect(linked).toHaveCount(2);
    await expect(page.locator(".concept-card.is-linked h3")).toHaveText(["햇빛", "수증기"]);   // 관계 없는 구름은 그대로
    await page.mouse.move(5, 5);
    await expect(linked).toHaveCount(0);

    // 고른 뒤에는 손을 치워도 두 끝이 밝은 채로 남는다.
    await page.mouse.click(spot.x, spot.y);
    await page.mouse.move(5, 5);
    await expect(linked).toHaveCount(2);

    // Esc 로 놓으면 두 끝의 밝기도 함께 사라진다.
    await page.keyboard.press("Escape");
    await expect(linked).toHaveCount(0);
  });

  test("Ctrl+클릭이면 관계선을 여러 개 겹쳐 고르고, 도구막대가 개수를 알려 준다", async ({ page }) => {
    const spots = await openConcept(page, TWO_EDGES, 2);
    const picked = page.locator(".concept-edge-picked"), chosen = page.locator(".concept-edge.is-selected");

    await expect(picked).toBeHidden();
    await page.mouse.click(spots[0].x, spots[0].y);
    await expect(chosen).toHaveCount(1);
    await expect(picked).toHaveText(/관계선 1개 선택/);

    // 하나라도 고르면 나머지 선은 한 발 물러나고, 고른 선은 맨 뒤에 다시 붙어 다른 선 위로 올라온다.
    await page.mouse.move(5, 5);
    await expect(page.locator(".concept-edge:not(.is-selected)")).toHaveCSS("opacity", "0.3");
    await expect(page.locator(".concept-lines > g").last()).toHaveClass(/is-selected/);

    // Ctrl+클릭으로 하나 더 얹으면 둘 다 골라진 채로 남는다.
    await ctrlClick(page, spots[1]);
    await expect(chosen).toHaveCount(2);
    await expect(picked).toHaveText(/관계선 2개 선택/);
    await page.mouse.move(5, 5);
    await expect(page.locator(".concept-card.is-linked")).toHaveCount(3);   // 두 선의 양 끝: 햇빛·수증기·구름

    // 이미 고른 선을 Ctrl+클릭하면 그것만 빠진다.
    await ctrlClick(page, spots[1]);
    await expect(chosen).toHaveCount(1);
    await expect(picked).toHaveText(/관계선 1개 선택/);

    // Ctrl 없이 누르면 그 선 하나만 남고, 선택 해제 버튼이나 Esc 로 모두 놓는다.
    await page.mouse.click(spots[1].x, spots[1].y);
    await expect(chosen).toHaveCount(1);
    await page.locator(".concept-edge-picked-clear").click();
    await expect(chosen).toHaveCount(0);
    await expect(picked).toBeHidden();
  });

  test("고른 관계선은 두 번 클릭이나 Delete 로 수정 창을 연다", async ({ page }) => {
    const [spot] = await openConcept(page);
    const title = page.locator(".concept-modal-card h2", { hasText: "관계 수정" });

    await page.mouse.click(spot.x, spot.y);
    await page.keyboard.press("Delete");
    await expect(title).toBeVisible();
    await page.locator(".ce-cancel").click();

    await page.mouse.dblclick(spot.x, spot.y);
    await expect(title).toBeVisible();
    await expect(page.locator(".ce-label")).toHaveValue("데워서");
  });
});
