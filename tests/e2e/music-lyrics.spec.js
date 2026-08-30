const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 가사 여러 절: 음표마다 창을 여는 대신 한 줄에서 이어 치고, 절을 늘리면 단이 그만큼 높아진다.
// 여기서만 확인할 수 있는 것 — 이어치기가 실제 자판 입력으로 다음 음표까지 따라가는지,
// 절이 늘 때 VexFlow 가 그린 SVG 높이가 함께 늘어 아랫단과 겹치지 않는지.

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

const lyricTexts = (page) => page.locator(".music-score svg .music-lyric").allTextContents();
const scoreHeight = (page) => page.locator(".music-score svg").last()
  .evaluate((svg) => Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height);
const openLyricMenu = async (page) => {
  await page.locator(".music-tools button", { hasText:"가사 ▾" }).click();
  await expect(page.locator(".music-context-menu")).toBeVisible();
};
const clickMenu = async (page, label) => {
  await page.locator(".music-context-menu button", { hasText:label }).first().click();
  await expect(page.locator(".music-context-menu")).toHaveCount(0);
};

test("이어치기로 가사를 넣고 절을 늘리면 단마다 절 번호와 두 줄이 생긴다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page, `musicExampleSheet("school-bell")`);
  const oneVerseHeight = await scoreHeight(page);

  // 1) 이어치기 — Space 로 다음 음표까지 따라간다
  await openLyricMenu(page);
  await clickMenu(page, "1절 이어치기");
  await expect(page.locator(".music-lyric-bar")).toBeVisible();
  await expect(page.locator(".music-lyric-bar strong")).toHaveText(/1절 \(1\//);
  for (const syllable of ["학", "교", "종"]){
    await page.locator(".music-lyric-input").fill(syllable);
    await page.locator(".music-lyric-input").press("Space");
  }
  await page.locator(".music-lyric-input").press("Escape");
  await expect(page.locator(".music-lyric-bar")).toBeHidden();
  expect(await lyricTexts(page)).toEqual(["학", "교", "종"]);

  // 2) 절 추가 → 한 줄 붙여넣기(음절 단위로 앞 음표부터)
  await openLyricMenu(page);
  await clickMenu(page, "절 추가");
  await openLyricMenu(page);
  await clickMenu(page, "2절에 한 줄 붙여넣기");
  await page.locator("#textInput").fill("우리 집");
  await page.locator("#textOk").click();
  expect(await lyricTexts(page)).toEqual(["학", "우", "교", "리", "종", "집"]);

  // 3) 단마다 절 번호가 붙고, 단 높이가 한 줄만큼 늘어난다
  const verseLabels = await page.locator(".music-score svg .music-lyric-verse").allTextContents();
  expect(verseLabels).toContain("1.");
  expect(verseLabels).toContain("2.");
  expect(await scoreHeight(page)).toBeGreaterThan(oneVerseHeight);

  // 4) 저장 모델에는 1절이 예전 자리(lyric)에, 2절부터가 lyrics 에 담긴다
  const saved = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find((item) => item.kind === "music");
    return JSON.parse(musicSerialize(doc.sheet));
  });
  const firstNote = saved.parts[0].measures[0].notes[0];
  expect(saved.lyricVerses).toBe(2);
  expect(firstNote.lyric).toBe("학");
  expect(firstNote.lyrics).toEqual(["학", "우"]);
  expect(errors).toEqual([]);
});

test("2절 가사 모두 지우기는 그 줄만 비우고 1절은 남긴다", async ({ page }) => {
  await openApp(page);
  await openScore(page, `musicExampleSheet("school-bell")`);
  await openLyricMenu(page);
  await clickMenu(page, "1절에 한 줄 붙여넣기");
  await page.locator("#textInput").fill("학 교 종");
  await page.locator("#textOk").click();
  await openLyricMenu(page);
  await clickMenu(page, "절 추가");
  await openLyricMenu(page);
  await clickMenu(page, "2절에 한 줄 붙여넣기");
  await page.locator("#textInput").fill("우 리 집");
  await page.locator("#textOk").click();
  expect(await lyricTexts(page)).toEqual(["학", "우", "교", "리", "종", "집"]);

  await openLyricMenu(page);
  await clickMenu(page, "2절 가사 모두 지우기");
  expect(await lyricTexts(page)).toEqual(["학", "교", "종"]);
  // 되돌리기 한 번으로 지운 절이 통째로 돌아온다
  await page.locator(".music-score").click({ position:{ x:20, y:20 } });
  await page.keyboard.press("Control+z");
  expect(await lyricTexts(page)).toEqual(["학", "우", "교", "리", "종", "집"]);
});

test("MusicXML 의 <lyric number> 여러 절을 그대로 읽어 온다", async ({ page }) => {
  await openApp(page);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>노래</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
        <lyric number="1"><text>봄</text></lyric><lyric number="2"><text>여</text></lyric></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
        <lyric number="1"><text>이</text></lyric><lyric number="2"><text>름</text></lyric></note>
      <note><rest/><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;
  await page.locator("#fileInput").setInputFiles({
    name:"두절.musicxml", mimeType:"application/vnd.recordare.musicxml+xml", buffer:Buffer.from(xml, "utf8")
  });
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
  expect(await lyricTexts(page)).toEqual(["봄", "여", "이", "름"]);
  expect(await page.locator(".music-score svg .music-lyric-verse").allTextContents()).toEqual(["1.", "2."]);
});
