const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 머리말·보유 카드 판이 생겨 720px 높이에선 보유 카드가 화면 아래로 밀린다 — 끌기는 두 칸이 함께 보여야 하니 창을 키운다.
test.use({ viewport:{ width:1280, height:900 } });

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
// 다른 색 1×1 PNG — 같은 사진은 한 번만 들어가므로 두 장은 서로 달라야 한다
const DOT2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("사진 여러 장을 넣으면 아래 모음에 사진 카드로 들어가고 저장 안 됨이 된다", async ({ page }) => {
  await openTier(page);
  await page.locator(".tier-doc input[type=file]").setInputFiles([
    { name:"a.png", mimeType:"image/png", buffer:DOT }, { name:"b.png", mimeType:"image/png", buffer:DOT2 }
  ]);
  await expect(page.locator(".tier-pool .tier-item img")).toHaveCount(2);
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(5);
  const saved = await page.evaluate(() => { const doc = docs.find(d => d.kind === "tier"); return { dirty:!!doc.hasUnsavedEdits, json:tierDocSerialize(doc.tierDoc) }; });
  expect(saved.dirty).toBe(true);
  expect(JSON.parse(saved.json).items.filter(item => item.image).length).toBe(2);
});

test("⠿ 손잡이로 줄을 끌어 옮기고, 지우개로 줄을 비우고, 보유 카드를 검색한다", async ({ page }) => {
  await openTier(page);
  const order = () => page.locator(".tier-row").evaluateAll(els => els.map(el => el.dataset.tierRow));
  const grip = page.locator('.tier-row[data-tier-row="B"] .tier-row-grip'), top = await page.locator('.tier-row[data-tier-row="S"]').boundingBox(), g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 6, { steps:12 }); await page.mouse.up();
  await expect.poll(order).toEqual(["B", "S", "A"]);

  // 키보드 ↓ 로도 옮긴다
  await page.locator('.tier-row[data-tier-row="B"] .tier-row-grip').focus(); await page.keyboard.press("ArrowDown");
  await expect.poll(order).toEqual(["S", "B", "A"]);

  await drag(page, page.locator('.tier-item[data-item-id="c0"]'), page.locator('.tier-items[data-tier="A"]'));
  await expect.poll(() => ids(page, '.tier-items[data-tier="A"]')).toEqual(["c0"]);
  await page.locator('.tier-row[data-tier-row="A"] .tier-row-clear').click();
  await expect.poll(order).toEqual(["S", "B", "A"]);
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(3);
  await expect(page.locator('.tier-row[data-tier-row="A"] .tier-row-clear')).toBeDisabled();

  await page.locator(".tier-search input").fill("라");
  await expect.poll(() => ids(page, ".tier-pool")).toEqual(["c1"]);
  await page.locator(".tier-search input").fill("");
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(3);
});

test("보유 카드 모두 지우기 — 검색 중이면 찾은 카드만, 줄 카드는 남고 Ctrl+Z 로 되돌린다", async ({ page }) => {
  await openTier(page);
  await page.locator('.tier-item[data-item-id="c0"]').click(); await page.keyboard.press("1");
  await expect.poll(() => ids(page, '.tier-items[data-tier="S"]')).toEqual(["c0"]);
  await page.locator(".tier-search input").fill("라");
  await page.locator(".tier-pool-clear").click(); await page.locator("#confirmOk").click();
  await page.locator(".tier-search input").fill("");
  await expect.poll(() => ids(page, ".tier-pool")).toEqual(["c2"]);
  await page.locator(".tier-pool-clear").click(); await page.locator("#confirmOk").click();
  await expect(page.locator(".tier-pool .tier-item")).toHaveCount(0);
  await expect(page.locator(".tier-pool-clear")).toBeDisabled();
  await expect.poll(() => ids(page, '.tier-items[data-tier="S"]')).toEqual(["c0"]);
  await page.locator(".tier-doc .tier-title").blur(); await page.mouse.click(5, 400);
  await page.keyboard.press("Control+z");
  await expect.poll(() => ids(page, ".tier-pool")).toEqual(["c2"]);
});

test("줄을 지워 보유 카드로 내려온 사진을 다시 올리면 겹쳐 넣지 않는다", async ({ page }) => {
  await openTier(page);
  const pngs = await page.evaluate(() => ["#e53935", "#1e88e5"].map(color => { const c = document.createElement("canvas"); c.width = c.height = 8; const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 8, 8); return c.toDataURL("image/png").split(",")[1]; }));
  const files = names => names.map((name, i) => ({ name, mimeType:"image/png", buffer:Buffer.from(pngs[i], "base64") }));
  const upload = async list => { const chooser = page.waitForEvent("filechooser"); await page.locator(".tier-bar .tier-btn", { hasText:"가져오기" }).click(); await (await chooser).setFiles(list); };
  await upload(files(["빨강.png", "파랑.png"]));
  await expect(page.locator(".tier-pool .tier-item img")).toHaveCount(2);
  await drag(page, page.locator(".tier-pool .tier-item:has(img)").first(), page.locator('.tier-items[data-tier="S"]'));
  await expect(page.locator('.tier-items[data-tier="S"] .tier-item')).toHaveCount(1);
  await page.locator('.tier-row[data-tier-row="S"] .tier-label').click();
  await page.locator(".tier-modal .tf-delete").click();
  await expect(page.locator(".tier-pool .tier-item img")).toHaveCount(2);
  await upload(files(["빨강.png", "파랑.png"]));
  await expect(page.locator("#toast")).toContainText("이미 있는 사진");
  await expect(page.locator(".tier-pool .tier-item img")).toHaveCount(2);
});

test("전체화면에서도 끌기 그림·창·알림이 전체화면 칸 안에 뜬다", async ({ page }) => {
  await openTier(page);
  // 진짜 전체화면은 사용자 클릭이 있어야 하므로 임시 단추를 눌러 들어간다.
  await page.evaluate(() => { const b = document.createElement("button"); b.id = "fsProbe"; b.textContent = "fs"; b.style.cssText = "position:fixed;left:0;top:0;z-index:99999"; b.onclick = () => enterViewerFullscreen(); document.body.appendChild(b); });
  await page.click("#fsProbe");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id)).toBe("content");
  await expect.poll(() => page.evaluate(() => document.getElementById("toast").parentElement.id)).toBe("content");

  // 끄는 동안 따라다니는 카드 그림
  const card = await page.locator('.tier-item[data-item-id="c0"]').boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(card.x + 80, card.y - 120, { steps:8 });
  await expect(page.locator("#content .tier-ghost")).toHaveCount(1);
  await page.mouse.up();

  await page.locator('.tier-item[data-item-id="c0"]').dblclick();
  await expect(page.locator("#content .tier-modal")).toBeVisible();
  await page.locator(".tier-modal .tf-cancel").click();

  // Esc 로 창을 닫으면 창만 닫히고 전체화면은 남는다. 아무것도 안 열려 있을 때의 Esc 는 전체화면을 나간다.
  await page.locator('.tier-item[data-item-id="c0"]').dblclick();
  await expect(page.locator(".tier-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tier-modal")).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id)).toBe("content");
  // 카드가 골라져 있으면 첫 Esc 는 고르기만 풀고, 다음 Esc 가 전체화면을 나간다.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.getElementById("toast").parentElement.tagName)).toBe("BODY");
});
