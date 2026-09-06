const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 관계도 검색은 카드를 지우지 않고 흐리게(is-muted) 할 뿐이다.
   예전에는 input 이 곧장 render 라 한 글자에 카드 DOM 전체를 새로 지었고, 카드 사진이
   base64 data URL 이라 <img> 를 다시 만드는 순간 이미지도 다시 디코딩됐다.
   지금은 이미 있는 카드의 클래스만 토글한다 — 그래서 "다시 만들지 않는다"까지 함께 본다. */

// 카드는 캔버스 한복판에 둔다 — 구석(0,0 근처)에 두면 앱 헤더가 덮어 단추를 누를 수 없다.
const NODES = [
  { id:"sun",   title:"햇빛",   category:"에너지", description:"바다를 데운다",       x:560,  y:420 },
  { id:"vapor", title:"수증기", category:"물질",   description:"공기 중으로 올라간다", x:1200, y:420 },
  { id:"cloud", title:"구름",   category:"물질",   description:"모여서 비가 된다",     x:560,  y:760 },
];
const SOURCE = JSON.stringify({
  type:"classdock-concept", version:1, title:"물의 순환",
  nodes:NODES, edges:[{ id:"e1", from:"sun", to:"vapor", type:"cause", label:"데워서" }],
});

const card = (page, id) => page.locator(`.concept-card[data-node-id="${id}"]`);
const mutedIds = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".concept-card.is-muted")].map(el => el.dataset.nodeId).sort());

// 카드 요소마다 표식을 찍어 둔다. 검색 뒤에도 남아 있으면 그 카드는 다시 만들어지지 않은 것이다.
const stampCards = (page) => page.evaluate(() =>
  document.querySelectorAll(".concept-card").forEach((el, index) => { el.dataset.probe = "p" + index; }));
const stamps = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".concept-card")].map(el => el.dataset.probe || ""));

async function openConcept(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name:"물의 순환.concept", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8"),
  });
  await expect(page.locator(".concept-doc")).toBeVisible();
  await expect(page.locator(".concept-card")).toHaveCount(3);
  return page.locator(".concept-search");
}

test.describe("관계도 검색", () => {
  test("찾는 말과 어긋난 카드만 흐려지고, 지우면 모두 돌아온다", async ({ page }) => {
    const search = await openConcept(page);
    await expect(page.locator(".concept-card.is-muted")).toHaveCount(0);

    // 이름으로 찾기 — 햇빛만 남는다.
    await search.fill("햇빛");
    expect(await mutedIds(page)).toEqual(["cloud", "vapor"]);
    await expect(card(page, "sun")).not.toHaveClass(/is-muted/);

    // 분류로도 찾힌다(제목·분류·설명을 함께 본다).
    await search.fill("물질");
    expect(await mutedIds(page)).toEqual(["sun"]);

    // 설명 안의 말로도 찾힌다.
    await search.fill("비가 된다");
    expect(await mutedIds(page)).toEqual(["sun", "vapor"]);

    // 아무것도 안 걸리면 전부 흐려진다 — 카드가 사라지는 게 아니라 흐려질 뿐이다.
    await search.fill("고래");
    expect(await mutedIds(page)).toEqual(["cloud", "sun", "vapor"]);
    await expect(page.locator(".concept-card")).toHaveCount(3);

    // 지우면 모두 제 모습으로.
    await search.fill("");
    await expect(page.locator(".concept-card.is-muted")).toHaveCount(0);
  });

  test("타자를 쳐도 카드를 다시 만들지 않는다", async ({ page }) => {
    const search = await openConcept(page);
    await stampCards(page);
    expect(await stamps(page)).toEqual(["p0", "p1", "p2"]);

    // 한 글자씩 치고 지워도 표식이 그대로면 같은 요소를 계속 쓰고 있는 것이다.
    await search.pressSequentially("수증기", { delay:20 });
    expect(await mutedIds(page)).toEqual(["cloud", "sun"]);
    expect(await stamps(page)).toEqual(["p0", "p1", "p2"]);

    await search.fill("");
    expect(await stamps(page)).toEqual(["p0", "p1", "p2"]);
  });

  test("찾는 말을 켜 둔 채 카드가 다시 그려져도 흐림이 유지된다", async ({ page }) => {
    const search = await openConcept(page);
    await search.fill("구름");
    expect(await mutedIds(page)).toEqual(["sun", "vapor"]);
    await stampCards(page);

    // 고정 단추는 model 을 바꾸므로 카드 전체를 다시 그린다(render).
    // 이때 검색 조건을 다시 걸지 않으면 흐림이 통째로 풀려 버린다 — 갈라 놓은 뒤 가장 깨지기 쉬운 곳이다.
    await card(page, "sun").locator(".concept-card-pin").click();
    expect(await stamps(page)).toEqual(["", "", ""]);            // 정말 다시 그려졌다
    expect(await mutedIds(page)).toEqual(["sun", "vapor"]);      // 그래도 흐림은 그대로
    await expect(search).toHaveValue("구름");
  });
});
