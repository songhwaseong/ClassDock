const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 마디 번호·연습 기호·한 줄 마디 수(P2). 여기서만 확인할 수 있는 것 —
// VexFlow 가 실제로 그린 SVG 안에 번호·기호가 남는지(그림·인쇄가 이 SVG 를 그대로 쓴다),
// 한 줄 마디 수를 고정하면 단 수가 실제로 달라지는지, 못갖춘마디에서 화면 번호와
// 재생 구간 칸의 숫자가 어긋나지 않는지.

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

const openLayoutMenu = async (page) => {
  await page.locator(".music-tools button", { hasText:"조판 ▾" }).click();
  await expect(page.locator(".music-context-menu")).toBeVisible();
};
const clickMenu = async (page, label) => {
  await page.locator(".music-context-menu button", { hasText:label }).first().click();
};
const numbers = (page) => page.locator(".music-score svg .music-measure-number").allTextContents();
// VexFlow 의 .vf-stave 는 '단'이 아니라 '마디'마다 하나씩 생긴다. 단 수는 기본(단마다) 모드에서
// 줄 첫 마디에만 붙는 마디 번호로 센다.
const lineHeads = (page) => page.locator(".music-score svg .music-measure-number").allTextContents();

// 16마디 악보 — 한 줄 마디 수를 바꾸면 단 수가 눈에 띄게 달라진다.
const SIXTEEN = `(() => {
  const sheet = musicEmpty("조판 시험");
  sheet.measures = Array.from({ length:16 }, () => musicMeasure([musicNote("G", 4, { value:"whole" })]));
  sheet.parts[0].measures = sheet.measures;
  return sheet;
})()`;

test("마디 번호는 단마다·모든 마디로 바꿔 켜고 SVG 안에 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page, SIXTEEN);

  // 기본값은 '단마다' — 줄 첫 마디에만 번호가 붙는다(모든 마디에 붙지 않는다)
  const heads = await lineHeads(page);
  expect(heads.length).toBeGreaterThan(0);
  expect(heads.length).toBeLessThan(16);
  expect(heads[0]).toBe("1");
  expect([...heads].map(Number)).toEqual([...heads].map(Number).slice().sort((a, b) => a - b));

  await openLayoutMenu(page);
  await page.locator(".music-context-menu button", { hasText:"마디 번호" }).first().hover();
  await clickMenu(page, "모든 마디");
  await expect(page.locator(".music-score svg .music-measure-number")).toHaveCount(16);
  expect(await numbers(page)).toEqual(Array.from({ length:16 }, (_, at) => String(at + 1)));

  await openLayoutMenu(page);
  await page.locator(".music-context-menu button", { hasText:"마디 번호" }).first().hover();
  await clickMenu(page, "끄기");
  await expect(page.locator(".music-score svg .music-measure-number")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("한 줄 마디 수를 고정하면 단 수가 그대로 따라온다", async ({ page }) => {
  await openApp(page);
  await openScore(page, SIXTEEN);

  await openLayoutMenu(page);
  await page.locator(".music-context-menu button", { hasText:"한 줄 마디 수" }).first().hover();
  await clickMenu(page, "4마디씩");
  // 단마다 붙는 번호가 곧 단의 첫 마디다 — 16마디를 넷씩 자르면 1·5·9·13 이다.
  await expect(page.locator(".music-score svg .music-measure-number")).toHaveCount(4);
  expect(await lineHeads(page)).toEqual(["1", "5", "9", "13"]);

  await openLayoutMenu(page);
  await page.locator(".music-context-menu button", { hasText:"한 줄 마디 수" }).first().hover();
  await clickMenu(page, "2마디씩");
  await expect(page.locator(".music-score svg .music-measure-number")).toHaveCount(8);
  expect(await lineHeads(page)).toEqual(["1", "3", "5", "7", "9", "11", "13", "15"]);

  // 저장 모델에도 남아 다시 열면 같은 자리에서 줄이 바뀐다
  const saved = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find((item) => item.kind === "music");
    return JSON.parse(musicSerialize(doc.sheet));
  });
  expect(saved.barsPerLine).toBe(2);
});

test("연습 기호는 도돌이·1번 괄호 자리에 자동으로 매기고 네모 상자로 그린다", async ({ page }) => {
  await openApp(page);
  await openScore(page, `(() => {
    const sheet = musicEmpty("연습 기호");
    sheet.measures = Array.from({ length:8 }, () => musicMeasure([musicNote("G", 4, { value:"whole" })]));
    sheet.measures[2].repeatStart = true;
    sheet.measures[5].ending = 1;
    sheet.parts[0].measures = sheet.measures;
    return sheet;
  })()`);

  await openLayoutMenu(page);
  await clickMenu(page, "연습 기호 자동으로 매기기");
  await expect(page.locator(".music-score svg .music-rehearsal")).toHaveCount(2);
  expect(await page.locator(".music-score svg .music-rehearsal").allTextContents()).toEqual(["A", "B"]);
  await expect(page.locator(".music-score svg .music-rehearsal-box")).toHaveCount(2);

  await openLayoutMenu(page);
  await clickMenu(page, "연습 기호 모두 지우기");
  await expect(page.locator(".music-score svg .music-rehearsal")).toHaveCount(0);
});

test("못갖춘마디가 있으면 번호는 다음 마디부터 1이고 재생 구간 칸도 같은 번호를 쓴다", async ({ page }) => {
  await openApp(page);
  await openScore(page, `(() => {
    const sheet = musicEmpty("여린내기");
    sheet.measures = Array.from({ length:5 }, () => musicMeasure([musicNote("G", 4, { value:"quarter" })]));
    sheet.measures[0].pickupTicks = 480;
    sheet.measures = sheet.measures.map((measure, index) => index === 0 ? measure : measure);
    sheet.measureNumbers = "every";
    sheet.parts[0].measures = sheet.measures;
    return sheet;
  })()`);

  // 못갖춘마디에는 번호를 찍지 않고, 그 다음 마디가 1번이다
  expect(await numbers(page)).toEqual(["1", "2", "3", "4"]);
  // 마지막 칸도 배열 길이(5)가 아니라 화면에 찍히는 마지막 번호(4)
  await expect(page.locator(".music-score-toolbar input.music-range, input.music-range").last()).toHaveValue("4");
});
