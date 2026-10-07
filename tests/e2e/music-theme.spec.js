const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 악보 색 테마. 여기서만 확인할 수 있는 것 — VexFlow 가 실제로 그린 오선·음표·가사에 테마 색이
// 계산돼 들어가는지(VexFlow 그룹은 fill/stroke 를 물려받는 구조라 CSS 가 닿는지는 그려 봐야 안다),
// 기본은 예전 그대로인지, 마디 띠가 그림·인쇄로 떼어내도 검정 상자가 되지 않는지.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function openScore(page){
  await page.evaluate(() => {
    const sheet = musicEmpty("색 시험");
    sheet.measures = [
      musicMeasure([musicNote("C", 4, { value:"quarter", lyric:"도" }), musicNote("E", 4, { value:"quarter", lyric:"미" }),
        musicNote("G", 4, { value:"quarter", lyric:"솔" }), musicNote("C", 4, { value:"quarter", lyric:"도" })]),
      musicMeasure([musicNote("E", 4, { value:"quarter" }), musicNote("G", 4, { value:"quarter" }),
        musicNote("A", 4, { value:"half" })])
    ];
    sheet.parts[0].measures = sheet.measures;
    return handleFiles([new File([musicSerialize(sheet)], sheet.title + ".msheet", { type:"application/json" })],
      { isScratch:true });
  });
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
}

async function pickTheme(page, name){
  const tab = page.locator(".music-tab", { hasText:"악보/가사" }).last();
  await tab.click();
  await expect(tab).toHaveClass(/is-on/);
  const button = page.locator(".music-score-tools button", { hasText:"색 테마 ▾" });
  if (!(await page.locator(".music-theme-pop").count())) await button.click();
  await page.locator(".music-theme-preset", { hasText:name }).click();
  await expect(page.locator(".music-theme-preset.is-on", { hasText:name })).toBeVisible();
}

const rgb = (hex) => {
  const n = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${n[0]}, ${n[1]}, ${n[2]})`;
};

const paint = (page) => page.evaluate(() => {
  const svg = document.querySelector(".music-score svg");
  const staffLine = svg.querySelector(".vf-stave > path");
  const notehead = svg.querySelector(".music-note[data-step='C'] .vf-notehead text");
  const noteE = svg.querySelector(".music-note[data-step='E'] .vf-notehead text");
  const lyric = svg.querySelector(".music-lyric");
  const barline = svg.querySelector(".vf-stavebarline rect");
  const score = document.querySelector(".music-score");
  return {
    theme: document.querySelector(".music-doc").getAttribute("data-score-theme"),
    staffLine: getComputedStyle(staffLine).stroke,
    notehead: getComputedStyle(notehead).fill,
    noteE: getComputedStyle(noteE).fill,
    lyric: getComputedStyle(lyric).fill,
    barline: getComputedStyle(barline).fill,
    paper: getComputedStyle(score).backgroundColor,
    bands: svg.querySelectorAll(".music-measure-band").length,
    bandAttrs: [...svg.querySelectorAll(".music-measure-band")].map((band) => band.getAttribute("fill"))
  };
});

test("기본은 예전 검정 악보 그대로이고, 프리셋을 고르면 오선·음표·가사·종이 색이 바뀐다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page);

  const plain = await paint(page);
  expect(plain.theme).toBeNull();
  expect(plain.bands).toBe(0);
  expect(plain.staffLine).toBe("rgb(0, 0, 0)");
  expect(plain.paper).toBe("rgb(255, 255, 255)");

  await pickTheme(page, "칠판 무대");
  const chalk = await paint(page);
  expect(chalk.theme).toBe("chalk");
  expect(chalk.staffLine).toBe(rgb("#9fbfb2"));
  expect(chalk.notehead).toBe(rgb("#f4f1e6"));
  expect(chalk.lyric).toBe(rgb("#9fe1cb"));
  expect(chalk.barline).toBe(rgb("#dcebe4"));
  expect(chalk.paper).toBe(rgb("#1f3a32"));
  // 마디 띠는 마디마다 하나, 속성은 none — 테마 규칙 없이 떼어낸 SVG 에서 검정 상자가 되지 않는다
  expect(chalk.bands).toBe(2);
  expect(chalk.bandAttrs).toEqual(["none", "none"]);

  await pickTheme(page, "계이름 무지개");
  const rainbow = await paint(page);
  expect(rainbow.notehead).toBe(rgb("#e24b4a"));   // 도 = 빨강
  expect(rainbow.noteE).toBe(rgb("#c99a00"));      // 미 = 겨자
  expect(rainbow.lyric).toBe(rgb("#e24b4a"));      // 가사 '도'도 같은 색

  // 다시 기본으로 — 테마 속성·띠가 모두 사라진다
  await pickTheme(page, "지금까지의 검정 악보");
  const back = await paint(page);
  expect(back.theme).toBeNull();
  expect(back.bands).toBe(0);
  expect(back.staffLine).toBe("rgb(0, 0, 0)");
  expect(errors).toEqual([]);
});

test("색을 직접 고치면 바로 칠해지고 저장되며, 원래 색으로 되돌릴 수 있다", async ({ page }) => {
  await openApp(page);
  await openScore(page);
  await pickTheme(page, "라벤더 노트");

  const line = page.locator(".music-theme-field input[data-theme-field='line']");
  await page.locator(".music-theme-custom summary").click();
  await line.evaluate((input) => {
    input.value = "#ff0000";
    input.dispatchEvent(new Event("input", { bubbles:true }));
    input.dispatchEvent(new Event("change", { bubbles:true }));
  });
  expect((await paint(page)).staffLine).toBe("rgb(255, 0, 0)");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("musicScoreTheme")));
  expect(saved).toEqual({ id:"lavender", colors:{ line:"#ff0000" }, flags:{} });

  await page.locator(".music-theme-foot button", { hasText:"이 테마 원래 색으로" }).click();
  expect((await paint(page)).staffLine).toBe(rgb("#b9b4e6"));

  // 새로 연 악보도 같은 테마로 열린다(문서가 아니라 이 컴퓨터 설정)
  await page.keyboard.press("Escape");
  await openScore(page);
  expect(await page.locator(".music-doc").last().getAttribute("data-score-theme")).toBe("lavender");
});

test("연습 진행형은 재생할 때 지나간 음을 흐리게 하고 지금 마디에 띠를 깐다", async ({ page }) => {
  await openApp(page);
  await openScore(page);
  await pickTheme(page, "연습 진행형");
  await page.keyboard.press("Escape");
  await expect(page.locator(".music-theme-pop")).toHaveCount(0);

  const tab = page.locator(".music-tab", { hasText:"파일/재생" }).last();
  await tab.click();
  await page.locator(".music-btn", { hasText:"전체 재생" }).last().click();
  await expect(page.locator(".music-score .music-note.is-played").first()).toBeAttached({ timeout:10_000 });
  await expect(page.locator(".music-score .music-measure-band.is-now")).toHaveCount(1);
  const faded = await page.evaluate(() => {
    const note = document.querySelector(".music-score .music-note.is-played .vf-notehead text");
    return getComputedStyle(note).fill;
  });
  expect(faded).not.toBe("rgb(4, 44, 83)");   // 음표 색(#042c53)보다 흐리다
  await page.locator(".music-tbtn[aria-label='정지']").last().click();
  await expect(page.locator(".music-score .music-note.is-played")).toHaveCount(0);
  await expect(page.locator(".music-score .music-measure-band.is-now")).toHaveCount(0);
});
