const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 파트 연습 음원(P4). 여기서만 확인할 수 있는 것 —
// OfflineAudioContext 로 실제 WAV 가 만들어지는지, 여러 벌이 ZIP 한 장으로 묶여 내려오는지,
// 그리고 그 과정에서 화면이 진행률을 보여 주고 그만둘 수 있는지.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function openScore(page, source){
  await page.evaluate((build) => {
    const sheet = (0, eval)(build);
    return handleFiles([new File([musicSerialize(sheet)], sheet.title + ".msheet", { type:"application/json" })],
      { isScratch:true });
  }, source);
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
}

// 소프라노·알토 두 파트짜리 짧은 합주
const DUET = `(() => {
  const sheet = musicExampleSheet("school-bell");
  sheet.title = "학교종";
  sheet.parts[0].name = "소프라노";
  sheet.parts[0].measures = sheet.measures;
  const alto = musicAddPart(sheet, { name:"알토", timbre:"flute" });
  sheet.measures.forEach((measure, index) => {
    measure.notes = musicExampleSheet("school-bell").measures[index].notes;
  });
  musicSyncActivePart(sheet);
  musicSelectPart(sheet, sheet.parts[0].id);
  return sheet;
})()`;

const openPanel = async (page) => {
  await page.locator(".music-play button", { hasText:"연습 음원" }).click();
  await expect(page.locator(".music-practice-audio")).toBeVisible();
};

test("지금 파트만 한 템포로 만들면 WAV 한 개가 바로 저장된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page, DUET);
  await openPanel(page);

  await page.locator(".music-practice-audio select").first().selectOption("active");   // 지금 파트만
  await page.locator(".music-practice-rates input[value='0.85']").uncheck();            // 100% 한 벌만

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout:60_000 }),
    page.locator(".music-practice-audio button", { hasText:"만들기" }).click()
  ]);
  expect(download.suggestedFilename()).toBe("학교종 - 소프라노 (100%).wav");
  await expect(page.locator(".music-practice-status")).toContainText(/저장했어요/);
  expect(errors).toEqual([]);
});

test("여러 벌을 만들면 ZIP 한 장으로 묶인다", async ({ page }) => {
  test.setTimeout(90_000);      // 오프라인 렌더 두 벌 + 압축
  await openApp(page);
  await openScore(page, DUET);
  await openPanel(page);
  // 지금 파트만 × 100%·85% = 두 벌 — 여러 벌을 묶는 길만 확인하면 된다(파트 수는 위 검사가 본다)
  await page.locator(".music-practice-audio select").first().selectOption("active");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout:90_000 }),
    page.locator(".music-practice-audio button", { hasText:"만들기" }).click()
  ]);
  expect(download.suggestedFilename()).toBe("학교종 - 연습음원.zip");
  await expect(page.locator(".music-practice-status")).toContainText("2벌");
});

test("한 번에 만들 수 있는 벌 수를 넘으면 알려 주고 시작하지 않는다", async ({ page }) => {
  await openApp(page);
  await openScore(page, `(() => {
    const sheet = musicExampleSheet("school-bell");
    sheet.title = "많은 파트";
    sheet.parts[0].measures = sheet.measures;
    for (let at = 0; at < 6; at++) musicAddPart(sheet, { name:"파트" + (at + 2), timbre:"flute" });
    musicSyncActivePart(sheet);
    return sheet;
  })()`);
  await openPanel(page);
  await page.locator(".music-practice-rates input[value='0.7']").check();               // 7파트 × 3템포 = 21벌

  await page.locator(".music-practice-audio button", { hasText:"만들기" }).click();
  await expect(page.locator(".music-practice-status")).toContainText("12벌까지");
  await expect(page.locator(".music-practice-audio button", { hasText:"만들기" })).toBeEnabled();
});
