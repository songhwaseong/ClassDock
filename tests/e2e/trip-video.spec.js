const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { collapseSidebar } = require("./helpers");

/* 여행일지 장소 영상 — 장소 줄에 짧은 영상을 달고, 누르면 곧바로 틀리고, 저장본에 담기는지.
 * 테스트 크로미엄은 H.264 가 없어 webm(VP8) 조각을 쓴다(tests/fixtures, ffmpeg testsrc 로 만든 것). */

const CLIP = fs.readFileSync(path.join(__dirname, "..", "fixtures", "trip-clip.webm"));
// 한도(2분)를 넘는 130초짜리 — 작은 화면·낮은 비트레이트라 100KB 남짓이다.
const LONG = fs.readFileSync(path.join(__dirname, "..", "fixtures", "trip-clip-long.webm"));

async function bootWithSpot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newTripScratch && window.newTripScratch());
  await expect(page.locator(".trip-bar")).toBeVisible();
  await page.locator(".trip-add-day").click();
  await page.locator(".trip-add-spot").click();
  await page.locator(".trip-spot-name").fill("성산일출봉");
}

async function pickVideos(page, files){
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".trip-spot-video-add").first().click();
  await (await chooser).setFiles(files);
}

const spotVideos = page => page.evaluate(() => {
  const doc = docs.find(d => d.kind === "trip");
  return JSON.parse(JSON.stringify(doc.trip.days[0].spots[0].videos || []));
});

test("장소 줄의 영상 단추로 넣으면 첫 장면·길이가 보이고, 누르면 바로 틀린다", async ({ page }) => {
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"clip.webm", mimeType:"video/webm", buffer:CLIP }]);

  const tile = page.locator(".trip-spot-video");
  await expect(tile).toHaveCount(1);
  await expect(tile.locator("img")).toHaveCount(1);          // 첫 장면 그림
  await expect(tile.locator(".trip-spot-video-dur")).toHaveText("0:02");
  const videos = await spotVideos(page);
  expect(videos).toHaveLength(1);
  expect(videos[0].v).toMatch(/^assets\/[a-z0-9]+\.webm$/);
  expect(videos[0].p).toMatch(/^assets\/[a-z0-9]+\.jpg$/);
  expect(videos[0].d).toBeCloseTo(2, 0);

  await tile.locator(".trip-spot-video-view").click();
  const modal = page.locator(".trip-video-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".trip-video-title")).toHaveText("성산일출봉");
  await expect.poll(() => page.locator(".trip-video-player").evaluate(v => v.currentTime), { timeout:5000 }).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  expect(await page.locator(".trip-video-player").evaluate(v => v.paused)).toBe(true);
  await expect(page.locator(".trip-bar")).toBeVisible();     // Esc 가 편집기까지 흘러가지 않는다
});

test("영상은 저장본에 담겨 되살아나고, 빼면 되돌리기로 되살린다", async ({ page }) => {
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"clip.webm", mimeType:"video/webm", buffer:CLIP }]);
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);

  const round = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "trip");
    const back = await tripUnpack(tripPack(doc.trip, doc.tripAssets, Date.now()));
    const video = back.model.days[0].spots[0].videos[0];
    return { video, size:back.assets.get(video.v).bytes.length, version:JSON.parse(tripModelJson(back.model)).version,
      same:tripContentKey(back.model) === tripContentKey(doc.trip) };
  });
  expect(round.size).toBe(CLIP.length);
  expect(round.version).toBe(3);
  expect(round.same).toBe(true);

  await page.locator(".trip-spot-video .trip-spot-photo-remove").click();
  await expect(page.locator(".trip-spot-video")).toHaveCount(0);
  await page.locator(".trip-undo-btn").click();
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
});

test("긴 영상·같은 영상은 받지 않고 까닭을 알린다", async ({ page }) => {
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"long.webm", mimeType:"video/webm", buffer:LONG }]);
  await expect(page.locator(".trip-status")).toContainText("너무 길어요(2분까지)");
  await expect(page.locator(".trip-spot-video")).toHaveCount(0);

  await pickVideos(page, [
    { name:"a.webm", mimeType:"video/webm", buffer:CLIP },
    { name:"b.webm", mimeType:"video/webm", buffer:CLIP }
  ]);
  await expect(page.locator(".trip-status")).toContainText("이미 넣은 영상");
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
});

test("EXE 에 ffmpeg 가 있으면 긴 영상도 런처가 줄이고 앞 2분만 넣는다", async ({ page }) => {
  let sent = null;
  await page.route("**/can-convert-media", route => route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  // 런처 대신 답한다: 받은 원본 크기·물음을 적어 두고, 줄인 결과로 2초짜리 조각을 돌려준다
  // (테스트 크로미엄은 H.264 가 없어 실제 런처의 MP4 대신 webm 을 쓴다 — 받는 쪽은 실제 <video> 로 다시 살핀다).
  await page.route("**/shrink-media?**", async route => {
    const req = route.request();
    sent = { url:req.url(), size:(req.postDataBuffer() || Buffer.alloc(0)).length };
    await route.fulfill({ status:200, contentType:"video/mp4", body:CLIP,
      headers:{ "X-Media-Source-Duration-Ms":"130000" } });
  });
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"long.webm", mimeType:"video/webm", buffer:LONG }]);
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
  await expect(page.locator(".trip-status")).toContainText("작게 줄임 1개");
  await expect(page.locator(".trip-status")).toContainText("앞 2분만 1개");
  expect(sent.size).toBe(LONG.length);
  expect(sent.url).toContain("dim=1280");
  expect(sent.url).toContain("sec=120");
  const videos = await spotVideos(page);
  expect(videos[0].v).toMatch(/\.webm$|\.mp4$/);
  expect(videos[0].d).toBeLessThanOrEqual(120);
});

test("작고 그대로 틀리는 영상은 ffmpeg 가 있어도 줄이지 않고, 줄이기가 실패하면 까닭을 알린다", async ({ page }) => {
  let calls = 0;
  await page.route("**/can-convert-media", route => route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route("**/shrink-media?**", route => { calls++; return route.fulfill({ status:500, body:"shrink-media-failed: x" }); });
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"clip.webm", mimeType:"video/webm", buffer:CLIP }]);
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
  expect(calls).toBe(0);
  await pickVideos(page, [{ name:"long.webm", mimeType:"video/webm", buffer:LONG }]);
  await expect(page.locator(".trip-status")).toContainText("줄이지 못했어요");
  expect(calls).toBe(1);
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
});

test("영상만 있는 장소도 지도 표식 미리보기에 첫 장면이 뜨고, 누르면 바로 틀린다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"clip.webm", mimeType:"video/webm", buffer:CLIP }]);
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
  await page.locator(".trip-spot-pick").click();
  const stage = page.locator(".trip-map-stage");
  await expect(stage).toHaveClass(/is-picking/);
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(stage).not.toHaveClass(/is-picking/);

  await stage.locator(".trip-map-pin").first().click({ force:true });
  const thumb = page.locator(".trip-map-video-thumb");
  await expect(thumb).toHaveCount(1);
  await expect(page.locator(".trip-map-photo-head span")).toHaveText("영상 1개");
  await expect(thumb.locator("img")).toHaveCount(1);
  await thumb.click();
  await expect(page.locator(".trip-video-modal")).toBeVisible();
  await expect.poll(() => page.locator(".trip-video-player").evaluate(v => v.currentTime), { timeout:5000 }).toBeGreaterThan(0);
});

test("인쇄 표에는 영상이 있다는 것과 길이만 적는다", async ({ page }) => {
  await bootWithSpot(page);
  await pickVideos(page, [{ name:"clip.webm", mimeType:"video/webm", buffer:CLIP }]);
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
  // 인쇄 층은 인쇄가 끝나면 치워진다 — print() 가 불리는 순간에 읽어 둔다
  await page.evaluate(() => {
    window.print = () => {
      const layer = document.getElementById("tripPrintLayer");
      window.__printedVideo = [...layer.querySelectorAll(".trip-print-video")].map(el => el.textContent);
    };
  });
  await page.locator(".trip-print-btn").click();
  await page.getByRole("menuitem", { name:"이 날" }).click();
  await expect.poll(() => page.evaluate(() => window.__printedVideo || null)).toEqual(["▶ 영상 1개 · 0:02"]);
});

test("장소 줄 위로 영상을 끌어다 놓으면 새 탭이 아니라 그 장소에 붙는다", async ({ page }) => {
  await bootWithSpot(page);
  const tabs = await page.locator(".tab").count();
  const dt = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "drop.webm", { type:"video/webm" }));
    return data;
  }, [...CLIP]);
  const row = page.locator(".trip-spot").first();
  await row.dispatchEvent("dragover", { dataTransfer:dt });
  await expect(row).toHaveClass(/is-drop/);
  await row.dispatchEvent("drop", { dataTransfer:dt });
  await expect(page.locator(".trip-spot-video")).toHaveCount(1);
  await expect(row).not.toHaveClass(/is-drop/);
  expect(await page.locator(".tab").count()).toBe(tabs);
});
