const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* MusicXML(.musicxml·.mxl)은 다른 파일처럼 "그 파일 그대로" 연다. 예전에는 편집용 .msheet 로 이름을 바꿔
   열어서, 저장하면 같은 폴더에 파일이 하나 더 생기고 자동 복원·작업공간 소속이 원본과 따로 놀았다.
   여기서만 확인할 수 있는 것 — 실제 DOMParser·JSZip 으로 원래 형식을 되쓰고 다시 읽는 왕복,
   남이 만든 원본을 덮어쓰기 전에 묻는 창, 따로 저장했을 때 원본 탭이 디스크 내용으로 돌아가는지. */

const EXTERNAL_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<score-partwise version="4.0">
  <work><work-title>바깥 악보</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  // 파일 핸들 흉내 — 쓴 내용은 window.__disk 에 남아 다시 읽을 수 있다.
  await page.evaluate(() => {
    window.__disk = {};
    window.__fakeHandle = (name, initial) => ({
      name, kind:"file",
      async getFile(){ return window.__disk[name] || initial; },
      async createWritable(){
        const chunks = [];
        return {
          async write(value){ chunks.push(value); },
          async close(){ window.__disk[name] = new File(chunks, name); }
        };
      }
    });
  });
}

// 이름 그대로 연 문서를 돌려준다(편집기가 붙을 때까지 기다린다).
async function openWithHandle(page, name, bytesExpr){
  await page.evaluate(async ({ name, bytesExpr }) => {
    const data = await (0, eval)(bytesExpr);
    const file = new File([data], name);
    await handleFiles([file], { fsHandle:window.__fakeHandle(name, file) });
  }, { name, bytesExpr });
  await expect(page.locator(".music-score svg").last()).toBeVisible({ timeout:15_000 });
}

const musicDoc = (page, name) => page.evaluate((name) => {
  const doc = docs.find(d => d.name === name);
  return doc ? { kind:doc.kind, owned:!!doc.musicXmlOwned, dirty:!!doc.hasUnsavedEdits,
    title:doc.sheet && doc.sheet.title, drumStyle:doc.sheet && doc.sheet.drumStyle } : null;
}, name);

test("남이 만든 .musicxml 은 이름 그대로 열고, 처음 저장에서만 덮어쓰기를 묻는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openWithHandle(page, "바깥.musicxml", JSON.stringify(EXTERNAL_XML));

  expect(await musicDoc(page, "바깥.musicxml")).toMatchObject({ kind:"music", owned:false });
  expect(await page.evaluate(() => docs.some(d => /\.msheet$/.test(d.name)))).toBe(false);

  // 앱에만 있는 설정(반주)을 바꿔 저장 — 덮어쓰기를 고른다
  await page.evaluate(() => { const doc = docs.find(d => d.name === "바깥.musicxml"); doc.sheet.drumStyle = "rock"; });
  const saving = page.evaluate(() => saveMusicSheet(docs.find(d => d.name === "바깥.musicxml")));
  await expect(page.locator("#confirmModal")).toBeVisible();
  await expect(page.locator("#confirmSub")).toContainText("다른 프로그램에서 만든 MusicXML");
  await page.locator("#confirmAlt").click();                 // 원본에 덮어쓰기
  expect(await saving).toBe(true);

  const written = await page.evaluate(async () => window.__disk["바깥.musicxml"].text());
  expect(written).toContain("<score-partwise");
  expect(written).toContain('miscellaneous-field name="classdock-msheet"');
  expect(await musicDoc(page, "바깥.musicxml")).toMatchObject({ owned:true, dirty:false });

  // 두 번째 저장은 묻지 않는다
  expect(await page.evaluate(() => saveMusicSheet(docs.find(d => d.name === "바깥.musicxml")))).toBe(true);
  await expect(page.locator("#confirmModal")).toBeHidden();

  // 저장한 파일을 다시 열면 앱에만 있는 설정까지 그대로 돌아온다
  await page.evaluate(async () => {
    const file = new File([await window.__disk["바깥.musicxml"].text()], "다시.musicxml");
    await handleFiles([file], { fsHandle:window.__fakeHandle("다시.musicxml", file) });
  });
  await expect.poll(() => musicDoc(page, "다시.musicxml")).toMatchObject({ owned:true, drumStyle:"rock", title:"바깥 악보" });

  expect(errors).toEqual([]);
});

test(".mxl 은 압축 형식 그대로 되쓴다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openWithHandle(page, "압축.mxl",
    `(async () => { const s = musicEmpty("압축 곡"); s.measures[0].notes.push(musicNote("E", 4)); return musicXmlBuildMxl(musicSerializeXml(s)); })()`);

  expect(await musicDoc(page, "압축.mxl")).toMatchObject({ kind:"music", owned:true, title:"압축 곡" });
  expect(await page.evaluate(() => saveMusicSheet(docs.find(d => d.name === "압축.mxl")))).toBe(true);
  await expect(page.locator("#confirmModal")).toBeHidden();       // 앱이 쓴 파일이라 묻지 않는다

  const head = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__disk["압축.mxl"].arrayBuffer());
    const text = await musicXmlReadMxl(window.__disk["압축.mxl"]);
    return { pk:bytes[0] === 0x50 && bytes[1] === 0x4b, fromClassDock:musicParseXmlText(text, "압축.mxl").fromClassDock };
  });
  expect(head).toEqual({ pk:true, fromClassDock:true });

  expect(errors).toEqual([]);
});

test("따로 저장하면 새 .msheet 탭이 편집을 가져가고 원본 탭은 디스크 내용으로 돌아간다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openWithHandle(page, "원본.musicxml", JSON.stringify(EXTERNAL_XML));
  await page.evaluate(() => {
    window.showSaveFilePicker = async (options) => window.__fakeHandle(options.suggestedName, null);
  });

  // 편집기 입력으로 제목을 바꿔 ● 를 켠다
  const title = page.locator("input.music-title").last();
  await title.fill("고친 제목");
  await title.press("Tab");
  await expect.poll(() => musicDoc(page, "원본.musicxml")).toMatchObject({ dirty:true, title:"고친 제목" });

  const saving = page.evaluate(() => saveMusicSheet(docs.find(d => d.name === "원본.musicxml")));
  await expect(page.locator("#confirmModal")).toBeVisible();
  await page.locator("#confirmOk").click();                  // 악보(.msheet)로 따로 저장
  expect(await saving).toBe(true);

  const separate = await page.evaluate(async () => {
    const made = docs.find(d => d.name === "원본.msheet");
    const disk = window.__disk["원본.msheet"];
    return { kind:made && made.kind, dirty:made && !!made.hasUnsavedEdits,
      savedTitle:disk ? JSON.parse(await disk.text()).title : null };
  });
  expect(separate).toEqual({ kind:"music", dirty:false, savedTitle:"고친 제목" });
  expect(await page.evaluate(() => Object.keys(window.__disk))).toEqual(["원본.msheet"]);   // 원본은 건드리지 않았다
  expect(await musicDoc(page, "원본.musicxml")).toMatchObject({ dirty:false, title:"바깥 악보", owned:false });

  expect(errors).toEqual([]);
});

test("저장 전 복구본은 원본 이름으로 되살아나고, 원본을 누가 만들었는지도 기억한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(async () => {
    const sheet = musicEmpty("복구 곡");
    sheet.drumStyle = "rock";
    const file = new File([musicXmlRecoveryText(sheet, false)], "복구.mxl");
    await handleFiles([file], {});
  });
  await expect.poll(() => musicDoc(page, "복구.mxl")).toMatchObject({ kind:"music", owned:false, drumStyle:"rock" });
  expect(errors).toEqual([]);
});
