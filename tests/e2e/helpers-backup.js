const { expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 전체 백업 ZIP 왜복 e2e 공용 동작.
   원본 HTML·단일 파일·EXE 로컬 서버 — 어느 배포본에서 열든 같은 결과가 나와야
   하므로, 왜복 절차를 한 군데 두고 스펙들이 가져다 쓴다.
   (*.spec.js 가 아니므로 테스트로 수집되지 않는다.) */

/* 앱이 쓸 수 있게 될 때까지 기다린다.
   마크업은 스크립트보다 먼저 보이므로 #commandPaletteOpen 만으로는 모자란다 — 특히
   단일 파일 배포본은 33MB 를 한 번에 실행해서, 그 사이에 단언하면 docs 가 아직 없다. */
async function appReady(page){
  await expect(page.locator("#commandPaletteOpen")).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(
    () => typeof docs !== "undefined" && typeof MNBackup !== "undefined" && typeof newWhiteboard === "function",
    null, { timeout: 30000 });
}

// 화이트보드를 하나 열고, 글자 하나를 얹은 뒤 복구본까지 남긴다.
async function makeBoard(page, text){
  const id = await page.evaluate(() => newWhiteboard().id);
  await page.evaluate((docId) => setActiveDoc(docId), id);
  // 보드가 여러 개면 .wb-canvas 도 여러 개다 — 화면 대신 그 문서가 그려졌는지를 본다.
  await expect.poll(() => page.evaluate((docId) => {
    const doc = docs.find(d => d.id === docId);
    return !!(doc && doc.boardState && typeof doc.flushBoardRecovery === "function");
  }, id), { timeout: 15000 }).toBe(true);
  await page.evaluate(({ docId, label }) => {
    const doc = docs.find(d => d.id === docId);
    doc.boardState.items.push({
      type:"text", color:"#111111", x:40, y:60, text:label, fontSize:18, textBaseFontSize:18
    });
    return doc.flushBoardRecovery();
  }, { docId:id, label:text });
  return id;
}

function boardSummary(page){
  return page.evaluate(() => docs.filter(d => d.kind === "board").map(d => ({
    name:d.name,
    texts:((d.boardState && d.boardState.items) || [])
      .filter(item => item && item.type === "text").map(item => item.text)
  })));
}

async function exportBackup(page){
  const wait = page.waitForEvent("download");
  await page.evaluate(() => MNBackup.exportBackup());
  const download = await wait;
  await expect(page.getByText("전체 백업 ZIP을 만들었어요.")).toBeVisible();
  return download.path();
}

async function restoreBackup(page, zipPath){
  /* 새로고침을 확실히 기다리기 위한 표식. waitForLoadState("load") 는 이미 로드된
     현재 문서 때문에 그자리에서 돌아와, 복원이 끝나기도 전에 단언하게 된다. */
  await page.evaluate(() => { window.__beforeRestore = true; });
  await page.locator("#backupRestoreInput").setInputFiles(zipPath);
  await expect(page.locator("#confirmModal")).toBeVisible();
  await page.locator("#confirmOk").click();
  await page.waitForFunction(() => window.__beforeRestore === undefined, null, { timeout: 30000 });
  await appReady(page);
}

/* 백업 왕복 본체 — 어느 배포본에서 열든 결과는 같아야 한다.
   부르는 쪽에서 페이지를 띄운 뒤 넘긴다. */
async function roundTrip(page){
  // 작업공간 바이트까지 백업에 담기도록 파일도 하나 연다(workspacePresent 경로).
  await page.locator("#fileInput").setInputFiles({
    name: "백업메모.txt", mimeType: "text/plain", buffer: Buffer.from("백업 확인용\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("백업메모.txt");

  await makeBoard(page, "첫째 판서");
  await makeBoard(page, "둘째 판서");

  // 탭 상태에 보드 두 개가 실릴 때까지 기다린다 — 중복 회귀는 바로 이 기록 때문에 났다.
  await expect.poll(() => page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem("classdock-tabs:v1") || "null") || {}).boards?.length || 0; }
    catch(_){ return 0; }
  }), { timeout: 15000 }).toBe(2);

  const before = await boardSummary(page);
  expect(before.map(b => b.name)).toEqual(["화이트보드", "화이트보드 2"]);

  const zipPath = await exportBackup(page);
  expect(zipPath).toBeTruthy();

  // 백업 뒤에 상태를 흐트러뜨린다 — 복원이 이것을 백업 시점으로 되돌려야 한다.
  await makeBoard(page, "백업 뒤에 만든 판서");
  await expect.poll(() => page.evaluate(() => docs.filter(d => d.kind === "board").length)).toBe(3);

  await restoreBackup(page, zipPath);

  // 핵심: 두 개여야 한다. 고치기 전에는 자동 복원분·매니페스트분·자동 저장이 겹쳐 다섯 개가 됐다.
  await expect.poll(() => page.evaluate(() => docs.filter(d => d.kind === "board").length),
    { timeout: 30000 }).toBe(2);
  const after = await boardSummary(page);
  expect(after.map(b => b.name).sort()).toEqual(["화이트보드", "화이트보드 2"]);
  expect(after.flatMap(b => b.texts).sort()).toEqual(["둘째 판서", "첫째 판서"]);

  // 되돌린 기록을 앱의 자동 저장이 다시 덮지 않았는지 — 탭 구성까지 백업 시점이어야 한다.
  const tabs = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("classdock-tabs:v1") || "null"); } catch(_){ return null; }
  });
  expect((tabs && tabs.boards || []).map(b => b.name).sort()).toEqual(["화이트보드", "화이트보드 2"]);

  // 복원 표식은 소비되고 남지 않는다(다음 실행에서 또 만들지 않게).
  expect(await page.evaluate(() =>
    localStorage.getItem("classdock-backup:pending-restore:v1"))).toBeNull();
}

async function boot(page, url){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto(url);
  await appReady(page);
}

module.exports = { boot, appReady, makeBoard, boardSummary, exportBackup, restoreBackup, roundTrip };
