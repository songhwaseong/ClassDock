const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 이조 악기 파트(P3). 여기서만 확인할 수 있는 것 —
// '소리 유지'를 고르면 화면의 음과 조표가 실제로 옮겨 적히는지, '적힌 음 그대로'는 음을 두고
// 소리만 내려가는지, 그리고 두 갈래가 확인창에서 갈리는지.

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

// 다장조 C4 온음표 한 마디짜리 악보
const SIMPLE = `(() => {
  const sheet = musicEmpty("이조 시험");
  sheet.measures = [musicMeasure([musicNote("C", 4, { value:"whole" })])];
  sheet.parts[0].measures = sheet.measures;
  sheet.parts[0].name = "클라리넷";
  return sheet;
})()`;

// 화면의 첫 음과 파트 상태를 모델에서 그대로 읽는다.
const partState = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find((item) => item.kind === "music");
  const part = musicActivePart(doc.sheet);
  const note = part.measures[0].notes[0];
  return {
    written:note.step + note.octave,
    key:doc.sheet.key,
    partKey:part.key,
    transposition:part.transposition || "",
    sounding:musicTimeline(doc.sheet, { partId:part.id, includeMuted:true }).events[0].midi
  };
});

test("소리 유지로 B♭ 악기를 고르면 악보가 장2도 올라가고 실음은 그대로다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openScore(page, SIMPLE);
  expect(await partState(page)).toMatchObject({ written:"C4", key:"C", transposition:"", sounding:60 });

  await page.locator(".music-part-transpose").selectOption("Bb");
  await page.locator("#confirmOk").click();                     // 소리 유지(옮겨 적기)

  const after = await partState(page);
  expect(after).toMatchObject({ written:"D4", key:"D", partKey:"D", transposition:"Bb", sounding:60 });
  // 조표 칸과 상태 줄도 함께 따라간다
  await expect(page.locator("select.music-key")).toHaveValue("D");
  await expect(page.locator(".music-status")).toContainText("B♭ 기보");
  await expect(page.locator(".music-status")).toContainText("실음 다장조");
  expect(errors).toEqual([]);
});

test("적힌 음 그대로를 고르면 악보는 그대로 두고 소리만 내려간다", async ({ page }) => {
  await openApp(page);
  await openScore(page, SIMPLE);

  await page.locator(".music-part-transpose").selectOption("Bb");
  await page.locator("#confirmAlt").click();                    // 적힌 음 그대로

  expect(await partState(page)).toMatchObject({ written:"C4", key:"C", transposition:"Bb", sounding:58 });

  // 되돌리기 한 번으로 이조 설정까지 되돌아온다
  await page.locator(".music-score").click({ position:{ x:20, y:20 } });
  await page.keyboard.press("Control+z");
  expect(await partState(page)).toMatchObject({ written:"C4", transposition:"", sounding:60 });
});

test("취소하면 아무것도 바뀌지 않고 고르개도 되돌아온다", async ({ page }) => {
  await openApp(page);
  await openScore(page, SIMPLE);

  await page.locator(".music-part-transpose").selectOption("F");
  await page.locator("#confirmCancel").click();

  expect(await partState(page)).toMatchObject({ written:"C4", transposition:"", sounding:60 });
  await expect(page.locator(".music-part-transpose")).toHaveValue("C");
});
