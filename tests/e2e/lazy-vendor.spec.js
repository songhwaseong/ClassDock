const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 지연 로드(MNLazy) 회귀 검사.
 *
 * 무거운 vendor 라이브러리를 "시작할 때"가 아니라 "그 형식을 열 때" 싣는 구조라,
 * 두 가지가 함께 깨지지 않아야 한다.
 *   1) 시작 직후에는 그 전역들이 없어야 한다 — 있으면 지연 로드가 풀려 첫 화면이 다시 느려진 것.
 *   2) 실제로 그 기능을 쓰면 그 순간 로드돼 정상 동작해야 한다.
 *
 * 로드 방식이 배포본마다 다르므로 양쪽을 모두 본다.
 *   · "/"                              = 원본 HTML → vendor 스크립트를 그때 붙이는 경로
 *   · "/classdock-offline.html" = 단일 파일(EXE 와 같은 산출물) → 심어 둔 text/plain 실행 경로
 */

const PAGES = [
  { name: "원본 HTML(스크립트 주입)", url: "/" },
  { name: "단일 파일(text/plain 실행)", url: "/classdock-offline.html" }
];

// 시작할 때는 없어야 하는 전역들 — 각각 지연 로드 묶음의 대표 전역이다.
// __MN_KFONT_GZ_B64 는 한글 글꼴(0.9MB)이다. 라이브러리가 아니라 우리 생성물이지만,
// 파이썬 그래프에만 쓰이면서 앱 코드 중 가장 컸던 파일이라 같은 규율을 건다.
const DEFERRED_GLOBALS = ["XLSX", "ExcelJS", "JSZip", "docx", "hwpjs", "zip", "jsyaml", "__MN_KFONT_GZ_B64"];

async function boot(page, url){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto(url);
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

const globalsPresent = (page) => page.evaluate((names) =>
  names.filter((name) => typeof window[name] !== "undefined"), DEFERRED_GLOBALS);

for (const target of PAGES){
  test(`${target.name}: 무거운 라이브러리는 시작할 때 실행되지 않는다`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await boot(page, target.url);
    expect(await globalsPresent(page)).toEqual([]);
    // PDF 는 앱의 중심 기능이라 지금도 시작할 때 함께 싣는다(지연 대상이 아님).
    expect(await page.evaluate(() => typeof pdfjsLib !== "undefined" && typeof PDFLib !== "undefined")).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${target.name}: 표를 열면 그때 엑셀 라이브러리를 싣고 편집까지 된다`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await boot(page, target.url);
    expect(await page.evaluate(() => typeof XLSX !== "undefined")).toBe(false);

    // "새 빈 표"는 XLSX 로 진짜 파일을 만들어 편집 모드로 연다 → xlsx·exceljs 묶음을 모두 지난다.
    await page.evaluate(() => newSpreadsheetScratch());
    await expect(page.locator("td[data-mcol]").first()).toBeVisible();
    expect(await page.evaluate(() => typeof XLSX !== "undefined")).toBe(true);

    const cell = page.locator('td[data-mrow="0"][data-mcol="0"]');
    await cell.dblclick();
    await page.keyboard.type("지연로드");
    await page.keyboard.press("Enter");
    await expect.poll(() => cell.innerText()).toBe("지연로드");
    expect(errors).toEqual([]);
  });

  /* 한글 글꼴은 파이썬을 처음 돌릴 때 koreanFontGzB64() 안에서 실린다.
     Pyodide 를 통째로 띄우면 몇십 MB 를 받아야 하므로, 그 앞단인 koreanFontGzB64() 를 직접 부른다
     — 파이썬이 실제로 쓰는 함수 그대로다. 묶음을 부르는지, 진짜 gzip 글꼴이 오는지, 두 번째
     호출이 같은 값을 그대로 주는지(같은 파일을 다시 실행하지 않는지)까지 한 번에 본다. */
  test(`${target.name}: 한글 글꼴은 파이썬이 부를 때 실리고 풀 수 있는 글꼴이다`, async ({ page }) => {
    await boot(page, target.url);
    expect(await page.evaluate(() => typeof window.__MN_KFONT_GZ_B64)).toBe("undefined");

    const font = await page.evaluate(async () => {
      const b64 = await koreanFontGzB64();                     // 파이썬 초기화가 부르는 바로 그 함수
      const head = Uint8Array.from(atob(b64.slice(0, 4)), (ch) => ch.charCodeAt(0));
      const again = await koreanFontGzB64();
      return {
        length:b64.length,
        gzipMagic:head[0] === 0x1f && head[1] === 0x8b,
        stable:again === b64,
        scripts:document.querySelectorAll('[data-mn-lazy-loaded="korean-font.js"]').length
      };
    });
    expect(font.gzipMagic).toBe(true);          // gzip 머리표 1f 8b — 진짜 압축된 글꼴이 실렸다
    expect(font.length).toBeGreaterThan(900000);
    expect(font.stable).toBe(true);
    expect(font.scripts).toBe(1);               // 두 번 불러도 파일은 한 번만 실행된다
  });

  test(`${target.name}: 같은 묶음을 다시 요청해도 한 번만 싣는다`, async ({ page }) => {
    await boot(page, target.url);
    const loadedTwice = await page.evaluate(async () => {
      await Promise.all([MNLazy.need("xlsx"), MNLazy.need("xlsx")]);
      await MNLazy.need("xlsx");
      return document.querySelectorAll('[data-mn-lazy-loaded="xlsx.full.min.js"]').length;
    });
    expect(loadedTwice).toBe(1);
  });

  // docx-preview 는 로드 시점에 JSZip 3.x 를 붙잡고, PPTXjs·엑셀 복구 코드는 동기 API 의
  // 2.6.1 을 쓴다. 여는 순서가 어떻든 전역 JSZip 은 2.6.1(동기 generate)로 남아야 하고,
  // docx 는 자기가 붙잡은 3.x 로 계속 동작해야 한다.
  // (2.6.1 은 version 속성이 없고 generate 가 동기, 3.10.1 은 generateAsync 를 갖는다.)
  const zipFlavor = () => ({
    syncApi: typeof window.JSZip === "function" && typeof new window.JSZip().generate === "function",
    asyncApi: typeof window.JSZip === "function" && typeof new window.JSZip().generateAsync === "function"
  });

  test(`${target.name}: Word 를 먼저 열어도 전역 JSZip 은 동기 2.6.1 로 남는다`, async ({ page }) => {
    await boot(page, target.url);
    const flavor = await page.evaluate(async (probe) => {
      await MNLazy.need("docx");
      await MNLazy.need("pptx");
      return (0, eval)("(" + probe + ")")();
    }, zipFlavor.toString());
    expect(flavor).toEqual({ syncApi: true, asyncApi: false });
  });

  test(`${target.name}: PPT 를 먼저 열어도 Word 로드 뒤 JSZip 은 동기 2.6.1 로 남는다`, async ({ page }) => {
    await boot(page, target.url);
    const result = await page.evaluate(async (probe) => {
      await MNLazy.need("pptx");
      await MNLazy.need("docx");
      return {
        ...(0, eval)("(" + probe + ")")(),
        docxReady: typeof docx !== "undefined" && typeof docx.renderAsync === "function"
      };
    }, zipFlavor.toString());
    expect(result).toEqual({ syncApi: true, asyncApi: false, docxReady: true });
  });

  test(`${target.name}: Word·PPT 묶음을 동시에 요청해도 전역 JSZip 교체가 충돌하지 않는다`, async ({ page }) => {
    await boot(page, target.url);
    const flavor = await page.evaluate(async (probe) => {
      await Promise.all([MNLazy.need("docx"), MNLazy.need("pptx")]);
      return (0, eval)("(" + probe + ")")();
    }, zipFlavor.toString());
    expect(flavor).toEqual({ syncApi: true, asyncApi: false });
  });
}

// 펫 그림(약 1.6MB)도 옵션을 켤 때까지 JavaScript 로 파싱하지 않는다.
// 단일 파일 빌드에서는 경로가 데이터 URL 로 바뀌어야 실제로 그려진다.
test("단일 파일: 펫 스프라이트는 JSON 표에서 데이터 URL 로 풀린다", async ({ page }) => {
  await boot(page, "/classdock-offline.html");
  const resolved = await page.evaluate(() => petSpriteUrl("src/assets/fluffy-cat-sprites-v2.png"));
  expect(resolved.startsWith("data:image/png;base64,")).toBe(true);
  // 표에 없는 경로는 그대로 돌려줘, 서버로 서빙될 때의 상대 경로 동작이 유지된다.
  expect(await page.evaluate(() => petSpriteUrl("src/assets/없는그림.png"))).toBe("src/assets/없는그림.png");
});

test("원본 HTML: 펫 스프라이트 경로는 상대 경로 그대로 쓴다", async ({ page }) => {
  await boot(page, "/");
  expect(await page.evaluate(() => petSpriteUrl("src/assets/fluffy-cat-sprites-v2.png")))
    .toBe("src/assets/fluffy-cat-sprites-v2.png");
});
