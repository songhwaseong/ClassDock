const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 표 편집의 저장 대상.
 *
 * 도구막대의 [XLSX 저장]은 오래도록 '내려받기'였다. CSV 에서 변환한 표만 파일 핸들 갈래를 거쳤고,
 * 폴더로 열어 원본에 쓸 수 있는 xlsx 조차 다운로드 폴더에 사본을 떨군 뒤 "저장했어요"라고 알리고
 * 탭의 수정 표시까지 지웠다. 그래서 "저장했는데 다음에 그 파일을 열면 편집이 없다"가 됐다.
 * 이제 저장 입구는 Ctrl+S(quickSave) 하나이고, 내려받기는 [복사본 내려받기]로 따로 둔다.
 *
 * 여기서는 EXE 런처가 붙은 상태(=/save-file 로 디스크에 쓴다)를 흉내 내고,
 * 브라우저 저장 대화상자는 없는 환경으로 만들어 '버튼이 디스크까지 갔는지'만 본다.
 */

// EXE 런처가 있는 환경을 흉내 낸다 — /save-file 로 온 바이트를 그대로 붙잡아 둔다.
async function bootWithLauncher(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
    window.showSaveFilePicker = undefined;         // 저장 위치 대화상자가 없는 환경(구형 브라우저·file://)
    window.__saved = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      if (url.includes("/can-save-file")) return new Response("yes", { status:200 });
      if (url.includes("/save-file-exists")) return new Response("no", { status:200 });
      if (url.includes("/save-file")){
        const bytes = init && init.body ? new Uint8Array(await init.body.arrayBuffer()) : new Uint8Array();
        let rel = "";
        try { rel = decodeURIComponent((init.headers && init.headers["X-Save-Path"]) || ""); } catch(_){}
        window.__saved.push({ rel, bytes });
        return new Response("SaveRoot/" + rel, { status:200 });
      }
      if (url.includes("/workspace-save")) return new Response("ok", { status:200 });
      return realFetch(input, init);
    };
  });
  await collapseSidebar(page);
  await page.goto("/");
}

const cell = (page, r, c) => page.locator(`td[data-mrow="${r}"][data-mcol="${c}"]`);
const savedCount = (page) => page.evaluate(() => window.__saved.length);

// 사이드바 백드롭이 본문 클릭을 가로채므로 도구막대는 이벤트로 누른다.
async function pressButton(page, name){
  await page.locator("button", { hasText: name }).first().dispatchEvent("click");
}

async function typeCell(page, r, c, text){
  await cell(page, r, c).dispatchEvent("dblclick");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect.poll(() => cell(page, r, c).innerText()).toBe(text);
}

test("폴더로 연 xlsx: [XLSX 저장]이 다운로드가 아니라 파일에 쓴다", async ({ page }) => {
  await bootWithLauncher(page);
  await page.evaluate(async () => {
    await MNLazy.tryNeed("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["이름", "점수"], ["김철수", 80], ["이영희", 90]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type:"array", bookType:"xlsx" });
    await handleFiles([new File([out], "성적.xlsx",
      { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
  });
  await page.locator(".xlsx-editmode-btn").first().dispatchEvent("click");
  await expect(cell(page, 1, 1)).toBeVisible({ timeout: 15_000 });
  await typeCell(page, 1, 1, "55");

  await pressButton(page, /^XLSX 저장$/);
  await expect.poll(() => savedCount(page), { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() => window.__saved[0].rel)).toBe("성적.xlsx");

  // 저장한 바이트를 그대로 다시 열면 고친 값이 들어 있어야 한다.
  await page.evaluate(async () => {
    await handleFiles([new File([window.__saved[0].bytes], "성적.xlsx",
      { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
  });
  await expect(page.locator(".xlsx-sheet").last()).toContainText("55", { timeout: 15_000 });
});

test("CSV→XLSX 변환본도 편집한 내용 그대로 파일에 저장된다", async ({ page }) => {
  await bootWithLauncher(page);
  await page.locator("#fileInput").setInputFiles({
    name: "성적.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("이름,점수\n김철수,80\n이영희,90\n", "utf8")
  });
  await pressButton(page, "XLSX로 변환·편집");
  await page.locator(".csv-header-actions button").first().dispatchEvent("click");   // 첫 줄=머리글
  await expect(cell(page, 1, 1)).toBeVisible({ timeout: 15_000 });
  await typeCell(page, 1, 1, "55");

  await pressButton(page, /^XLSX 저장$/);
  await expect(page.locator("#textModal")).toBeVisible({ timeout: 15_000 });          // 새 파일 이름 확인
  await page.locator("#textOk").dispatchEvent("click");
  await expect.poll(() => savedCount(page), { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() => window.__saved[0].rel)).toBe("성적.xlsx");

  await page.evaluate(async () => {
    await handleFiles([new File([window.__saved[0].bytes], "성적.xlsx",
      { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
  });
  await expect(page.locator(".xlsx-sheet").last()).toContainText("55", { timeout: 15_000 });
});

test("[복사본 내려받기]는 파일을 건드리지 않고 수정 표시도 남긴다", async ({ page }) => {
  await bootWithLauncher(page);
  await page.evaluate(async () => {
    await MNLazy.tryNeed("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["이름", "점수"], ["김철수", 80]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type:"array", bookType:"xlsx" });
    await handleFiles([new File([out], "사본.xlsx",
      { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
  });
  await page.locator(".xlsx-editmode-btn").first().dispatchEvent("click");
  await expect(cell(page, 1, 1)).toBeVisible({ timeout: 15_000 });
  await typeCell(page, 1, 1, "77");

  const download = page.waitForEvent("download");
  await pressButton(page, "복사본 내려받기");
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  expect(await savedCount(page)).toBe(0);                                   // 파일에는 쓰지 않는다
  await expect.poll(() => page.evaluate(() =>
    !!docs.find((d) => d.name === "사본.xlsx" && d.hasUnsavedEdits))).toBe(true);
});
