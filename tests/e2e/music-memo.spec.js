const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 악보 → 메모창 → 다시 악보 왕복.
// 여기서만 확인할 수 있는 것: VexFlow 가 Bravura "글꼴 글자"로 그린 오선을 문서 밖으로 떼어
// PNG 로 구울 때 글꼴이 함께 실려 나가는지. 글꼴을 못 심으면 그림이 사실상 비어 나온다.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// docs 는 let 선언이라 window 에 안 붙는다 — 전역 스코프에서 직접 찾는다.
const musicDocs = (page) => page.evaluate(() => {
  const all = (typeof docs !== "undefined") ? docs : [];
  return all.filter(d => d.kind === "music").map(d => ({
    id: d.id,
    name: d.name,
    measures: d.sheet ? d.sheet.measures.length : -1,
    memoBlockId: d.memoBlockId || null
  }));
});

// 메모에 들어간 그림의 검은 점 수. 오선·음표가 실제로 찍혔는지 보는 잣대다.
const memoImageInk = (page) => page.evaluate(async () => {
  const img = document.querySelector("#scratchpad .scratchpad-image-picture img");
  if (!img) return { width:0, height:0, ink:0 };
  if (!img.complete || !img.naturalWidth) await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let at = 0; at < data.length; at += 4){
    if (data[at] < 120 && data[at + 1] < 120 && data[at + 2] < 120) ink++;
  }
  return { width:canvas.width, height:canvas.height, ink };
});

async function openScore(page, build){
  await page.evaluate((source) => {
    const sheet = (0, eval)(source);
    return handleFiles([new File([musicSerialize(sheet)], sheet.title + ".msheet", { type:"application/json" })],
      { isScratch:true });
  }, build);
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
}

test("악보를 메모로 보내고, 메모에서 다시 열어 고치면 같은 블록이 바뀐다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 음표가 든 악보로 시작한다(빈 악보는 오선·음자리표만 있어 그림 확인이 무뎌진다).
  await openScore(page, `musicExampleSheet("school-bell")`);

  // 글꼴은 vendor 원문에서 뽑아 그림 안에 심는다 — 그 추출이 먹는지 먼저 확인한다.
  const fontCss = await page.evaluate(() => musicEmbeddedFontCss());
  expect(fontCss).toContain('font-family:"Bravura"');
  expect(fontCss).toContain("data:font/woff2");

  // ① 메모로 보내기 → 이미지 블록 한 개, 그리고 "✏️ 악보로"가 붙는다
  await page.locator(".music-btn", { hasText:"메모로" }).last().click();
  const imageBlocks = page.locator("#scratchpad [data-block-id] .scratchpad-image-tools");
  await expect(imageBlocks).toHaveCount(1);
  const sheetBtn = page.locator(".scratchpad-reuse", { hasText:"악보로" });
  await expect(sheetBtn).toHaveCount(1);

  // ② 그림에 실제로 오선과 음표가 찍혔는가(글꼴이 빠지면 여기서 무너진다)
  const full = await memoImageInk(page);
  expect(full.width).toBeGreaterThan(200);
  expect(full.ink).toBeGreaterThan(2000);

  // ③ 이 블록을 보낸 탭이 아직 열려 있으면 새 탭을 만들지 않는다 —
  //    탭이 둘로 갈라지면 서로 같은 블록을 덮어써 앞선 편집이 사라진다.
  await sheetBtn.click();
  await expect.poll(async () => (await musicDocs(page)).length).toBe(1);
  const source = (await musicDocs(page))[0];
  expect(source.memoBlockId).toBeTruthy();

  // ④ 그 탭을 닫고 다시 열면 메모에 담긴 악보가 그대로 되살아난다
  // "✏️ 악보로"는 새 탭이 보이도록 메모를 닫는다 — 탭이 남아 있는 동안 다시 열어 둔다
  // (머리말 메모 단추는 문서 종류에 따라 두 곳(#tools·#officeTools)에 있으니 보이는 쪽을 누른다).
  await page.locator("button[title='임시 메모 (Ctrl+M)']:visible").first().click();
  await expect(sheetBtn).toBeVisible();
  await page.evaluate((id) => closeDoc(id), source.id);
  await sheetBtn.click();
  await expect.poll(async () => (await musicDocs(page)).length).toBe(1);
  const reopened = (await musicDocs(page))[0];
  expect(reopened.id).not.toBe(source.id);
  expect(reopened.measures).toBe(4);
  expect(reopened.memoBlockId).toBe(source.memoBlockId);

  // ⑤ 되열린 악보에서 다시 메모로 → 새 블록이 아니라 같은 블록이 갱신된다
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
  await page.locator(".music-btn", { hasText:"메모로" }).last().click();
  await expect(imageBlocks).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("오른쪽 버튼으로 오선 한 단만 메모로 보낸다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 한 단에 다 들어가지 않을 만큼 길게 — 그래야 "한 단만" 이 전체와 구분된다.
  await openScore(page, `(() => {
    const sheet = musicEmpty("긴 악보");
    sheet.measures = Array.from({ length:12 }, () => musicMeasure(
      [musicNote("C", 4), musicNote("D", 4), musicNote("E", 4), musicNote("F", 4)]));
    return sheet;
  })()`);

  const score = page.locator(".music-score svg").last();
  const box = await score.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 60, { button:"right" });
  await page.locator(".music-context-menu button", { hasText:"저장·내보내기" }).hover();
  // 라벨에 마디 범위가 들어간다: "이 단(1~4마디)을 메모로"
  const lineItem = page.locator(".music-context-menu button", { hasText:/이 단\(.+\)을 메모로/ });
  await expect(lineItem).toHaveCount(1);
  await lineItem.click();

  await expect(page.locator("#scratchpad [data-block-id] .scratchpad-image-tools")).toHaveCount(1);
  const line = await memoImageInk(page);
  expect(line.ink).toBeGreaterThan(2000);
  // 한 단만 잘랐으니 단일 오선 한 단 높이(205 + 여유)를 2배로 구운 것보다 크지 않다.
  expect(line.height).toBeLessThanOrEqual(2 * (205 + 26));

  // 한 단만 보낸 것은 이 탭 전체가 아니므로 탭과 블록이 묶이지 않는다(나머지 단이 지워지면 안 된다).
  const before = (await musicDocs(page))[0];
  expect(before.memoBlockId).toBe(null);

  // 그 단의 마디만 담긴 악보로 되열린다.
  await page.locator(".scratchpad-reuse", { hasText:"악보로" }).click();
  await expect.poll(async () => (await musicDocs(page)).length).toBe(2);
  const reopened = (await musicDocs(page))[1];
  expect(reopened.measures).toBeGreaterThan(0);
  expect(reopened.measures).toBeLessThan(12);
  expect(reopened.name).toContain("마디");

  expect(errors).toEqual([]);
});
