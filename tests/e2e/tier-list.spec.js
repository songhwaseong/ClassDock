const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 티어표 — 카드를 끌어 줄에 올리고, 줄 안 차례를 바꾸고, 숫자 키로 보내고, 되돌리기까지.
   포인터 이벤트로 직접 짠 끌기라 실제 마우스 좌표로 움직여 본다. */
const TIERS = [
  { id:"S", label:"S", color:"#ff7f7f" }, { id:"A", label:"A", color:"#ffbf7f" }, { id:"B", label:"B", color:"#ffdf7f" }
];
const ITEMS = ["떡볶이", "라면", "김밥"].map((text, index) => ({ id:"c" + index, tier:"", text }));
const SOURCE = JSON.stringify({ type:"classdock-tier", version:1, title:"간식", cardSize:"m", tiers:TIERS, items:ITEMS });

async function openTier(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name:"간식.tier", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8") });
  await expect(page.locator(".tier-doc")).toBeVisible();
  await expect(page.locator(".tier-row")).toHaveCount(3);
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(3);
}
const ids = (page, selector) => page.locator(selector + " .tier-item").evaluateAll(els => els.map(el => el.dataset.itemId));

async function drag(page, from, to, offset){
  const a = await from.boundingBox(), b = await to.boundingBox();
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const tx = offset ? b.x + offset.x : b.x + b.width - 20, ty = offset ? b.y + offset.y : b.y + b.height / 2;
  await page.mouse.move(tx, ty, { steps:12 });
  await page.mouse.up();
}

test("카드를 끌어 줄에 올리고 차례를 바꾸고, 숫자 키·되돌리기가 된다", async ({ page }) => {
  await openTier(page);
  const rowS = page.locator('.tier-items[data-tier="S"]');
  await drag(page, page.locator('.tier-item[data-item-id="c1"]'), rowS);
  await expect.poll(() => ids(page, '.tier-items[data-tier="S"]')).toEqual(["c1"]);
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(2);

  // 같은 줄의 첫 카드 왼쪽 가장자리에 놓으면 그 앞에 들어간다
  await drag(page, page.locator('.tier-item[data-item-id="c2"]'), page.locator('.tier-items[data-tier="S"] .tier-item[data-item-id="c1"]'), { x:4, y:20 });
  await expect.poll(() => ids(page, '.tier-items[data-tier="S"]')).toEqual(["c2", "c1"]);

  // 카드를 한 번 누르고 숫자 2 → A 줄로
  await page.locator('.tier-item[data-item-id="c0"]').click();
  await page.keyboard.press("2");
  await expect.poll(() => ids(page, '.tier-items[data-tier="A"]')).toEqual(["c0"]);

  await page.keyboard.press("Control+z");
  await expect.poll(() => ids(page, '.tier-items[data-tier="A"]')).toEqual([]);

  // 줄 설정 — 이름 바꾸기
  await page.locator('.tier-row[data-tier-row="B"] .tier-label').click();
  await page.locator(".tier-modal .tf-label").fill("별로");
  await page.locator(".tier-modal .tf-save").click();
  await expect(page.locator('.tier-row[data-tier-row="B"] .tier-label')).toHaveText("별로");

  // 그림(PNG) 그리기가 오류 없이 끝나는지
  const png = await page.evaluate(() => tierRenderPng(docs.find(d => d.kind === "tier").tierDoc));
  expect(png.startsWith("data:image/png;base64,")).toBe(true);
});

// 1×1 빨간 점 PNG
const DOT = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

test("사진 여러 장을 넣으면 아래 모음에 사진 카드로 들어가고 저장 안 됨이 된다", async ({ page }) => {
  await openTier(page);
  await page.locator(".tier-doc input[type=file]").setInputFiles([
    { name:"a.png", mimeType:"image/png", buffer:DOT }, { name:"b.png", mimeType:"image/png", buffer:DOT }
  ]);
  await expect(page.locator(".tier-pool .tier-item img")).toHaveCount(2);
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(5);
  const saved = await page.evaluate(() => { const doc = docs.find(d => d.kind === "tier"); return { dirty:!!doc.hasUnsavedEdits, json:tierDocSerialize(doc.tierDoc) }; });
  expect(saved.dirty).toBe(true);
  expect(JSON.parse(saved.json).items.filter(item => item.image).length).toBe(2);
});
