const { test, expect } = require("@playwright/test");
const { storedZip } = require("./helpers");

/* 압축 파일 안에 든 앱 전용 문서(.mnote·.msheet)를 제 편집기로 여는지 확인한다.
   이 확장자들이 ZIP_OPENABLE 에 없던 동안에도 "내용이 텍스트면 연다"는 폴백 덕에 작은 파일은
   열렸지만, 그 폴백에는 32MB 상한이 있어 사진이 여러 장 든 블록 문서는 조용히 빠졌다.
   목록에 등록하면 압축 항목 상한(128MB)을 따르게 된다. */
const MNOTE = JSON.stringify({
  format: "classdock-note",
  version: 1,
  title: "수업 노트",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  blocks: [{ id: "text-1", type: "text", text: "안녕하세요" }]
}, null, 2);

const MSHEET = JSON.stringify({
  format: "classdock-sheet",
  version: 4,
  title: "동요",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  tempo: 100,
  time: { beats: 4, beatValue: 4 },
  key: "C",
  clef: "treble",
  staffMode: "single",
  measures: [{ id: "m-1", voices: [[]] }]
}, null, 2);

/* 압축형 MusicXML(.mxl)은 그 자체가 ZIP 이다 — 압축 안의 압축이라, 바깥 항목이 "텍스트면 연다"
   폴백에 걸리지 않아 예전에는 통째로 빠졌다(형식 미지원으로 셌다). 안쪽을 푸는 일은 이미
   music-xml.js 가 하고 있으므로, 바깥에서 걸러 내지만 않으면 된다. */
const MUSICXML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<score-partwise version="4.0">
  <work><work-title>압축 악보</work-title></work>
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const CONTAINER = '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
  + '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
  + '</rootfiles></container>';

const MXL = storedZip([
  { name: "META-INF/container.xml", data: CONTAINER },
  { name: "score.musicxml", data: MUSICXML }
]);

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await page.goto("/");
}

test("압축 파일 안의 블록 문서·악보를 제 편집기로 연다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);

  await page.locator("#fileInput").setInputFiles({
    name: "수업묶음.zip",
    mimeType: "application/zip",
    buffer: storedZip([
      { name: "수업 노트.mnote", data: MNOTE },
      { name: "동요.msheet", data: MSHEET }
    ])
  });

  // 압축을 풀어도 첫 파일을 자동으로 열지는 않는다(의도된 동작) — 목록에 올라오는지부터 본다.
  const rows = page.locator("#sbList .sb-item");
  await expect(rows.filter({ hasText: "수업 노트.mnote" })).toHaveCount(1, { timeout: 20_000 });
  await expect(rows.filter({ hasText: "동요.msheet" })).toHaveCount(1);

  // 텍스트로 떨어지지 않고 각자의 문서 종류로 열려야 한다.
  const kinds = await page.evaluate(() => {
    const byName = {};
    for (const doc of docs) byName[doc.name] = doc.kind;
    return byName;
  });
  expect(kinds["수업 노트.mnote"]).toBe("mnote");
  expect(kinds["동요.msheet"]).toBe("music");

  // 눌러서 실제로 편집기가 뜨는지까지 확인한다.
  await rows.filter({ hasText: "수업 노트.mnote" }).click();
  await expect(page.locator(".mnote-doc")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator(".mnote-title")).toHaveValue("수업 노트");

  expect(errors).toEqual([]);
});

test("압축 안의 압축형 MusicXML(.mxl)도 악보로 가져온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);

  await page.locator("#fileInput").setInputFiles({
    name: "악보묶음.zip",
    mimeType: "application/zip",
    buffer: storedZip([
      { name: "압축 악보.mxl", data: MXL },        // 바깥 ZIP 안에 든 또 하나의 ZIP
      { name: "메모.txt", data: "안녕" }
    ])
  });

  /* .mxl 은 원본을 덮어쓰지 않고 편집 가능한 새 .msheet 로 가져온다(이름이 바뀐다).
     예전에는 여기서 "형식 미지원"으로 세어지고 사라졌다. */
  await expect(page.locator("#sbList .sb-item").filter({ hasText: "압축 악보.msheet" }))
    .toHaveCount(1, { timeout: 20_000 });
  const kinds = await page.evaluate(() => docs.map(d => ({ name:d.name, kind:d.kind })));
  expect(kinds).toContainEqual({ name: "압축 악보.msheet", kind: "music" });
  expect(kinds).toContainEqual({ name: "메모.txt", kind: "office" });

  // 안쪽 XML 의 내용까지 살아 있어야 한다(제목·마디).
  const sheet = await page.evaluate(() => {
    const doc = docs.find(d => d.kind === "music");
    return { title: doc.sheet.title, measures: doc.sheet.measures.length };
  });
  expect(sheet.title).toBe("압축 악보");
  expect(sheet.measures).toBe(1);

  expect(errors).toEqual([]);
});
