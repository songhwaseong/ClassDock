const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 그림 크게 보기: 실행 결과 그래프·노트북 출력 그림을 클릭하면 새 탭이 아니라 오버레이로 확대한다.
 *
 * 클릭 진입은 document 위임 한 개로 받는다(갤러리는 실행할 때마다 새로 그려지므로). 그래서
 * "그림을 만드는 쪽"과 "확대 창"이 분리돼 있고, 둘을 잇는 선택자·캡처 단계 등록이 이 기능의
 * 안전선이다. 노트북 셀은 출력 영역에서 클릭 전파를 끊는 곳이 많아 캡처 등록이 특히 중요하다. */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

// 실제 PNG 두 장을 페이지 안에서 만든다(파이썬 실행 결과와 같은 dataURL 형태).
async function makePlots(page){
  return page.evaluate(() => {
    const draw = (color) => {
      const c = document.createElement("canvas");
      c.width = 400; c.height = 240;
      const g = c.getContext("2d");
      g.fillStyle = color; g.fillRect(0, 0, 400, 240);
      return c.toDataURL("image/png");
    };
    return [draw("#cc2222"), draw("#2222cc")];
  });
}

// 무대(스크롤 상자)와 그림의 실제 크기 — 배율 계산이 맞았는지 보는 잣대.
async function measure(page){
  return page.evaluate(() => {
    const img = document.querySelector("#plotZoomImg").getBoundingClientRect();
    const stage = document.querySelector("#plotZoomStage").getBoundingClientRect();
    return { imgW:img.width, imgH:img.height, stageW:stage.width, stageH:stage.height };
  });
}

test("실행 결과 그래프를 클릭하면 확대 창이 열리고 ESC 로 닫힌다", async ({ page }) => {
  await boot(page);
  const plots = await makePlots(page);
  await page.evaluate((srcs) => {
    const host = document.createElement("div");
    host.id = "plotHost";
    document.body.appendChild(host);
    appendPlotGallery(host, srcs);        // 파이썬 실행 결과가 그리는 것과 같은 경로
  }, plots);

  await expect(page.locator("#plotHost img.out-plot")).toHaveCount(2);
  await page.locator("#plotHost img.out-plot").first().click();

  await expect(page.locator(".plot-zoom")).toBeVisible();
  await expect(page.locator("#plotZoomCount")).toHaveText("1 / 2");
  // 같은 갤러리의 다른 그림으로 넘어간다(새 탭이 아니라 한 창 안에서).
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#plotZoomCount")).toHaveText("2 / 2");
  expect(await page.evaluate(() => document.querySelectorAll(".plot-zoom").length)).toBe(1);

  await page.keyboard.press("Escape");
  await expect(page.locator(".plot-zoom")).toBeHidden();
  // 확대 창이 열려 있는 동안만 ESC 를 가로챈다 — 닫힌 뒤에는 흔적이 남지 않아야 한다.
  expect(await page.evaluate(() => !!document.querySelector("#plotZoomImg").getAttribute("src"))).toBe(false);
});

test("내용이 같은 그림도 클릭한 순서에서 연다", async ({ page }) => {
  await boot(page);
  const plots = await makePlots(page);
  await page.evaluate((src) => {
    const host = document.createElement("div");
    host.id = "plotHost";
    document.body.appendChild(host);
    appendPlotGallery(host, [src, src]);
  }, plots[0]);

  await page.locator("#plotHost img.out-plot").nth(1).click();
  await expect(page.locator("#plotZoomCount")).toHaveText("2 / 2");
});

test("확대·화면 맞춤 버튼이 그림 배율을 바꾼다", async ({ page }) => {
  await boot(page);
  const plots = await makePlots(page);
  await page.evaluate((srcs) => {
    const host = document.createElement("div");
    host.id = "plotHost";
    document.body.appendChild(host);
    appendPlotGallery(host, [srcs[0]]);
  }, plots);

  await page.locator("#plotHost img.out-plot").click();
  await expect(page.locator(".plot-zoom")).toBeVisible();
  // 한 장뿐이면 넘기기 버튼은 숨는다.
  await expect(page.locator("#plotZoomPrev")).toBeHidden();
  await expect(page.locator("#plotZoomScale")).toContainText("맞춤");

  // 화면 맞춤은 줄이기만 하는 게 아니라 창에 닿을 때까지 늘린다(400×240 그림 → 무대 한 변에 밀착).
  const fitted = await measure(page);
  expect(fitted.imgW).toBeGreaterThan(400);
  expect(Math.min(fitted.stageW - fitted.imgW, fitted.stageH - fitted.imgH)).toBeLessThan(8);

  await page.locator("#plotZoomIn").click();
  await expect(page.locator("#plotZoomScale")).not.toContainText("맞춤");
  const zoomed = await measure(page);
  expect(zoomed.imgW).toBeGreaterThan(fitted.imgW);

  await page.locator("#plotZoomFit").click();
  await expect(page.locator("#plotZoomScale")).toContainText("맞춤");
  expect(Math.abs((await measure(page)).imgW - fitted.imgW)).toBeLessThan(2);
  await page.locator("#plotZoomDone").click();
  await expect(page.locator(".plot-zoom")).toBeHidden();
});

test("화면 맞춤 배율이 기본 단계 밖이어도 확대·축소 방향이 바뀌지 않는다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const svg = (w, h, color) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/></svg>`
    );
    const host = document.createElement("div");
    host.id = "plotHost";
    document.body.appendChild(host);
    appendPlotGallery(host, [svg(8000, 5000, "#228833"), svg(120, 80, "#883322")]);
  });

  await page.locator("#plotHost img.out-plot").first().click();
  await expect(page.locator(".plot-zoom")).toBeVisible();
  await expect.poll(() => page.locator("#plotZoomImg").evaluate((img) => img.naturalWidth)).toBe(8000);
  const hugeFit = await measure(page);
  await page.locator("#plotZoomOut").click();
  expect((await measure(page)).imgW).toBeLessThan(hugeFit.imgW);

  await page.locator("#plotZoomDone").click();
  await page.locator("#plotHost img.out-plot").nth(1).click();
  await expect.poll(() => page.locator("#plotZoomImg").evaluate((img) => img.naturalWidth)).toBe(120);
  const tinyFit = await measure(page);
  await page.locator("#plotZoomIn").click();
  expect((await measure(page)).imgW).toBeGreaterThan(tinyFit.imgW);
});

test("확대한 그림을 드래그하면 그림만 이동하고 모달은 움직이지 않는다", async ({ page }) => {
  await boot(page);
  const plots = await makePlots(page);
  await page.evaluate((src) => {
    const host = document.createElement("div");
    host.id = "plotHost";
    document.body.appendChild(host);
    appendPlotGallery(host, [src]);
  }, plots[0]);

  await page.locator("#plotHost img.out-plot").click();
  await page.locator("#plotZoomIn").click();
  const before = await page.evaluate(() => {
    const card = document.querySelector(".plot-zoom-card").getBoundingClientRect();
    const stage = document.querySelector("#plotZoomStage");
    return { left:card.left, top:card.top, scrollLeft:stage.scrollLeft };
  });
  const box = await page.locator("#plotZoomImg").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps:5 });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const card = document.querySelector(".plot-zoom-card").getBoundingClientRect();
    const stage = document.querySelector("#plotZoomStage");
    return { left:card.left, top:card.top, scrollLeft:stage.scrollLeft };
  });

  expect(Math.abs(after.left - before.left)).toBeLessThan(2);
  expect(Math.abs(after.top - before.top)).toBeLessThan(2);
  expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft);
});

test("노트북 출력 그림도 같은 확대 창을 쓴다", async ({ page }) => {
  await boot(page);
  const plots = await makePlots(page);
  await page.evaluate((srcs) => {
    const host = document.createElement("div");
    host.id = "nbHost";
    document.body.appendChild(host);
    const img = document.createElement("img");
    img.className = "nbv-out-img";
    img.src = srcs[0];
    img.alt = "실행 결과 그림";
    host.appendChild(img);
    // 노트북 셀처럼 클릭 전파를 끊는 상위 요소가 있어도 확대는 열려야 한다.
    host.addEventListener("click", (e) => e.stopPropagation());
  }, plots);

  await page.locator("#nbHost img.nbv-out-img").click();
  await expect(page.locator(".plot-zoom")).toBeVisible();
  await expect(page.locator("#plotZoomTitle")).toHaveText("실행 결과 그림");
  await page.keyboard.press("Escape");
  await expect(page.locator(".plot-zoom")).toBeHidden();
});
