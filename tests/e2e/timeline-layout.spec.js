const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 연대표 시안 B. 여기서만 확인할 수 있는 것 — 사건 목록이 실제로 왼쪽에 늘 열려 있는지(접은 상태 기억),
   아래 미니맵의 점이 사건 수만큼 찍히고 네모가 지금 보이는 구간을 따라가는지, 미니맵을 누르거나 네모를
   끌면 연대표가 옮겨 가는지, 목록에서 고르면 미니맵 점도 짚는지, 기호 단추가 그림으로 바뀌었는지. */

const EVENTS = ["676|삼국 통일", "751|불국사 창건", "918|고려 건국", "1145|삼국사기", "1231|몽골 침입", "1392|조선 건국",
  "1446|훈민정음", "1592|임진왜란", "1636|병자호란", "1876|강화도 조약", "1910|국권 피탈", "1945|광복"]
  .map((row, i) => { const [start, title] = row.split("|"); return { id:"e" + i, start, title, color:["blue", "green", "red", "purple"][i % 4] }; });
const SOURCE = JSON.stringify({ type:"classdock-timeline", version:2, title:"한국사 연대표", viewMode:"even", events:EVENTS });

async function openTimeline(page){
  await page.setViewportSize({ width:1400, height:900 });
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch (_) {} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name:"한국사.timeline", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8") });
  await expect(page.locator(".timeline-card")).toHaveCount(EVENTS.length);
}

test("사건 목록은 왼쪽에 처음부터 열려 있고, 접으면 기억한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTimeline(page);
  const panel = page.locator(".timeline-list-panel"), viewport = page.locator(".timeline-viewport");
  await expect(panel).toBeVisible();
  await expect(page.locator(".timeline-list-item")).toHaveCount(EVENTS.length);
  const [p, v] = await Promise.all([panel.boundingBox(), viewport.boundingBox()]);
  expect(p.x + p.width).toBeLessThanOrEqual(v.x + 1);                        // 목록이 왼쪽
  // 기호 단추는 그림으로(이름은 감춘 칸)
  const listBtn = page.locator(".timeline-bar .timeline-ico", { hasText:"목록" });
  await expect(listBtn.locator("svg.ui-icon")).toBeVisible();
  await expect(listBtn.locator(".timeline-btn-label")).toBeHidden();
  await expect(listBtn).toHaveAttribute("aria-pressed", "true");

  await listBtn.click();                                                       // 접기
  await expect(panel).toBeHidden();
  await page.reload();
  await page.locator("#fileInput").setInputFiles({ name:"한국사.timeline", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8") });
  await expect(page.locator(".timeline-card").first()).toBeVisible();
  await expect(page.locator(".timeline-list-panel").last()).toBeHidden();      // 접은 채 기억
  expect(errors).toEqual([]);
});

test("아래 미니맵: 사건마다 점이 찍히고, 네모가 보이는 구간을 따라가며, 누르거나 끌면 그리로 간다", async ({ page }) => {
  await openTimeline(page);
  const minimap = page.locator(".timeline-minimap"), viewport = page.locator(".timeline-viewport"), win = page.locator(".timeline-minimap-window");
  await expect(minimap).toBeVisible();
  await expect(page.locator(".timeline-minimap-dot")).toHaveCount(EVENTS.length);
  const scroll = () => viewport.evaluate((el) => el.scrollLeft);
  const winLeft = () => win.evaluate((el) => parseFloat(el.style.left));
  expect(await scroll()).toBe(0);
  expect(await winLeft()).toBeCloseTo(0, 1);
  const width = await win.evaluate((el) => parseFloat(el.style.width));
  expect(width).toBeGreaterThan(5); expect(width).toBeLessThan(100);           // 일부만 보인다

  // 연대표를 옆으로 굴리면 네모가 따라간다
  await viewport.evaluate((el) => { el.scrollLeft = el.scrollWidth / 2; });
  await expect.poll(winLeft).toBeGreaterThan(20);

  // 미니맵 왼쪽 끝을 누르면 처음으로
  const box = await minimap.boundingBox();
  await page.mouse.click(box.x + 16, box.y + box.height / 2);
  await expect.poll(scroll).toBeLessThan(40);

  // 네모를 잡고 오른쪽으로 끌면 따라 옮겨 간다
  const w = await win.boundingBox();
  await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
  await page.mouse.down();
  await page.mouse.move(w.x + w.width / 2 + box.width * .4, w.y + w.height / 2, { steps:8 });
  await page.mouse.up();
  expect(await scroll()).toBeGreaterThan(200);

  // 목록에서 고르면 미니맵 점도 짚는다
  await page.locator(".timeline-list-item", { hasText:"광복" }).click();
  await expect(page.locator('.timeline-minimap-dot[data-event-id="e11"]')).toHaveClass(/is-selected/);

  // 개요 보기에서는 미니맵을 감춘다(전체가 이미 보인다)
  await page.locator(".timeline-bar .timeline-btn", { hasText:"개요" }).click();
  await expect(minimap).toBeHidden();
});
