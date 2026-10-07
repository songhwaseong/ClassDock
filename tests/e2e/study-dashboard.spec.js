const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 암기장 위쪽 판(시안 A + E 의 동그라미). 여기서만 확인할 수 있는 것 — 숫자 타일을 누르면 목록이
   실제로 그 카드만 남는지, 학습 시작이 지금 보이는 카드로 시작하는지, 오늘 복습 동그라미가
   '오늘 끝낸 장수 / (끝낸 + 남은)' 만큼 칠해지는지. */

const day = (offset) => {
  const date = new Date(); date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const TODAY = day(0);

// 오늘 끝낸 카드 1장(알아요, 다음 복습 3일 뒤) · 틀림 1장(오늘 다시) · 헷갈림 1장(내일) · 새 카드 1장
const SOURCE = JSON.stringify({
  type:"classdock-study", version:1, title:"동그라미 시험",
  cards:[
    { id:"done",  front:"abundant 의 뜻", back:"풍부한", result:"good", reviews:1, streak:1, due:day(3), lastReviewed:TODAY },
    { id:"again", front:"광합성이 일어나는 곳", back:"엽록체", result:"again", reviews:1, due:TODAY, lastReviewed:TODAY },
    { id:"hard",  front:"임진왜란이 일어난 해", back:"1592년", result:"hard", reviews:1, due:day(1), lastReviewed:day(-1) },
    { id:"new",   front:"물의 화학식", back:"H2O" }
  ]
});

async function openStudy(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name:"동그라미 시험.study", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8") });
  await expect(page.locator(".study-list-card")).toHaveCount(4);
}

const tile = (page, filter) => page.locator(`.study-tile[data-filter="${filter}"]`);
const listIds = (page) => page.locator(".study-list-card").evaluateAll((cards) => cards.map((card) => card.dataset.cardId));

test("숫자 타일은 장수를 보여 주고, 누르면 목록이 그 카드만 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openStudy(page);

  const counts = await page.locator(".study-tile").evaluateAll((tiles) =>
    Object.fromEntries(tiles.map((el) => [el.dataset.filter, el.querySelector(".study-tile-count").textContent])));
  // 오늘 복습 = 틀림(오늘) + 새 카드 — 끝낸 카드와 내일 볼 헷갈림은 빠진다
  expect(counts).toEqual({ all:"4", due:"2", wrong:"1", hard:"1", new:"1" });
  await expect(tile(page, "all")).toHaveAttribute("aria-pressed", "true");

  await tile(page, "due").click();
  await expect(tile(page, "due")).toHaveAttribute("aria-pressed", "true");
  await expect(tile(page, "all")).toHaveAttribute("aria-pressed", "false");
  expect(await listIds(page)).toEqual(["again", "new"]);
  await expect(page.locator(".study-start .study-start-count")).toHaveText("2");

  // 찾는 말은 고른 타일 안에서 한 번 더 거른다
  await page.locator(".study-search").fill("물");
  expect(await listIds(page)).toEqual(["new"]);
  await expect(page.locator(".study-start .study-start-count")).toHaveText("1");

  // 조건에 맞는 카드가 없으면 '전체 카드 보기'로 돌아갈 수 있다
  await page.locator(".study-search").fill("");
  await tile(page, "hard").click();
  await page.locator(".study-search").fill("물");
  await expect(page.locator(".study-empty")).toHaveText("검색 결과가 없습니다");
  await page.locator(".study-search").fill("");
  expect(await listIds(page)).toEqual(["hard"]);
  expect(errors).toEqual([]);
});

test("학습 시작은 지금 보이는 카드로 시작한다", async ({ page }) => {
  await openStudy(page);
  await tile(page, "wrong").click();
  await page.locator(".study-start").click();
  await expect(page.locator(".study-session")).toBeVisible();
  await expect(page.locator(".study-session-count")).toHaveText("1 / 1");
  await expect(page.locator(".study-session-card h2")).toHaveText("광합성이 일어나는 곳");
});

test("오늘 복습 동그라미는 끝낸 만큼 칠하고 가운데에 남은 장수를 쓴다", async ({ page }) => {
  await openStudy(page);
  const ring = page.locator(".study-ring");
  await expect(ring.locator("strong")).toHaveText("2");
  await expect(ring.locator("small")).toHaveText("남은 복습");
  await expect(ring).toHaveAttribute("aria-label", "오늘 복습 1 / 3");
  // 끝낸 1장 / (끝낸 1 + 남은 2) = 33%
  expect(await ring.locator(".study-ring-fill").evaluate((el) => el.style.strokeDasharray)).toBe("33, 100");

  // 남은 두 장을 '알아요'로 끝내면 다 칠해지고 끝 표시로 바뀐다
  await tile(page, "due").click();
  await page.locator(".study-start").click();
  for (let at = 0; at < 2; at++){
    await page.locator(".study-reveal").click();
    await page.locator('.study-ratings [data-rate="good"]').click();
  }
  await page.locator(".study-session-done button").click();
  await expect(ring).toHaveClass(/is-done/);
  await expect(ring.locator("small")).toHaveText("오늘 끝");
  await expect(ring.locator("strong svg.ui-icon")).toHaveCount(1);
  expect(await ring.locator(".study-ring-fill").evaluate((el) => el.style.strokeDasharray)).toBe("100, 100");
});
