const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 카드를 끄는 동안 관계선을 다시 만들지 않고 좌표만 고친다.
   예전에는 매 pointermove 가 renderEdges 로 전체를 헐고 다시 지었다(선 하나에 SVG 5개·리스너 4개).
   그래서 여기서는 결과(선이 따라오는가)만이 아니라 방법(다시 만들지 않는가)까지 함께 본다 —
   "부분 갱신"은 되돌려 놓아도 화면상 티가 안 나서, 결과만 보면 조용히 예전으로 돌아간다. */

const NODES = [
  { id:"sun",   title:"햇빛",   x:520, y:360 },
  { id:"vapor", title:"수증기", x:900, y:360 },
  { id:"cloud", title:"구름",   x:520, y:600 },
];
const EDGES = [
  { id:"heat", from:"sun",   to:"vapor", type:"cause", label:"데워서" },   // 끄는 카드에 닿는 선
  { id:"fall", from:"vapor", to:"cloud", type:"cause", label:"내려서" },   // 닿지 않는 선
];
const SOURCE = JSON.stringify({ type:"classdock-concept", version:1, title:"물의 순환", nodes:NODES, edges:EDGES });

// 선 세 겹(판정선·후광·본선)은 늘 같은 d 를 써야 한다 — placeEdge 한 곳에서 정하므로 어긋나면 회귀다.
const edgeGeometry = (page) => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll(".concept-edge")].map((group) => {
    const label = group.querySelector(".concept-edge-label");
    return [group.dataset.edgeId, {
      path:group.querySelector(".concept-edge-path").getAttribute("d"),
      hit:group.querySelector(".concept-edge-hit").getAttribute("d"),
      halo:group.querySelector(".concept-edge-halo").getAttribute("d"),
      label:label.getAttribute("x") + "," + label.getAttribute("y"),
    }];
  })));

const stampEdges = (page) => page.evaluate(() =>
  document.querySelectorAll(".concept-edge").forEach((group, index) => { group.dataset.probe = "p" + index; }));
const edgeProbes = (page) => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll(".concept-edge")].map((group) => [group.dataset.edgeId, group.dataset.probe || ""])));

async function openConcept(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name:"물의 순환.concept", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8"),
  });
  await expect(page.locator(".concept-doc")).toBeVisible();
  await expect(page.locator(".concept-card")).toHaveCount(3);
  await expect(page.locator(".concept-edge")).toHaveCount(2);
}

// 카드 왼쪽 아래를 잡는다 — 오른쪽 위에는 고정·수정 단추가 있어 끌기가 시작되지 않는다.
async function dragCard(page, nodeId, dx, dy){
  const card = page.locator(`.concept-card[data-node-id="${nodeId}"]`);
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box, `${nodeId} 카드가 화면 안에 있어야 끌 수 있다`).not.toBeNull();
  const startX = box.x + 24, startY = box.y + box.height - 16;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps:12 });   // steps 로 pointermove 를 여러 번 흘린다
  await page.mouse.up();
}

test.describe("관계도 카드 끌기", () => {
  test("닿은 선만 따라오고, 닿지 않은 선은 그대로다", async ({ page }) => {
    await openConcept(page);
    const before = await edgeGeometry(page);

    await dragCard(page, "sun", 90, 70);

    const after = await edgeGeometry(page);
    // 햇빛에 닿은 선은 선 세 겹과 이름표가 모두 움직인다.
    expect(after.heat.path).not.toBe(before.heat.path);
    expect(after.heat.label).not.toBe(before.heat.label);
    // 햇빛과 상관없는 선은 손대지 않는다 — 전체를 다시 그렸다면 값은 같아도 요소가 바뀐다(아래 테스트).
    expect(after.fall).toEqual(before.fall);
  });

  test("선 세 겹은 늘 같은 좌표를 쓴다", async ({ page }) => {
    await openConcept(page);
    await dragCard(page, "sun", -60, 40);
    const geometry = await edgeGeometry(page);
    for (const [id, edge] of Object.entries(geometry)){
      expect(edge.hit, `${id} 판정선`).toBe(edge.path);
      expect(edge.halo, `${id} 후광`).toBe(edge.path);
    }
  });

  test("끄는 동안 관계선을 다시 만들지 않는다", async ({ page }) => {
    await openConcept(page);
    await stampEdges(page);
    expect(await edgeProbes(page)).toEqual({ heat:"p0", fall:"p1" });

    await dragCard(page, "sun", 70, 50);

    // 표식이 남아 있으면 같은 SVG 요소를 계속 쓴 것이다(헐고 다시 지었다면 지워진다).
    expect(await edgeProbes(page)).toEqual({ heat:"p0", fall:"p1" });
  });

  test("끌고 난 선도 그대로 눌러 고를 수 있다", async ({ page }) => {
    await openConcept(page);
    await dragCard(page, "sun", 80, 60);

    /* 요소를 다시 만들지 않으므로 click·hover 리스너도 처음 것이 그대로 살아 있어야 한다.
       선은 카드 한복판에서 나오므로 양 끝은 카드가 덮는다. 카드를 옮기고 나면 어디가 드러나는지
       달라지므로, 고정된 지점을 쓰지 않고 실제로 드러난 첫 지점을 찾아 누른다. */
    const spot = await page.evaluate(() => {
      const path = document.querySelector('.concept-edge[data-edge-id="heat"] .concept-edge-hit');
      for (const at of [.5, .45, .55, .4, .6, .35, .65]){
        const point = path.getPointAtLength(path.getTotalLength() * at);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
        const under = document.elementFromPoint(screen.x, screen.y);
        if (under && under.closest(".concept-edge")) return { x:screen.x, y:screen.y };
      }
      throw new Error("관계선이 어디에서도 드러나지 않는다 — 카드가 선을 통째로 덮었다");
    });
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator(".concept-edge.is-selected")).toHaveCount(1);
    await expect(page.locator(".concept-edge-picked")).toHaveText(/관계선 1개 선택/);
  });

  test("자리를 옮긴 뒤 되돌리면 선도 함께 제자리로 온다", async ({ page }) => {
    await openConcept(page);
    const before = await edgeGeometry(page);

    await dragCard(page, "sun", 100, 80);
    expect((await edgeGeometry(page)).heat.path).not.toBe(before.heat.path);

    // 되돌리기는 model.nodes 를 통째로 바꾸고 render 로 다시 그린다 — 부분 갱신용 색인도 함께 새로 만들어져야 한다.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await edgeGeometry(page)).heat.path).toBe(before.heat.path);

    // 되돌린 뒤에도 끌기가 다시 정상 동작한다(색인이 새 node 객체를 가리키는지 확인).
    await dragCard(page, "sun", 60, 40);
    expect((await edgeGeometry(page)).heat.path).not.toBe(before.heat.path);
  });
});
