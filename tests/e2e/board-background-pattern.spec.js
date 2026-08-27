const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { solidPng, bandPng } = require("./helpers-png");

/* 배경 무늬(모눈·오선 등)는 "그려지는 것"이라 화면 픽셀로만 확인할 수 있다.
   특히 지우개는 예전에 배경색 덧칠이었다 — 무늬 위에서 덧칠하면 지운 자리에 단색 얼룩이 남고,
   진짜 지우기(destination-out)로 바꾸면 이번엔 배경을 나중에 깔지 않는 한 캔버스에 구멍이 뚫려
   내보낸 PNG 가 투명해진다. 둘 다 코드 모양이 아니라 픽셀로 봐야 잡힌다. */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// CSS px 좌표로 캔버스 픽셀 읽기(캔버스는 dpr 배율로 확대돼 있다).
const readRow = (page, y, fromX, toX, step) => page.evaluate(([y, fromX, toX, step]) => {
  const canvas = document.querySelector(".wb-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = canvas.width / parseFloat(canvas.style.width);
  const out = [];
  for (let x = fromX; x <= toX; x += step){
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    out.push([d[0], d[1], d[2], d[3]]);
  }
  return out;
}, [y, fromX, toX, step]);

const isWhite = (p) => p[0] === 255 && p[1] === 255 && p[2] === 255;
const isInk = (p) => p[0] < 90 && p[1] < 90 && p[2] < 90;   // 검정 펜(#111111)

test("배경 무늬를 깔면 판서는 그 위에 얹히고, 지우개는 판서만 지운다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  await page.evaluate(() => newWhiteboard());
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();

  // 무늬 없는 흰 보드: 아무 결도 없다.
  const plain = await readRow(page, 220, 200, 520, 4);
  expect(plain.every(isWhite)).toBe(true);

  // 도구막대 배경 버튼 → 모눈종이
  await page.locator(".wb-bg-toggle").click();
  await page.locator('.wb-bg-pattern[data-board-pattern="grid"]').click();
  await page.keyboard.press("Escape");                    // 판이 캔버스를 가리지 않게 닫는다
  await expect(page.locator(".wb-bg-panel")).toBeHidden();

  // 모눈이 실제로 깔렸다(흰색이 아닌 픽셀 = 격자선). 무늬는 배경색보다 옅으므로 펜은 아니다.
  const ruled = await readRow(page, 220, 200, 520, 4);
  const gridPixels = ruled.filter((p) => !isWhite(p));
  expect(gridPixels.length).toBeGreaterThan(0);
  expect(gridPixels.some(isInk)).toBe(false);
  expect(ruled.every((p) => p[3] === 255)).toBe(true);     // 내보낸 PNG 가 투명해지지 않는다

  // 펜으로 가로줄 하나
  await page.locator('.wb-tool[title="펜"]').click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 200, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 220, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await readRow(page, 220, 200, 520, 4)).filter(isInk).length).toBeGreaterThan(20);

  // 같은 자리를 지우개로 문지른다
  await page.locator('.wb-tool[title="지우개"]').click();
  await page.mouse.move(box.x + 200, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 220, { steps: 12 });
  await page.mouse.up();

  const erased = await readRow(page, 220, 200, 520, 4);
  expect(erased.filter(isInk).length).toBe(0);             // 판서는 지워지고
  expect(erased.filter((p) => !isWhite(p)).length).toBeGreaterThan(0);   // 모눈은 그대로 남는다
  expect(erased.every((p) => p[3] === 255)).toBe(true);    // 뚫린 자리는 배경으로 메워졌다
  // 지우고 나면 무늬만 있던 처음 상태로 정확히 돌아온다(단색 얼룩이 남지 않는다).
  expect(erased).toEqual(ruled);

  expect(errors).toEqual([]);
});

test("무늬는 탭을 닫았다 같은 이름으로 열어도 그대로 돌아온다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newWhiteboard());
  await page.locator(".wb-bg-toggle").click();
  await page.locator('.wb-bg-pattern[data-board-pattern="staff"]').click();
  await page.locator('.wb-bg-pattern-color[data-pattern-color="#2563eb"]').click();

  const saved = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    doc.flushBoardRecovery();                              // 복구 스냅샷을 지금 즉시 남긴다
    const key = boardRecoveryKey(doc.boardRecoveryName || doc.name);
    return JSON.parse(localStorage.getItem(key)).bgPattern;
  });
  expect(saved).toMatchObject({ id: "staff", color: "#2563eb" });

  const restored = await page.evaluate((snapshot) => {
    const state = boardStateFromSnapshot({ version:1, bg:"#ffffff", bgPattern:snapshot, items:[] });
    return state.bgPattern;
  }, saved);
  expect(restored).toMatchObject({ id: "staff", color: "#2563eb" });
});

// ── 배경 그림 ──────────────────────────────────────────────────────────
const isRed = (p) => p[0] > 190 && p[1] < 70 && p[2] < 70;

// 동적으로 만든 <input type=file> 을 click() 으로 여는 경로라 filechooser 이벤트로 받는다.
async function pickBackground(page, buttonText, file){
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator(".wb-bg-image-btn", { hasText: buttonText }).click()
  ]);
  await chooser.setFiles(file);
}

test("배경 그림을 깔면 판서는 그 위에 얹히고, 지우개는 그림을 되살린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newWhiteboard());
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();

  await page.locator(".wb-bg-toggle").click();
  await pickBackground(page, "고르기", { name:"bg.png", mimeType:"image/png", buffer: solidPng(600, 400, [255, 0, 0]) });
  await expect(page.locator(".wb-bg-fit[data-board-fit=\"cover\"]")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // 채움: 보드가 그림으로 덮인다.
  await expect.poll(async () => (await readRow(page, 220, 200, 520, 4)).filter(isRed).length).toBe(81);
  expect((await readRow(page, 220, 200, 520, 4)).every((p) => p[3] === 255)).toBe(true);

  // 그림 위에 펜으로 긋고 → 같은 자리를 지우면 흰 바탕이 아니라 그림이 돌아와야 한다.
  const box = await canvas.boundingBox();
  await page.locator('.wb-tool[title="펜"]').click();
  await page.mouse.move(box.x + 200, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 220, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await readRow(page, 220, 200, 520, 4)).filter(isInk).length).toBeGreaterThan(20);

  await page.locator('.wb-tool[title="지우개"]').click();
  await page.mouse.move(box.x + 200, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 220, { steps: 12 });
  await page.mouse.up();

  const erased = await readRow(page, 220, 200, 520, 4);
  expect(erased.filter(isInk).length).toBe(0);
  expect(erased.filter(isRed).length).toBe(81);            // 지운 자리는 흰색이 아니라 그림
  expect(erased.every((p) => p[3] === 255)).toBe(true);

  // 흐리기: 그림이 배경색(흰색) 쪽으로 연해진다 — 사진 위에 판서할 때 쓰는 조절.
  await page.locator(".wb-bg-toggle").click();
  await page.locator('input[aria-label="배경 그림 흐리기"]').fill("40");
  await page.locator('input[aria-label="배경 그림 흐리기"]').dispatchEvent("input");
  await page.keyboard.press("Escape");
  const faded = await readRow(page, 220, 200, 520, 4);
  expect(faded.every((p) => p[1] > 120 && p[2] > 120)).toBe(true);   // 붉은 기가 옅어졌다
  expect(faded.every((p) => p[0] > 200)).toBe(true);

  // 지우기 → 배경색만 남는다.
  await page.locator(".wb-bg-toggle").click();
  await page.locator(".wb-bg-image-btn", { hasText: "지우기" }).click();
  await page.keyboard.press("Escape");
  expect((await readRow(page, 220, 200, 520, 4)).every(isWhite)).toBe(true);

  expect(errors).toEqual([]);
});

test("배경 그림은 넣을 때 줄여 담아 자동복원 스냅샷을 지킨다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newWhiteboard());
  await page.locator(".wb-bg-toggle").click();
  // 긴 변 2400px 짜리 — 상한(1600)에 맞춰 줄어들어야 한다.
  await pickBackground(page, "고르기", { name:"wide.png", mimeType:"image/png", buffer: solidPng(2400, 300, [20, 90, 200]) });

  const readStored = () => page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    const image = doc && doc.boardState && doc.boardState.bgImage;
    if (!image || !image.img || !image.img.complete) return null;
    return { chars:image.src.length, width:image.img.naturalWidth, height:image.img.naturalHeight, fit:image.fit };
  });
  await expect.poll(readStored).not.toBe(null);
  const stored = await readStored();

  expect(stored.width).toBeLessThanOrEqual(1600);
  expect(stored.chars).toBeLessThanOrEqual(2 * 1000 * 1000);
  expect(stored.fit).toBe("cover");

  // 복구 스냅샷에도 그대로 실린다(<img> 객체는 빠지고 src 만).
  const snapshot = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    doc.flushBoardRecovery();
    const saved = JSON.parse(localStorage.getItem(boardRecoveryKey(doc.boardRecoveryName || doc.name)));
    return { hasImg:Object.prototype.hasOwnProperty.call(saved.bgImage, "img"), src:saved.bgImage.src.slice(0, 11), fit:saved.bgImage.fit };
  });
  expect(snapshot.hasImg).toBe(false);
  expect(snapshot.src).toBe("data:image/");
  expect(snapshot.fit).toBe("cover");
});

// 세로 한 줄을 읽어 색이 바뀌는 횟수를 센다 = 타일이 몇 번 반복됐는가.
const countBands = (page, x, fromY, toY) => page.evaluate(([x, fromY, toY]) => {
  const canvas = document.querySelector(".wb-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = canvas.width / parseFloat(canvas.style.width);
  let changes = 0, previous = null;
  for (let y = fromY; y <= toY; y += 2){
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    const red = d[0] > 150 && d[1] < 110;
    if (previous !== null && red !== previous) changes++;
    previous = red;
  }
  return changes;
}, [x, fromY, toY]);

test("타일 배경은 보드 전체에 반복되고, 칸 크기를 줄이면 더 촘촘해진다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newWhiteboard());

  await page.locator(".wb-bg-toggle").click();
  // 위 절반 빨강 / 아래 절반 파랑 → 타일로 깔면 가로 띠가 반복된다(띠 수를 세어 반복을 확인한다).
  await pickBackground(page, "고르기", { name:"tile.png", mimeType:"image/png", buffer: bandPng(200, 200, [255, 0, 0], [0, 0, 255]) });
  await page.locator('.wb-bg-fit[data-board-fit="tile"]').click();
  await expect(page.locator('input[aria-label="타일 한 칸 크기"]')).toBeVisible();
  // 타일은 보드 전체에 깔리므로 "화면에 맞추기"는 할 일이 없다.
  await expect(page.locator(".wb-bg-refit")).toBeHidden();
  await page.keyboard.press("Escape");

  // 기본 칸 크기(50% = 100px)에서 400px 구간이면 띠 경계가 여러 번 나온다.
  await expect.poll(() => countBands(page, 700, 60, 460)).toBeGreaterThanOrEqual(3);
  const wide = await countBands(page, 700, 60, 460);

  // 칸을 절반으로 줄이면 같은 구간에 띠가 더 많아진다.
  await page.locator(".wb-bg-toggle").click();
  await page.locator('input[aria-label="타일 한 칸 크기"]').fill("25");
  await page.locator('input[aria-label="타일 한 칸 크기"]').dispatchEvent("input");
  await page.keyboard.press("Escape");
  await expect.poll(() => countBands(page, 700, 60, 460)).toBeGreaterThan(wide);

  const stored = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    return doc.boardState.bgImage.tile;
  });
  expect(stored).toBe(25);
  expect(errors).toEqual([]);
});

test("보드에 올린 그림을 우클릭으로 배경에 내리면 항목에서 빠진다", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => newWhiteboard());
  const canvas = page.locator(".wb-canvas");

  // 그림 한 장을 보드에 넣는다(도구막대 이미지 버튼 → 파일 고르기).
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.wb-act[title="이미지 넣기"], .wb-act[title*="이미지"]').first().click()
  ]);
  await chooser.setFiles({ name:"photo.png", mimeType:"image/png", buffer: solidPng(300, 200, [255, 0, 0]) });
  await expect.poll(() => page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    return doc.boardState.items.length;
  })).toBe(1);

  // 넣자마자 선택 상태다 → 우클릭 메뉴의 "배경으로"
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await expect(page.locator(".wb-focus-context-menu")).toBeVisible();
  await page.locator(".wb-focus-context-menu .wb-context-actions button", { hasText: "배경으로" }).click();

  const after = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    const image = doc.boardState.bgImage;
    return { items:doc.boardState.items.length, fit:image && image.fit, src:image && image.src.slice(0, 11) };
  });
  expect(after.items).toBe(0);            // 항목에서 빠지고
  expect(after.fit).toBe("cover");         // 일반 항목 위치를 버리고 화면 자체를 채운다
  expect(after.src).toBe("data:image/");

  // 되돌리기는 그림을 항목으로 되살린다(배경은 보드 속성이라 되돌리기 대상이 아니다).
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "board");
    return doc.boardState.items.length;
  })).toBe(1);
});
