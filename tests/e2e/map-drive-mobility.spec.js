const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 자동차 길찾기의 카카오모빌리티 확장 — 다중 경유지·출발 시각(미래 길찾기)·여러 곳까지 비교(다중 목적지).
 * 런처는 흉내 낸다(/geocode). 여기서 보는 것은 화면이 어느 API 를 어떤 값으로 부르는가와 그 답을 어떻게 보이는가다.
 * 실제 카카오 응답 모양은 2026-09-18 실제 키로 확인했다(답 모양이 기본 길찾기와 같다). */
async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await page.evaluate(() => {
    saveAppSettings({ mapSearchProvider:"kakao" });
    window.__classDockMapSearchKeyStatus = { available:true, hasKey:true };
    newMapScratch();
  });
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("classdock-map-search-status-change")));
}
const route = (distance) => ({ result_code:0, result_msg:"길찾기 성공",
  summary:{ distance, duration:distance / 10, fare:{ toll:0, taxi:9000 }, priority:"RECOMMEND" },
  sections:[{ distance, duration:distance / 10, roads:[{ name:"세종대로", distance, duration:distance / 10,
    traffic_speed:30, traffic_state:4, vertexes:[126.97, 37.56, 127.0, 37.55] }], guides:[] }] });
async function stubLauncher(page){
  const calls = [];
  await page.route("**/geocode?**", (request) => {
    const url = new URL(request.request().url());
    const provider = url.searchParams.get("provider");
    calls.push({ provider, via:url.searchParams.get("via") || "", depart:url.searchParams.get("depart") || "",
      priority:url.searchParams.get("priority") });
    if (provider === "kakao-destinations"){
      const via = (url.searchParams.get("via") || "").split("|");
      return request.fulfill({ contentType:"application/json", body:JSON.stringify({ routes:via.map((_, i) =>
        i === 1 ? { result_code:304, result_msg:"반경 밖", key:String(i) }
          : { result_code:0, key:String(i), summary:{ distance:1000 * (via.length - i), duration:120 * (via.length - i) } }) }) });
    }
    return request.fulfill({ contentType:"application/json", body:JSON.stringify({ routes:[route(12000)] }) });
  });
  return calls;
}
async function addMarkers(page, count){
  await page.evaluate((count) => {
    const rows = ["이름,위도,경도"];
    for (let i = 0; i < count; i++) rows.push(`곳${i + 1},${(37.55 + i * 0.004).toFixed(4)},${(126.97 + (i % 3) * 0.004).toFixed(4)}`);
    return rows.join("\n");
  }, count).then(async (text) => {
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".map-csv-import").click();
    await (await chooser).setFiles({ name:"p.csv", mimeType:"text/csv", buffer:Buffer.from(text, "utf8") });
  });
  await expect.poll(() => page.evaluate(() => docs.find(d => d.kind === "map").mapDoc.markers.length)).toBe(count);
}

test("경유지가 5곳을 넘으면 다중 경유지로 한 번에 잇는다", async ({ page }) => {
  const calls = await stubLauncher(page);
  await openApp(page);
  await addMarkers(page, 10);
  await page.locator(".map-drive-toggle").click();
  await page.locator(".map-drive-apply").click();
  await expect.poll(() => calls.filter(c => c.provider !== "kakao-destinations").length).toBe(1);
  const call = calls[0];
  expect(call.provider).toBe("kakao-waypoints");
  expect(call.via.split("|")).toHaveLength(8);              // 표시 10개 = 출발 + 경유 8 + 도착
  await expect(page.locator(".map-drive-label")).toContainText("표시 10개");
});

test("출발 시각을 정하면 미래 길찾기로 묻고, 지난 시각은 받지 않는다", async ({ page }) => {
  const calls = await stubLauncher(page);
  await openApp(page);
  await addMarkers(page, 3);
  await page.locator(".map-drive-toggle").click();
  const modal = page.locator(".map-drive-settings-modal");
  await modal.locator('input[name="map-drive-depart"][value="later"]').check();
  await modal.locator(".map-drive-depart-at").fill("2020-01-01T08:30");
  await modal.locator(".map-drive-apply").click();
  await expect(modal.locator(".map-drive-settings-note")).toContainText("지금보다 뒤로");
  const next = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const value = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T08:30`;
  await modal.locator(".map-drive-depart-at").fill(value);
  await modal.locator(".map-drive-apply").click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].provider).toBe("kakao-future");
  expect(calls[0].depart).toBe(value.replace(/[-T:]/g, ""));
  await expect(page.locator(".map-drive-label")).toContainText("출발 예상");
  // 출발 시각은 문서에 남기지 않는다(다음에 열면 이미 지난 시각이다).
  expect(await page.evaluate(() => JSON.stringify(docs.find(d => d.kind === "map").mapDoc))).not.toContain(value.replace(/[-T:]/g, ""));
});

test("첫 표시에서 나머지까지 비교하면 시간순 표로 보이고 반경 밖은 따로 적는다", async ({ page }) => {
  const calls = await stubLauncher(page);
  await openApp(page);
  await addMarkers(page, 4);
  await page.locator(".map-drive-toggle").click();
  const modal = page.locator(".map-drive-settings-modal");
  await expect(modal.locator(".map-drive-destinations-sub")).toContainText("곳1에서 다른 표시 3곳");
  await modal.locator(".map-drive-destinations-run").click();
  const rows = modal.locator(".map-drive-destinations-wrap tbody tr");
  await expect(rows).toHaveCount(3);
  const call = calls.find(c => c.provider === "kakao-destinations");
  expect(call.via.split("|")).toHaveLength(3);
  expect(call.priority).toBe("TIME");                       // RECOMMEND 는 이 API 가 받지 않는다
  // 시간이 짧은 순 — 키 2(곳4)가 가장 빠르고, 키 1(곳3)은 반경 밖이라 맨 끝.
  await expect(rows.nth(0)).toContainText("곳4");
  await expect(rows.nth(2)).toContainText("반경(10km) 밖");
});
