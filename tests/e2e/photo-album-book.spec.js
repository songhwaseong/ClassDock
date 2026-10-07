const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 사진첩 앨범 책(시안 C · 1단계). 여기서만 확인할 수 있는 것 — 실제 브라우저 저장소(IndexedDB)에
   쪽이 남는지, 꾸민 사진이 쪽에 장식째(합성 그림) 보이는지, 두 쪽 펼침·넘기기, 칸 끌기, 글 넣기,
   두 번 눌러 사진 꾸미기로 가기, 사진을 지우면 쪽에서도 빠지는지, 책 감상. */

async function boot(page){
  await page.setViewportSize({ width:1400, height:900 });
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {} });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.openPhotoAlbum());
  await expect(page.locator(".photo-album")).toBeVisible();
}

// 크기·색이 다른 PNG 를 만들어 가져오기 칸에 넣는다(가로·세로가 섞이게).
async function importImages(page, count){
  await page.evaluate(async (n) => {
    const files = [];
    for (let i = 0; i < n; i++){
      const canvas = document.createElement("canvas"); canvas.width = i % 2 ? 300 : 400; canvas.height = i % 2 ? 400 : 300;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = `hsl(${i * 60}, 70%, 60%)`; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      files.push(new File([blob], "사진" + (i + 1) + ".png", { type:"image/png" }));
    }
    const input = document.querySelector(".pa-input"), transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles:true }));
  }, count);
}

const pageSlots = (page, index) => page.locator(`.pa-page[data-index="${index}"] .pa-slot`);

test("처음엔 앨범 책 화면이고, 가져온 사진은 쪽마다 4장까지 채워지며 두 쪽씩 펼쳐진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await expect(page.locator(".pa-mode-tab[data-mode=book]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".pa-book")).toBeVisible();
  await expect(page.locator(".pa-layout")).toBeHidden();
  await expect(page.locator(".pa-book-where")).toHaveText("빈 앨범");

  await importImages(page, 5);
  await expect(page.locator(".pa-book-tray-item")).toHaveCount(5);
  // 4장 + 1장 — 두 쪽이 나란히
  await expect(pageSlots(page, 0)).toHaveCount(4);
  await expect(pageSlots(page, 1)).toHaveCount(1);
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 2");
  const [left, right] = await Promise.all([0, 1].map((i) => page.locator(`.pa-page[data-index="${i}"]`).boundingBox()));
  expect(right.x).toBeGreaterThan(left.x + left.width - 2);
  expect(Math.abs(left.height / left.width - 4 / 3)).toBeLessThan(0.02);       // 쪽은 세로 3:4
  // 쪽에 쓰인 사진은 오른쪽 사진 칸에 몇 쪽인지 표시된다
  await expect(page.locator(".pa-book-tray-used")).toHaveCount(5);
  // 꾸민 사진 그림(합성)으로 바뀐다 — blob: 주소
  await expect.poll(() => pageSlots(page, 0).first().locator("img").getAttribute("src")).toMatch(/^blob:/);
  expect(errors).toEqual([]);
});

test("칸을 끌어 옮기고 글을 넣으면 저장되어 다시 열어도 그대로다", async ({ page }) => {
  await boot(page);
  await importImages(page, 2);
  await expect(pageSlots(page, 0)).toHaveCount(2);

  const slot = pageSlots(page, 0).first(), box = await slot.boundingBox();
  const before = await slot.evaluate((el) => el.style.left);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps:6 });
  await page.mouse.up();
  const after = await pageSlots(page, 0).first().evaluate((el) => el.style.left);
  expect(after).not.toBe(before);
  await expect(pageSlots(page, 0).first()).toHaveClass(/is-picked/);

  await page.locator(".pa-book-text").click();
  const body = page.locator(".pa-btext-body").first();
  await expect(body).toBeFocused();
  await page.keyboard.type("제주 첫날");
  await page.locator(".pa-book-where").click();       // 바깥 → 글 확정
  await expect(page.locator(".pa-btext-body")).toHaveText("제주 첫날");
  await expect(page.locator(".pa-status")).toHaveText("앨범을 저장했습니다.", { timeout:5000 });

  // 다시 연다 — IndexedDB 에 남은 쪽을 읽는다
  await page.reload();
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.openPhotoAlbum());
  await expect(pageSlots(page, 0)).toHaveCount(2);
  expect(await pageSlots(page, 0).first().evaluate((el) => el.style.left)).toBe(after);
  await expect(page.locator(".pa-btext-body")).toHaveText("제주 첫날");
});

test("쪽 위 사진을 두 번 누르면 그 사진의 꾸미기 화면으로 가고, 사진을 지우면 쪽에서도 빠진다", async ({ page }) => {
  await boot(page);
  await importImages(page, 3);
  await expect(pageSlots(page, 0)).toHaveCount(3);
  const name = await pageSlots(page, 0).nth(1).locator("img").getAttribute("alt");
  await pageSlots(page, 0).nth(1).dblclick();
  await expect(page.locator(".pa-mode-tab[data-mode=edit]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".pa-layout")).toBeVisible();
  await expect(page.locator(".pa-media-card.active .pa-media-name")).toHaveText(name);

  // 꾸미기 화면에서 지우면 앨범 쪽에서도 빠진다
  await page.locator(".pa-caption-actions .pa-delete").click();
  await page.locator("#confirmOk").click();          // 앱 공용 확인 창
  await expect(page.locator(".pa-media-card")).toHaveCount(2);
  await page.locator(".pa-mode-tab[data-mode=book]").click();
  await expect(pageSlots(page, 0)).toHaveCount(2);
  await expect(page.locator(`.pa-slot img[alt="${name}"]`)).toHaveCount(0);
});

test("쪽 더하기·넘기기와 책 감상(←/→·Esc)", async ({ page }) => {
  await boot(page);
  await importImages(page, 9);          // 4 + 4 + 1 → 3쪽
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 3");
  await page.locator(".pa-turn-corner.is-next").click();
  await expect(page.locator(".pa-book-where")).toHaveText("3쪽 / 3");
  await expect(page.locator(".pa-page.is-blank")).toHaveCount(1);       // 오른쪽은 빈 자리(＋ 쪽 더하기)
  await page.locator(".pa-book-blank-add").click();
  await expect(page.locator(".pa-book-where")).toHaveText("3–4쪽 / 4");
  await expect(page.locator(".pa-book-thumb")).toHaveCount(2);

  // 책 감상: 도구가 감춰지고 ←/→ 로 넘기고 Esc 로 끝
  await page.locator(".pa-view").click();
  await expect(page.locator(".photo-album")).toHaveClass(/pa-book-reading/);
  await expect(page.locator(".pa-book-tray")).toBeHidden();
  await expect(page.locator(".pa-header")).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 4");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pa-book-where")).toHaveText("3–4쪽 / 4");
  await page.keyboard.press("Escape");
  await expect(page.locator(".photo-album")).not.toHaveClass(/pa-book-reading/);
  await expect(page.locator(".pa-book-tray")).toBeVisible();

  // 되돌리기: 방금 더한 쪽을 되돌린다
  await page.keyboard.press("Control+z");
  await expect(page.locator(".pa-book-where")).toHaveText("3쪽 / 3");
});

test("겹쳐 가려진 사진도 위 줄 '이 쪽 사진' 목록이나 Alt+누르기로 골라 끌 수 있고, 도구·손잡이는 잘리지 않는다", async ({ page }) => {
  await boot(page);
  await importImages(page, 4);
  await expect(pageSlots(page, 0)).toHaveCount(4);
  const slots = pageSlots(page, 0);

  // 1번 사진(맨 뒤)을 2번 사진 위치로 덮어 겹치게: 2번을 1번 자리로 옮긴다
  const [a, b] = await Promise.all([slots.nth(0).boundingBox(), slots.nth(1).boundingBox()]);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps:8 });
  await page.mouse.up();
  const firstId = await slots.nth(0).getAttribute("data-id");
  // 그 자리를 누르면 위에 있는 2번이 잡힌다 — 1번은 가려져 있다
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest(".pa-slot").dataset.id, { x:a.x + a.width / 2, y:a.y + a.height / 2 });
  expect(top).not.toBe(firstId);

  // 위 줄 목록에 이 쪽 사진 4장이 뒤→앞 차례로 있다. 첫 칩(맨 뒤 = 1번)을 누르면 1번이 골라지고 맨 위로 뜬다
  const chips = page.locator(".pa-book-pick .pa-book-layer");
  await expect(chips).toHaveCount(4);
  await chips.first().hover();
  await expect(page.locator(`.pa-slot[data-id="${firstId}"]`)).toHaveClass(/is-hint/);
  await chips.first().click();
  const first = page.locator(`.pa-slot[data-id="${firstId}"]`);
  await expect(first).toHaveClass(/is-picked/);
  const lifted = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest(".pa-slot").dataset.id, { x:a.x + a.width / 2, y:a.y + a.height / 2 });
  expect(lifted).toBe(firstId);
  // 고른 사진 도구는 위 줄에 뜬다
  await expect(page.locator(".pa-book-pick-tools button")).toHaveCount(5);

  // 손잡이는 쪽 안(잘리지 않는 자리)에 있다
  const pageBox = await page.locator('.pa-page[data-index="0"]').boundingBox();
  for (const handle of await first.locator(".pa-slot-handle").all()){
    const h = await handle.boundingBox();
    expect(h.x).toBeGreaterThanOrEqual(pageBox.x); expect(h.y).toBeGreaterThanOrEqual(pageBox.y);
    expect(h.x + h.width).toBeLessThanOrEqual(pageBox.x + pageBox.width); expect(h.y + h.height).toBeLessThanOrEqual(pageBox.y + pageBox.height);
  }

  // 이제 1번을 끌 수 있다
  const before = await first.evaluate((el) => el.style.left);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 50, a.y + a.height / 2 + 20, { steps:6 });
  await page.mouse.up();
  expect(await first.evaluate((el) => el.style.left)).not.toBe(before);

  // Alt+누르기: 겹친 자리에서 아래 사진으로 차례로 넘어간다
  await page.locator(".pa-book-pick-tools button[aria-label='맨 뒤로']").click();   // 1번을 다시 맨 뒤로 보내 겹치게
  // 1번은 옆으로 조금만 옮겼으니 처음 자리 가운데에서는 1번(뒤)과 2번(앞)이 겹친다
  const at = { x:a.x + a.width / 2, y:a.y + a.height / 2 };
  const stackAt = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map((n) => n.closest(".pa-slot")).filter(Boolean).map((n) => n.dataset.id)
    .filter((id, i, list) => list.indexOf(id) === i), at);
  expect(stackAt.length).toBeGreaterThan(1);
  expect(stackAt).toContain(firstId);                                         // 가려진 1번도 그 자리에 있다
  await page.mouse.click(at.x, at.y);                                         // 그냥 누르면 맨 위
  await expect(page.locator(".pa-slot.is-picked")).toHaveAttribute("data-id", stackAt[0]);
  for (let step = 1; step < stackAt.length; step++){                          // Alt+누르기마다 한 칸 아래
    await page.keyboard.down("Alt"); await page.mouse.click(at.x, at.y); await page.keyboard.up("Alt");
    await expect(page.locator(".pa-slot.is-picked")).toHaveAttribute("data-id", stackAt[step]);
  }
});

test("사진 칸(트레이)에서 끌면 손잡이·끄는 그림·놓일 자리 점선이 보이고, 보인 자리에 놓인다", async ({ page }) => {
  await boot(page);
  await importImages(page, 3);
  await expect(pageSlots(page, 0)).toHaveCount(3);
  await page.locator(".pa-book-page-add").click();                      // 빈 2쪽
  await expect(page.locator('.pa-page[data-index="1"]:not(.is-blank)')).toBeVisible();

  const item = page.locator(".pa-book-tray-item").first();
  await item.hover();
  await expect.poll(() => item.locator(".pa-book-tray-grip").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  expect(await item.locator("img").getAttribute("draggable")).toBe("false");   // 그림이 '파일'로 끌려가지 않게

  const target = page.locator('.pa-page[data-index="1"]'), box = await target.boundingBox();
  const from = await item.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .4, { steps:10 });
  await expect(page.locator(".photo-album")).toHaveClass(/pa-tray-dragging/);
  await expect(item).toHaveClass(/is-dragging/);
  const ghost = target.locator(".pa-drop-ghost");
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveText("여기에 놓기");
  const ghostAt = await ghost.evaluate((el) => [el.style.left, el.style.top, el.style.width]);
  await page.mouse.up();

  await expect(target.locator(".pa-slot")).toHaveCount(1);
  expect(await target.locator(".pa-slot").evaluate((el) => [el.style.left, el.style.top, el.style.width])).toEqual(ghostAt);   // 보인 자리 그대로
  await expect(page.locator(".pa-drop-ghost")).toHaveCount(0);
  await expect(page.locator(".photo-album")).not.toHaveClass(/pa-tray-dragging/);
  await expect(item).not.toHaveClass(/is-dragging/);
  await expect(page.locator(".pa-book-tray-item")).toHaveCount(3);       // 새 파일로 가져오지 않았다
});

test("다음 쪽으로 가면 쪽 한 장이 책등을 축으로 넘어가고(앞면=지금 쪽, 뒷면=다음 쪽), 다 넘어가면 걷힌다", async ({ page }) => {
  await boot(page);
  await importImages(page, 13);                      // 4·4·4·1 → 4쪽
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 4");

  await page.locator(".pa-view").click();            // 책 감상(느린 넘김 0.85초)
  await page.keyboard.press("ArrowRight");
  const leaf = page.locator(".pa-turn-leaf.is-next");
  await expect(leaf).toHaveCount(1);
  await expect(page.locator(".pa-turn-cover.is-left")).toHaveCount(1);          // 왼쪽엔 옛 1쪽이 남아 있다
  await expect(leaf.locator(".pa-turn-face").first().locator(".pa-page-no")).toHaveText("2");        // 앞면 = 지금 오른쪽 2쪽
  await expect(leaf.locator(".pa-turn-face.is-back .pa-page-no")).toHaveText("3");                  // 뒷면 = 새 왼쪽 3쪽
  // 도는 중이다: 0°와 -180° 사이
  await expect.poll(() => leaf.evaluate((el) => Number((el.style.transform.match(/-?[\d.]+/) || [0])[0])), { timeout:2000 })
    .toBeLessThan(-20);
  await expect(page.locator(".pa-book-where")).toHaveText("3–4쪽 / 4");
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });   // 다 넘어가면 걷힌다
  await expect(page.locator(".pa-turn-under")).toHaveCount(0);

  // 넘기는 도중 또 누르면 지금 넘김을 끝내고 바로 다음으로 — 남는 장이 없다
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 4");
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".pa-turn-leaf")).toHaveCount(0);
});

test("책 감상에서 모서리를 끌면 끄는 만큼 넘어가고, 반을 넘기면 넘어가고 덜 끌면 되돌아온다", async ({ page }) => {
  await boot(page);
  await importImages(page, 9);
  await page.locator(".pa-view").click();
  const corner = page.locator(".pa-turn-corner.is-next");
  await expect(corner).toHaveCount(1);
  await expect(page.locator(".pa-turn-corner.is-prev")).toHaveCount(0);       // 첫 펼침엔 앞 쪽 모서리가 없다
  const spread = await page.locator(".pa-spread").boundingBox(), c = await corner.boundingBox();

  // 조금만 끌고 놓으면 되돌아온다
  await page.mouse.move(c.x + c.width - 8, c.y + c.height - 8);
  await page.mouse.down();
  await page.mouse.move(spread.x + spread.width * .8, c.y + c.height - 20, { steps:6 });
  const mid = await page.locator(".pa-turn-leaf").evaluate((el) => Number((el.style.transform.match(/-?[\d.]+/) || [0])[0]));
  expect(mid).toBeLessThan(-10); expect(mid).toBeGreaterThan(-90);           // 끈 만큼만 돌아 있다
  await page.mouse.up();
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 3");

  // 반 넘게 끌고 놓으면 넘어간다
  const c2 = await page.locator(".pa-turn-corner.is-next").boundingBox();
  await page.mouse.move(c2.x + c2.width - 8, c2.y + c2.height - 8);
  await page.mouse.down();
  await page.mouse.move(spread.x + spread.width * .25, c2.y + c2.height - 20, { steps:8 });
  await page.mouse.up();
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".pa-book-where")).toHaveText("3쪽 / 3");
  await expect(page.locator(".pa-turn-corner.is-prev")).toHaveCount(1);
});

test("동작 줄이기를 켠 컴퓨터에서는 넘김 움직임 없이 바로 바뀌고, 넘김 소리 켜기는 기억된다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion:"reduce" });
  await boot(page);
  await importImages(page, 9);
  await page.locator(".pa-turn-corner.is-next").click();
  await expect(page.locator(".pa-book-where")).toHaveText("3쪽 / 3");
  expect(await page.locator(".pa-turn-layer").count()).toBe(0);

  const sound = page.locator(".pa-book-sound");
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("classdock.photoAlbum.turnSound"))).toBe("1");
});

test("좁은 화면(한 쪽씩)에서도 쪽이 왼쪽 가장자리를 축으로 넘어가고 앞으로도 돌아온다", async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width:820, height:900 });
  await importImages(page, 9);
  await expect(page.locator(".pa-spread")).toHaveAttribute("data-pages", "1");
  await page.locator(".pa-view").click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pa-turn-leaf.is-single")).toHaveCount(1);
  await expect(page.locator(".pa-book-where")).toHaveText("2쪽 / 3");
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".pa-turn-cover.is-full")).toHaveCount(1);          // 앞으로: 새 쪽이 접힌 채 돌아와 옛 쪽을 덮는다
  await expect(page.locator(".pa-book-where")).toHaveText("1쪽 / 3");
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
});

test("편집 화면에서도 귀퉁이를 끌어 넘기고, 귀퉁이 자리에서는 사진보다 귀퉁이가 먼저 잡힌다", async ({ page }) => {
  await boot(page);
  await importImages(page, 13);                               // 4쪽
  await expect(page.locator(".photo-album")).not.toHaveClass(/pa-book-reading/);
  const corner = page.locator(".pa-turn-corner.is-next");
  await expect(corner).toHaveCount(1);
  const c = await corner.boundingBox(), spread = await page.locator(".pa-spread").boundingBox();
  // 귀퉁이 한가운데에서 가장 위에 있는 것은 귀퉁이다(사진 칸이 그 아래 있어도)
  const topAtCorner = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).className, { x:c.x + c.width - 6, y:c.y + c.height - 6 });
  expect(topAtCorner).toContain("pa-turn-corner");

  await page.mouse.move(c.x + c.width - 6, c.y + c.height - 6);
  await page.mouse.down();
  await page.mouse.move(spread.x + spread.width * .2, c.y + c.height - 20, { steps:8 });
  await expect(page.locator(".pa-turn-leaf.is-next")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".pa-book-where")).toHaveText("3–4쪽 / 4");
  // 앞 쪽 귀퉁이로 되돌아가기
  const back = await page.locator(".pa-turn-corner.is-prev").boundingBox();
  await page.mouse.move(back.x + 6, back.y + back.height - 6);
  await page.mouse.down();
  await page.mouse.move(spread.x + spread.width * .8, back.y + back.height - 20, { steps:8 });
  await page.mouse.up();
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 4");
});

const pngSize = (buffer) => ({ width:buffer.readUInt32BE(16), height:buffer.readUInt32BE(20) });
async function openSaveMenu(page){
  await page.locator(".pa-book-save").click();
  await expect(page.locator(".text-context-menu")).toBeVisible();
}

test("저장·인쇄 ▾ 에서 이 쪽·펼친 두 쪽을 PNG 로 저장한다 — 쪽 바탕과 꾸민 사진이 그대로 들어간다", async ({ page }) => {
  await boot(page);
  await importImages(page, 5);                                  // 4 + 1
  await page.locator('.pa-page[data-index="0"]').click({ position:{ x:6, y:6 } });   // 1쪽 고르기
  await page.locator(".pa-book-paper[aria-label='하늘 쪽 바탕']").click();          // 1쪽 바탕 = 하늘(#eaf5ff)

  await openSaveMenu(page);
  const [one] = await Promise.all([page.waitForEvent("download"), page.locator(".text-context-menu button", { hasText:"이 쪽 그림 저장" }).click()]);
  expect(one.suggestedFilename()).toBe("앨범-1쪽.png");
  const bytes = require("node:fs").readFileSync(await one.path());
  expect(pngSize(bytes)).toEqual({ width:1800, height:2400 });
  // 왼쪽 위 귀퉁이는 쪽 바탕색, 첫 사진 칸 가운데는 바탕색이 아니다
  const probe = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const px = (u, v) => Array.from(x.getImageData(u, v, 1, 1).data.slice(0, 3));
    return { corner:px(4, 4), photo:px(Math.round(img.width * .27), Math.round(img.height * .2)) };
  }, bytes.toString("base64"));
  expect(probe.corner).toEqual([0xea, 0xf5, 0xff]);
  expect(probe.photo).not.toEqual([0xea, 0xf5, 0xff]);

  await openSaveMenu(page);
  const [two] = await Promise.all([page.waitForEvent("download"), page.locator(".text-context-menu button", { hasText:"펼친 두 쪽" }).click()]);
  expect(two.suggestedFilename()).toBe("앨범-1-2쪽.png");
  expect(pngSize(require("node:fs").readFileSync(await two.path()))).toEqual({ width:3600, height:2400 });
});

test("모든 쪽 인쇄는 쪽마다 A4 한 면짜리 인쇄 층을 만들어 찍고, 인쇄가 끝나면 걷는다", async ({ page }) => {
  await boot(page);
  await importImages(page, 9);                                  // 3쪽
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await openSaveMenu(page);
  await page.locator(".text-context-menu button", { hasText:"모든 쪽 인쇄 (3쪽)" }).click();
  await expect.poll(() => page.evaluate(() => window.__printed), { timeout:15000 }).toBe(1);
  await expect(page.locator("#paPrintLayer .pa-print-sheet img")).toHaveCount(3);
  await expect(page.locator("body")).toHaveClass(/pa-printing/);

  // 인쇄 화면에서는 인쇄 층만 보인다
  await page.emulateMedia({ media:"print" });
  await expect(page.locator("#paPrintLayer")).toBeVisible();
  await expect(page.locator(".photo-album")).toBeHidden();
  await page.emulateMedia({ media:"screen" });

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#paPrintLayer")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveClass(/pa-printing/);

  // 지금 펼친 쪽만: 1–2쪽
  await openSaveMenu(page);
  await page.locator(".text-context-menu button", { hasText:"지금 펼친 쪽만 인쇄" }).click();
  await expect.poll(() => page.evaluate(() => window.__printed), { timeout:15000 }).toBe(2);
  await expect(page.locator("#paPrintLayer .pa-print-sheet")).toHaveCount(2);
});

test("쪽 위 장식: 오른쪽 '장식' 탭에서 눌러 붙이고, 끌어 옮기고·키우고·뒤집고·떼며, 다시 열어도 남는다", async ({ page }) => {
  await boot(page);
  await importImages(page, 2);
  await page.locator(".pa-book-tray-tab[data-tray=deco]").click();
  await expect(page.locator(".pa-book-tray-tab[data-tray=deco]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".pa-book-tray-list")).toBeHidden();
  await expect(page.locator(".pa-book-deco-group")).toHaveCount(6);
  await page.locator(".pa-book-deco-group", { hasText:"모자" }).click();
  const firstHat = page.locator(".pa-book-deco-item").first();
  const hatName = await firstHat.getAttribute("aria-label");
  await firstHat.click();

  const sticker = page.locator('.pa-page[data-index="0"] .pa-bsticker');
  await expect(sticker).toHaveCount(1);
  await expect(sticker).toHaveClass(/is-picked/);
  await expect(sticker.locator("img")).toHaveAttribute("alt", hatName);
  await expect(page.locator(".pa-book-pick-label")).toHaveText("고른 장식");

  // 끌어 옮기기
  const box = await sticker.boundingBox(), left0 = await sticker.evaluate((el) => el.style.left);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 40, { steps:6 }); await page.mouse.up();
  expect(await sticker.evaluate((el) => el.style.left)).not.toBe(left0);
  // 크기 손잡이로 키우기
  const w0 = await sticker.evaluate((el) => parseFloat(el.style.width));
  const handle = await sticker.locator(".pa-slot-handle.is-resize").boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + 60, handle.y + 50, { steps:6 }); await page.mouse.up();
  expect(await sticker.evaluate((el) => parseFloat(el.style.width))).toBeGreaterThan(w0);
  // 뒤집기
  await page.locator(".pa-book-pick-tools button[aria-label='좌우 뒤집기']").click();
  await expect(sticker.locator("img")).toHaveCSS("transform", /matrix\(-1/);
  await expect(page.locator(".pa-status")).toHaveText("앨범을 저장했습니다.", { timeout:5000 });

  // 다시 열어도 남는다
  await page.reload();
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.openPhotoAlbum());
  await expect(page.locator('.pa-page[data-index="0"] .pa-bsticker')).toHaveCount(1);
  await expect(page.locator(".pa-book-tray-tab[data-tray=deco]")).toHaveAttribute("aria-selected", "true");   // 탭도 기억

  // 떼기(Delete)
  await page.locator('.pa-page[data-index="0"] .pa-bsticker').click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".pa-bsticker")).toHaveCount(0);
});

test("장식을 쪽으로 끌면 놓일 자리가 보이고 그 자리에 붙으며, 이모지도 붙고, 쪽 그림(PNG)에도 들어간다", async ({ page }) => {
  await boot(page);
  await importImages(page, 1);
  await page.locator(".pa-book-page-add").click();                       // 빈 2쪽
  await page.locator(".pa-book-tray-tab[data-tray=deco]").click();
  const item = page.locator(".pa-book-deco-item").first(), from = await item.boundingBox();
  const target = page.locator('.pa-page[data-index="1"]'), box = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5, { steps:10 });
  await expect(target.locator(".pa-drop-ghost")).toBeVisible();
  await page.mouse.up();
  const placed = target.locator(".pa-bsticker");
  await expect(placed).toHaveCount(1);
  const [x, y] = await placed.evaluate((el) => [parseFloat(el.style.left), parseFloat(el.style.top)]);
  expect(Math.abs(x - 50)).toBeLessThan(2); expect(Math.abs(y - 50)).toBeLessThan(2);   // 가운데에 놓았다

  await page.locator(".pa-book-deco-group", { hasText:"이모지" }).click();
  await page.locator(".pa-book-deco-item").first().click();
  await expect(target.locator(".pa-bsticker")).toHaveCount(2);

  // 2쪽(장식만 있는 쪽)을 그림으로 — 가운데(장식 자리)는 쪽 바탕색이 아니다
  await page.locator(".pa-book-save").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".text-context-menu button", { hasText:"이 쪽 그림 저장" }).click()]);
  expect(download.suggestedFilename()).toBe("앨범-2쪽.png");
  const bytes = require("node:fs").readFileSync(await download.path());
  const probe = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    let painted = 0;
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++){ const d = x.getImageData(img.width * (.42 + i * .004), img.height * (.44 + j * .003), 1, 1).data; if (Math.abs(d[0] - 0xfb) + Math.abs(d[1] - 0xf6) + Math.abs(d[2] - 0xea) > 30) painted++; }
    return painted;
  }, bytes.toString("base64"));
  expect(probe).toBeGreaterThan(20);                                     // 장식이 그려졌다
});

test("쪽 넘김 단추는 접힌 귀퉁이 — 누르면 넘어가고, 키보드(Enter)로도 넘기며, 둥근 ‹ › 단추는 없다", async ({ page }) => {
  await boot(page);
  await importImages(page, 13);                                  // 4쪽
  await expect(page.locator(".pa-book-prev, .pa-book-next")).toHaveCount(0);
  const next = page.locator(".pa-turn-corner.is-next");
  await expect(next).toHaveAttribute("aria-label", "다음 쪽");
  await expect(page.locator(".pa-turn-corner.is-prev")).toHaveCount(0);   // 첫 펼침엔 앞 쪽 귀퉁이가 없다

  // 누르기 = 끝까지 넘김(넘어가는 장이 나타났다가 걷힌다)
  await next.click();
  await expect(page.locator(".pa-book-where")).toHaveText("3–4쪽 / 4");
  await expect(page.locator(".pa-turn-layer")).toHaveCount(0, { timeout:3000 });
  await expect(page.locator(".pa-turn-corner.is-next")).toHaveCount(0);   // 마지막 펼침엔 다음 귀퉁이가 없다

  // 키보드: 앞 쪽 귀퉁이에 초점을 두고 Enter
  const prev = page.locator(".pa-turn-corner.is-prev");
  await prev.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pa-book-where")).toHaveText("1–2쪽 / 4");
  // 접힌 뒷면은 그 쪽 바탕색을 따른다
  expect(await page.locator(".pa-turn-corner.is-next").evaluate((el) => el.style.getPropertyValue("--corner-paper"))).toBe("#fbf6ea");
});

test("사이드바 '사진첩 열기'는 하나뿐인 사진첩을 열고, 이미 보고 있을 때 누르면 그렇다고 알려 준다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {} });
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await expect(page.locator("#sbNewPhotoAlbum span")).toHaveText("사진첩 열기");
  const press = () => page.evaluate(() => document.getElementById("sbNewPhotoAlbum").click());
  await press();
  await expect(page.locator(".photo-album")).toBeVisible();
  await expect(page.locator("#toast")).not.toContainText("사진첩은 하나라");      // 처음 열 땐 알림 없음

  await press();                                                               // 이미 보고 있다
  await expect(page.locator("#toast")).toContainText("사진첩은 하나라 지금 보고 있는 사진첩이에요.");
  expect(await page.evaluate(() => docs.filter(d => d.kind === "photo-album" && !d.closed).length)).toBe(1);

  // 다른 탭을 보다가 누르면 사진첩 탭으로 옮겨 간다(알림 없이)
  await page.evaluate(() => window.newTextScratch && window.newTextScratch());
  await expect(page.locator(".photo-album")).toBeHidden();
  await page.evaluate(() => { const area = document.getElementById("toast"); if (area) area.replaceChildren(); });
  await press();
  await expect(page.locator(".photo-album")).toBeVisible();
  await expect(page.locator("#toast")).not.toContainText("사진첩은 하나라");
});
