const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 큰 TV·고배율 화면에서 캔버스가 흐리지 않게, 캔버스 픽셀은 브라우저 배율(devicePixelRatio)에
   앱 'UI 크기'(body 의 CSS zoom)까지 곱해 잡는다. 또 UI 크기를 키우면 크롬(표준 zoom)이 clientX·
   getBoundingClientRect 를 확대된 px 로 주는데 style.left 는 확대 전 px 라, state.js 가 읽는 쪽을 한 곳에서
   확대 전 px 로 돌린다 — 그래야 캔버스가 칸에 맞고, 펜이 커서 밑에 그어지고, 우클릭 메뉴가 커서 자리에 뜬다.
   여기서 쓰는 boundingBox()·mouse 는 브라우저 바깥(CDP) 좌표라 그 변환을 거치지 않은 실제 화면 px 다. */

test.use({ deviceScaleFactor:2 });

async function openBoard(page, uiScale){
  await page.addInitScript((scale) => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko");
      localStorage.setItem("classDockSettings", JSON.stringify({ uiScale:scale }));
    } catch(_){}
  }, uiScale);
  await collapseSidebar(page);
  await page.goto("/");
  await page.keyboard.press("Alt+b");
  const canvas = page.locator(".wb-canvas");
  await expect(canvas).toBeVisible();
  return canvas;
}

// 화면 좌표 (x, y) 자리의 캔버스 픽셀이 배경과 다른지(무언가 그려졌는지) 본다. box 는 보이는 상자.
const inkedAt = (canvas, box, x, y) => canvas.evaluate((el, [b, px, py]) => {
  const sx = el.width / b.width, sy = el.height / b.height, ctx = el.getContext("2d");
  const at = (cx, cy) => Array.from(ctx.getImageData(Math.round(cx * sx), Math.round(cy * sy), 1, 1).data);
  const here = at(px - b.x, py - b.y), blank = at(8, b.height - 8);
  return here.some((v, i) => Math.abs(v - blank[i]) > 40);
}, [box, x, y]);

for (const uiScale of [1, 1.25]){
  test(`UI 크기 ${uiScale}배: 화이트보드 캔버스가 칸에 맞고 화면 픽셀과 1:1, 펜·우클릭 메뉴가 커서 자리에 온다`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const canvas = await openBoard(page, uiScale);
    const stage = page.locator(".wb-stage");

    // 캔버스는 칸보다 커지지 않는다(예전에는 UI 크기만큼 한 번 더 커져 오른쪽·아래가 잘렸다).
    await expect.poll(async () => {
      const [c, s] = [await canvas.boundingBox(), await stage.boundingBox()];
      return Math.abs(c.width - s.width) <= 2 && Math.abs(c.height - s.height) <= 2;
    }).toBe(true);

    // 캔버스 픽셀 = 보이는 크기 × 기기 배율(2) — 늘려 그리지 않으니 흐리지 않다.
    const box = await canvas.boundingBox();
    const pixels = await canvas.evaluate((el) => el.width);
    expect(pixels / box.width).toBeGreaterThan(1.97);
    expect(pixels / box.width).toBeLessThan(2.03);

    await page.locator(".wb-tool.wb-toolvis-pen").click();
    const y = box.y + 220, x1 = box.x + 300, x2 = box.x + 700;
    await page.mouse.move(x1, y);
    await page.mouse.down();
    await page.mouse.move(x2, y, { steps:12 });
    await page.mouse.up();
    expect(await inkedAt(canvas, box, (x1 + x2) / 2, y)).toBe(true);        // 커서가 지나간 자리
    expect(await inkedAt(canvas, box, (x1 + x2) / 2, y + 40)).toBe(false);  // 한참 아래는 비어 있다

    // 우클릭 메뉴는 커서 자리에 뜬다(예전에는 UI 크기만큼 오른쪽·아래로 밀려 떴다).
    const at = { x:box.x + 240, y:box.y + 60 };
    await page.mouse.click(at.x, at.y, { button:"right" });
    const menu = page.locator(".wb-focus-context-menu");
    await expect(menu).toBeVisible();
    const m = await menu.boundingBox();
    expect(Math.abs(m.x - at.x)).toBeLessThan(3);
    // 메뉴가 길어 세로는 화면 안으로 올려 붙인다 — 위 여백(6px, UI 크기만큼 커 보임) 자리에 딱 붙어야 한다.
    expect(Math.abs(m.y - 6 * uiScale)).toBeLessThan(2);
    expect(errors).toEqual([]);
  });
}

/* 미디어 쿼리는 확대 전 창 폭을 본다 — UI 크기 1.25 면 1280 창의 실제 배치 폭은 1024 라서 (max-width:1100px) 가
   걸려야 한다. 스타일시트 규칙·나중에 붙인 <style>·JS 의 matchMedia 가 모두 같은 답을 내야 한다. */
for (const uiScale of [1, 1.25]){
  test(`UI 크기 ${uiScale}배: 좁은 화면 규칙(미디어 쿼리)은 실제 배치 폭을 기준으로 걸린다`, async ({ page }) => {
    await page.setViewportSize({ width:1280, height:720 });
    await openBoard(page, uiScale);
    const narrow = uiScale > 1;
    const result = await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "@media (max-width: 1100px){ #mqProbe{ width:77px } }";
      document.head.appendChild(style);
      const probe = document.createElement("div"); probe.id = "mqProbe"; document.body.appendChild(probe);
      return new Promise(resolve => requestAnimationFrame(() => resolve({
        matchMedia: window.matchMedia("(max-width: 1100px)").matches,
        css: getComputedStyle(probe).width === "77px",
        resolutionUntouched: window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).matches
      })));
    });
    expect(result).toEqual({ matchMedia:narrow, css:narrow, resolutionUntouched:true });

    // 앱 화면은 창을 꼭 채운다 — 예전에는 폭을 100/zoom % 로 줄여 오른쪽 20% 가 비었다(표준 zoom 은 % 에 이미 zoom 을 반영).
    const body = await page.locator("body").boundingBox();
    expect(Math.abs(body.width - 1280)).toBeLessThan(2);
    expect(Math.abs(body.height - 720)).toBeLessThan(2);
  });
}
