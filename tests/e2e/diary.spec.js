const { test, expect } = require("@playwright/test");
const { collapseSidebar, stableBox } = require("./helpers");
const { solidPng, bandPng } = require("./helpers-png");

/* 일기장(.diary) — 달력으로 날짜를 오가며 쓰기, 줄 무늬가 글줄과 맞기, 사진 스티커를 끌어 옮기기,
 * 그 날만 따로 꾸미기, 저장한 ZIP 을 다시 열었을 때 그대로인지. */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newDiaryScratch && window.newDiaryScratch());
  await expect(page.locator(".diary-bar")).toBeVisible();
  await expect(page.locator(".diary-paper")).toBeVisible();
}

const todayKey = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

test("오늘 날짜로 열리고, 글을 쓰면 달력에 점이 찍히며 줄 간격이 글줄 높이와 같다", async ({ page }) => {
  await boot(page);
  const today = todayKey();
  await expect(page.locator(".diary-date")).toHaveClass(/is-today/);
  const cell = page.locator(`.diary-cal-day[data-date="${today}"]`);
  await expect(cell).toHaveClass(/is-selected/);
  await expect(cell).not.toHaveClass(/has-entry/);

  const area = page.locator(".diary-text");
  await area.click();
  await page.keyboard.type("오늘은 맑았다.");
  await expect(cell).toHaveClass(/has-entry/);
  await expect(page.locator(".diary-status")).toContainText("저장 안 됨");
  await expect(page.locator(".diary-month-item")).toHaveCount(1);
  await expect(page.locator(".diary-month-item-label")).toHaveText("오늘은 맑았다.");

  const metrics = await area.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { lh:cs.lineHeight, pt:cs.paddingTop, bg:cs.backgroundImage, size:cs.backgroundSize };
  });
  expect(metrics.lh).toBe("34px");
  expect(metrics.pt).toBe("34px");
  expect(metrics.bg).toContain("linear-gradient");
  expect(metrics.size).toContain("34px");

  // 다른 날로 갔다가 돌아와도 글이 남아 있고, 비어 있는 날은 점이 없다.
  await page.locator(".diary-day-nav").first().click();
  await expect(area).toHaveValue("");
  await page.locator(".diary-cal-today").click();
  await expect(area).toHaveValue("오늘은 맑았다.");
});

test("사진을 붙이면 스티커가 되고, 끌면 옮겨지며 Ctrl+Z 로 되돌아간다", async ({ page }) => {
  await boot(page);
  const png = solidPng(200, 100, [220, 80, 120]);
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"꽃.png", mimeType:"image/png", buffer:png });
  const sticker = page.locator(".diary-sticker");
  await expect(sticker).toHaveCount(1);
  await expect(sticker).toHaveClass(/is-selected/);
  const box = await stableBox(sticker);
  expect(Math.round(box.width / box.height)).toBe(2);             // 가로세로 비율 유지

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps:6 });
  await page.mouse.up();
  const moved = await stableBox(sticker);
  expect(Math.round(moved.x - box.x)).toBe(60);
  expect(Math.round(moved.y - box.y)).toBe(40);

  // 모서리 손잡이로 키우기
  const handle = sticker.locator(".diary-sticker-handle");
  const hb = await stableBox(handle);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 50, hb.y + hb.height / 2, { steps:5 });
  await page.mouse.up();
  const grown = await stableBox(sticker);
  expect(Math.round(grown.width - moved.width)).toBe(50);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => Math.round(((await sticker.boundingBox()) || {}).width)).toBe(Math.round(moved.width));
  await page.keyboard.press("Control+z");
  await expect.poll(async () => Math.round(((await sticker.boundingBox()) || {}).x)).toBe(Math.round(box.x));

  // Delete 로 떼기
  await sticker.click();
  await page.keyboard.press("Delete");
  await expect(sticker).toHaveCount(0);
});

test("종이에 떨어뜨린 사진은 새 탭이 아니라 그 자리의 스티커가 된다", async ({ page }) => {
  await boot(page);
  const tabsBefore = await page.locator("#docTabs .tab").count();
  const png = solidPng(80, 80, [30, 120, 200]).toString("base64");
  const paper = page.locator(".diary-paper");
  const pb = await stableBox(paper);
  await page.evaluate(async ({ b64, x, y }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "하늘.png", { type:"image/png" }));
    const target = document.querySelector(".diary-text");
    for (const type of ["dragenter", "dragover", "drop"]){
      target.dispatchEvent(new DragEvent(type, { bubbles:true, cancelable:true, dataTransfer:dt, clientX:x, clientY:y }));
    }
  }, { b64:png, x:pb.x + 300, y:pb.y + 200 });
  const sticker = page.locator(".diary-sticker");
  await expect(sticker).toHaveCount(1);
  const sb = await stableBox(sticker);
  expect(Math.abs(sb.x + sb.width / 2 - (pb.x + 300))).toBeLessThan(3);
  expect(Math.abs(sb.y + sb.height / 2 - (pb.y + 200))).toBeLessThan(3);
  await expect(page.locator("#docTabs .tab")).toHaveCount(tabsBefore);
  await expect(page.locator("#dropOverlay")).not.toHaveClass(/show/);
});

test("꾸미기: 일기장 전체 줄 무늬와 그 날만 따로 꾸미기", async ({ page }) => {
  await boot(page);
  const paper = page.locator(".diary-paper");
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  const panel = page.locator(".diary-style-panel");
  await expect(panel).toBeVisible();
  await panel.locator('.diary-line-chip[data-lines="grid"]').click();
  await expect(paper).toHaveAttribute("data-lines", "grid");

  // 오늘만 점 무늬로
  await panel.locator(".diary-style-scope input").check();
  await panel.locator('.diary-line-chip[data-lines="dots"]').click();
  await panel.locator('.diary-chip[data-gap="wide"]').click();
  await expect(paper).toHaveAttribute("data-lines", "dots");
  expect(await page.locator(".diary-text").evaluate(el => getComputedStyle(el).lineHeight)).toBe("42px");
  await expect(page.locator(`.diary-cal-day[data-date="${todayKey()}"]`)).toHaveClass(/has-entry/);   // 꾸미기만 한 날도 남는다

  // 다른 날은 일기장 전체(모눈) 그대로
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.locator(".diary-day-nav").first().click();
  await expect(paper).toHaveAttribute("data-lines", "grid");
  await page.locator(".diary-cal-today").click();
  await expect(paper).toHaveAttribute("data-lines", "dots");

  // 배경 그림 넣기 → 종이 뒤에 깔리고 흐리게 조절이 켜진다
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  const bg = bandPng(64, 64, [250, 200, 0], [0, 160, 90]);
  await page.locator(".diary-bar input[type=file]").nth(1).setInputFiles({ name:"배경.png", mimeType:"image/png", buffer:bg });
  await expect(page.locator(".diary-paper-bg")).toBeVisible();
  await expect(panel.locator('input[type="range"]')).toBeEnabled();
});

test("저장한 일기장(ZIP)을 다시 열면 글·스티커·꾸미기가 그대로다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-entry-title").fill("첫 일기");
  await page.locator(".diary-text").fill("줄 하나\n줄 둘");
  const png = solidPng(120, 60, [10, 10, 10]);
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"a.png", mimeType:"image/png", buffer:png });
  await expect(page.locator(".diary-sticker")).toHaveCount(1);

  // 파일로 쓰는 대신 저장과 같은 묶음을 만들어 새 문서로 연다(저장 대화상자 없이 왕복 확인).
  await page.evaluate(async () => {
    const doc = docs.find((d) => d.kind === "diary");
    const bytes = diaryPack(doc.diary, doc.diaryAssets);
    await handleFiles([new File([bytes], "왕복.diary", { type:"application/zip" })], {});
  });
  await expect(page.locator(".diary-doc")).toHaveCount(2);
  const reopened = page.locator(".office:not([hidden]) .diary-doc");
  await expect(reopened.locator(".diary-entry-title")).toHaveValue("첫 일기");
  await expect(reopened.locator(".diary-text")).toHaveValue("줄 하나\n줄 둘");
  await expect(reopened.locator(".diary-sticker img")).toHaveCount(1);
  await expect.poll(() => reopened.locator(".diary-sticker img").evaluate(img => img.naturalWidth)).toBe(120);
});

test("저장 버튼은 ZIP 바이트 그대로 쓰고, 그 파일을 열면 같은 일기장이다", async ({ page }) => {
  await boot(page);
  // 저장 위치 대화상자 대신 쓴 내용을 붙잡는 가짜 파일 핸들(헤드리스 크롬에선 진짜 창이 뜨지 않는다).
  await page.evaluate(() => {
    window.__written = null;
    window.showSaveFilePicker = async (options) => ({
      name:options.suggestedName, kind:"file",
      async getFile(){ return window.__written; },
      async createWritable(){
        const chunks = [];
        return { async write(value){ chunks.push(value); }, async close(){ window.__written = new File(chunks, options.suggestedName); } };
      }
    });
  });
  await page.locator(".diary-text").fill("저장 확인");
  await page.locator(".diary-bar .run-save").click();
  await expect(page.locator(".diary-status")).toHaveText("");
  const head = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__written.arrayBuffer());
    return [...bytes.slice(0, 4)].map(b => b.toString(16).padStart(2, "0")).join("");
  });
  expect(head).toBe("504b0304");                                   // ZIP 서명 — 글자로 바뀌지 않았다
  await page.evaluate(async () => {
    await handleFiles([new File([await window.__written.arrayBuffer()], "받은.diary", { type:"application/zip" })], {});
  });
  await expect(page.locator(".office:not([hidden]) .diary-text")).toHaveValue("저장 확인");
});

test("파일 암호를 설정하면 글·사진이 봉인되고 틀린 암호로는 다시 열리지 않는다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__written = null;
    window.showSaveFilePicker = async (options) => ({
      name:options.suggestedName, kind:"file",
      async getFile(){ return window.__written; },
      async createWritable(){
        const chunks = [];
        return { async write(value){ chunks.push(value); }, async close(){ window.__written = new File(chunks, options.suggestedName); } };
      }
    });
  });
  await page.locator(".diary-entry-title").fill("잠긴 날");
  await page.locator(".diary-text").fill("암호 안의 일기 본문");
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({
    name:"비밀사진.png", mimeType:"image/png", buffer:solidPng(80, 50, [80, 30, 170])
  });

  await page.locator(".diary-bar .diary-btn", { hasText:"암호" }).click();
  await page.locator(".text-context-menu button", { hasText:"암호 설정" }).click();
  const setModal = page.locator(".exam-pass-modal");
  await expect(setModal).toBeVisible();
  await setModal.locator('input[type="password"]').nth(0).fill("diary-password-2026");
  await setModal.locator('input[type="password"]').nth(1).fill("diary-password-2026");
  await setModal.locator("button", { hasText:"암호 설정" }).click();
  await expect(page.locator(".diary-bar .diary-btn", { hasText:"암호" })).toHaveClass(/is-on/, { timeout:15_000 });
  await expect(page.locator(".diary-status")).toHaveText("", { timeout:15_000 });

  const sealed = await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__written.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    return { magic:new TextDecoder().decode(bytes.slice(0, 8)), hasText:text.includes("암호 안의 일기 본문") };
  });
  expect(sealed).toEqual({ magic:"CDDYENC1", hasText:false });

  await page.evaluate(async () => {
    await handleFiles([new File([await window.__written.arrayBuffer()], "다시 연 비밀.diary", { type:"application/octet-stream" })], {});
  });
  let openModal = page.locator(".exam-pass-modal");
  await expect(openModal).toBeVisible();
  await openModal.locator('input[type="password"]').fill("wrong-password");
  await openModal.locator("button", { hasText:"열기" }).click();
  await expect(page.locator(".exam-pass-modal")).toBeVisible({ timeout:15_000 });
  openModal = page.locator(".exam-pass-modal");
  await openModal.locator('input[type="password"]').fill("diary-password-2026");
  await openModal.locator("button", { hasText:"열기" }).click();
  const reopened = page.locator(".office:not([hidden]) .diary-doc");
  await expect(reopened.locator(".diary-text")).toHaveValue("암호 안의 일기 본문", { timeout:15_000 });
  await expect(reopened.locator(".diary-sticker img")).toHaveCount(1);
});
test("복구본 설정이 켜져 있으면 새로고침해도 쓰던 글·스티커가 돌아온다", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko");
      if (!sessionStorage.getItem("diary-once")){
        sessionStorage.setItem("diary-once", "1");
        localStorage.setItem("classDockSettings", JSON.stringify({ pdfRecovery:true }));
      }
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => newDiaryScratch());
  // 복구본을 실제로 남긴 뒤에 새로고침한다(고정 대기 대신 저장 완료를 센다).
  await page.evaluate(() => {
    window.__diaryRecovered = 0;
    const original = saveDocumentRecoverySnapshot;
    window.saveDocumentRecoverySnapshot = async (...args) => { const ok = await original(...args); if (ok) window.__diaryRecovered++; return ok; };
  });
  await page.locator(".diary-text").click();
  await page.keyboard.type("새로고침해도 남아요");
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"a.png", mimeType:"image/png", buffer:solidPng(50, 50, [200, 0, 0]) });
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__diaryRecovered), { timeout:10_000 }).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.locator("#docTabs .tab", { hasText:"일기장" }).first().click();
  await expect(page.locator(".office:not([hidden]) .diary-text")).toHaveValue("새로고침해도 남아요", { timeout:15_000 });
  await expect(page.locator(".office:not([hidden]) .diary-sticker")).toHaveCount(1);
});

/* ---------- 2단계 ---------- */

test("날씨·기분을 고르면 머리줄과 달력에 그림이 뜨고, 다시 누르면 지워진다", async ({ page }) => {
  await boot(page);
  const cell = page.locator(`.diary-cal-day[data-date="${todayKey()}"]`);
  const weather = page.locator('.diary-pick[data-pick="weather"]');
  await weather.click();
  const pop = page.locator(".diary-pick-pop");
  await expect(pop).toBeVisible();
  await pop.locator('.diary-pick-option[data-value="sunny"]').click();
  await expect(pop).toBeHidden();
  await expect(weather).toContainText("맑음");
  await expect(cell).toHaveClass(/has-emoji/);
  await expect(cell.locator(".diary-cal-emoji")).toHaveText("☀️");            // icons.js 가 지우지 않았다
  await expect(page.locator(".diary-month-item-label")).toHaveText("맑음");

  // 기분이 있으면 달력엔 기분이 먼저
  await page.locator('.diary-pick[data-pick="mood"]').click();
  await pop.locator('.diary-pick-option[data-value="happy"]').click();
  await expect(cell.locator(".diary-cal-emoji")).toHaveText("😊");

  // 고른 것을 다시 누르면 지워진다 · Esc 로 닫힌다
  await page.locator('.diary-pick[data-pick="mood"]').click();
  await pop.locator('.diary-pick-option[data-value="happy"]').click();
  await expect(cell.locator(".diary-cal-emoji")).toHaveText("☀️");
  await weather.click();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await page.locator(".diary-bar .diary-btn").first().click();          // 되돌리기 단추 — 기분 지운 것을 되살린다
  await expect(cell.locator(".diary-cal-emoji")).toHaveText("😊");
});

test("스티커를 손잡이·키로 돌리고, 우클릭 메뉴로 뒤집고 순서를 바꾼다", async ({ page }) => {
  await boot(page);
  const input = page.locator(".diary-bar input[type=file]").first();
  await input.setInputFiles({ name:"a.png", mimeType:"image/png", buffer:solidPng(160, 80, [220, 60, 60]) });
  const stickers = page.locator(".diary-sticker");
  await expect(stickers).toHaveCount(1);
  const first = stickers.first();
  const firstId = await first.getAttribute("data-id");
  // 둘째 사진이 같은 자리에 붙어 첫째를 덮지 않게 먼저 왼쪽으로 비켜 둔다.
  const a0 = await stableBox(first);
  await page.mouse.move(a0.x + a0.width / 2, a0.y + a0.height / 2);
  await page.mouse.down();
  await page.mouse.move(a0.x + a0.width / 2 - 220, a0.y + a0.height / 2 + 120, { steps:6 });
  await page.mouse.up();
  await input.setInputFiles({ name:"b.png", mimeType:"image/png", buffer:solidPng(120, 120, [60, 60, 220]) });
  await expect(stickers).toHaveCount(2);

  // 위쪽 돌리기 손잡이를 오른쪽으로 끌면 시계 방향으로 돈다
  await first.click({ position:{ x:10, y:10 } });
  const rotor = first.locator(".diary-sticker-rotate");
  const rb = await stableBox(rotor), sb = await stableBox(first);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width + 80, sb.y + sb.height / 2, { steps:8 });
  await page.mouse.up();
  const turned = await page.evaluate((id) => docs.find(d => d.kind === "diary").diary.entries[0].stickers.find(s => s.id === id).rot, firstId);
  expect(turned).toBeGreaterThan(45);
  await expect(first).toHaveAttribute("style", /rotate\(/);

  // ] 키는 5° 씩
  await page.keyboard.press("BracketRight");
  const after = await page.evaluate((id) => docs.find(d => d.kind === "diary").diary.entries[0].stickers.find(s => s.id === id).rot, firstId);
  expect(Math.round(after - turned)).toBe(5);

  // 우클릭 → 좌우 뒤집기
  await first.click({ button:"right" });
  const menu = page.locator(".text-context-menu");
  await expect(menu).toBeVisible();
  await menu.locator("button", { hasText:"좌우 뒤집기" }).click();
  await expect(first.locator("img")).toHaveAttribute("style", /scaleX\(-1\)/);

  // 맨 앞으로(Ctrl+Shift+]) → 쌓는 순서의 맨 끝
  await first.click({ position:{ x:10, y:10 } });
  await page.keyboard.press("Control+Shift+BracketRight");
  await expect(stickers.last()).toHaveAttribute("data-id", firstId);
  await stickers.last().click({ button:"right" });
  await menu.locator("button", { hasText:"맨 뒤로" }).click();
  await expect(stickers.first()).toHaveAttribute("data-id", firstId);
});

test("그림일기: 위에 그림 칸, 아래는 원고지 — 사진 넣기는 칸에 꼭 맞는다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  await page.locator('.diary-line-chip[data-lines="picture"]').click();
  await page.keyboard.press("Escape");
  const box = page.locator(".diary-picture-box");
  await expect(box).toBeVisible();
  await expect(page.locator(".diary-paper")).toHaveClass(/is-genko/);
  const bb = await stableBox(box);
  // 원고지 첫 줄은 그림 칸 아래, 좌우 끝은 그림 칸과 같은 선
  const firstRow = await stableBox(page.locator(".diary-genko-row").first());
  expect(firstRow.y).toBeGreaterThan(bb.y + bb.height);
  expect(Math.abs(firstRow.x - bb.x)).toBeLessThan(1.5);
  expect(Math.abs(firstRow.width - bb.width)).toBeLessThan(1.5);
  // 원고지 칸을 눌러 쓰면 한 칸에 한 글자
  await page.locator(".diary-genko").click({ position:{ x:firstRow.x - (await stableBox(page.locator(".diary-genko"))).x + 5, y:firstRow.y - (await stableBox(page.locator(".diary-genko"))).y + 10 } });
  await page.keyboard.type("그림일기");
  await expect(page.locator(".diary-genko-ch")).toHaveText(["그", "림", "일", "기"]);
  // 쓰는 동안 화면이 굴러갈 수 있어 층 안 자리(offsetTop)로 비교한다 — 첫 글자는 원고지 첫 줄에
  const tops = await page.evaluate(() => ({ row:document.querySelector(".diary-genko-row").offsetTop, ch:document.querySelector(".diary-genko-ch").offsetTop }));
  expect(tops.ch).toBe(tops.row);

  await box.locator("input[type=file]").setInputFiles({ name:"그림.png", mimeType:"image/png", buffer:bandPng(300, 100, [250, 200, 80], [80, 180, 240]) });
  const sticker = page.locator(".diary-sticker");
  await expect(sticker).toHaveCount(1);
  await box.scrollIntoViewIfNeeded();
  const sb = await stableBox(sticker), bx = await stableBox(box);      // 쓰는 동안 굴러갔으니 칸도 다시 잰다
  // 가로로 긴 그림 → 칸 폭에 맞고(여백 6px) 칸 안에 들어온다
  expect(Math.abs(sb.width - (bx.width - 12))).toBeLessThan(3);
  expect(sb.y).toBeGreaterThanOrEqual(bx.y - 1);
  expect(sb.y + sb.height).toBeLessThanOrEqual(bx.y + bx.height + 1);
  await expect(page.locator(".diary-picture-hint")).toBeHidden();
});

test("글꼴을 바꾸면 본문 글꼴이 바뀐다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  await page.locator('.diary-font-chip[data-font="myeongjo"]').click();
  expect(await page.locator(".diary-text").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Batang");
  await expect(page.locator(".diary-paper")).toHaveAttribute("data-font", "myeongjo");
  await page.locator('.diary-font-chip[data-font="gothic"]').click();
  expect(await page.locator(".diary-text").evaluate(el => getComputedStyle(el).fontFamily)).not.toContain("Batang");
});

/* ---------- 3단계 ---------- */

async function chooseLines(page, id, onlyThisDay){
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  if (onlyThisDay) await page.locator(".diary-style-scope input").check();
  await page.locator(`.diary-line-chip[data-lines="${id}"]`).click();
  await page.keyboard.press("Escape");
}

test("원고지: 글자마다 한 칸, 영문·숫자는 두 자씩, 누른 칸 앞에 끼워 쓴다", async ({ page }) => {
  await boot(page);
  await chooseLines(page, "genko");
  const paper = page.locator(".diary-paper");
  await expect(paper).toHaveClass(/is-genko/);
  const layer = page.locator(".diary-genko");
  await expect(layer).toBeVisible();
  await layer.click({ position:{ x:60, y:40 } });
  await page.keyboard.type("가나다 abc1");
  const chars = page.locator(".diary-genko-ch");
  await expect(chars).toHaveText(["가", "나", "다", "ab", "c1"]);
  await expect(page.locator(".diary-genko-caret")).toHaveClass(/is-on/);

  // 같은 줄·칸 폭으로 놓였는지(빈칸 한 칸을 건너뛰었는지)
  const boxes = await chars.evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width) }; }));
  const w = boxes[0].w;
  expect(new Set(boxes.map(b => b.y)).size).toBe(1);
  expect(boxes.map(b => Math.round((b.x - boxes[0].x) / w))).toEqual([0, 1, 2, 4, 5]);

  // 둘째 칸('나')의 왼쪽 절반을 누르고 쓰면 그 앞에 들어간다
  const second = await stableBox(chars.nth(1));          // 칸은 선택이 바뀔 때마다 다시 그려진다 — 자리가 잡힐 때까지
  await page.mouse.click(second.x + second.width * 0.25, second.y + second.height / 2);
  await page.keyboard.type("X");
  await expect(page.locator(".diary-text")).toHaveValue("가X나다 abc1");

  // Enter 는 다음 줄 첫 칸
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("라");
  const last = await stableBox(chars.last());
  expect(last.y).toBeGreaterThan(boxes[0].y + w);
  expect(Math.abs(last.x - boxes[0].x)).toBeLessThan(2);

  // 끌어서 고르면 고른 칸이 칠해진다
  const a = await stableBox(chars.nth(0)), b = await stableBox(chars.nth(2));
  await page.mouse.move(a.x + 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps:4 });
  await page.mouse.up();
  await expect(page.locator(".diary-genko-ch.is-sel")).toHaveCount(3);
});

test("인쇄: 이번 달 일기만 모아 한 날씩 쪽을 나누고, 줄·스티커까지 찍는다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").fill("오늘 일기");
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"a.png", mimeType:"image/png", buffer:solidPng(60, 60, [200, 40, 40]) });
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await page.locator(".diary-day-nav").first().click();
  await chooseLines(page, "genko", true);                         // 전날만 원고지 — 오늘은 줄 공책 그대로
  await page.locator(".diary-genko").click({ position:{ x:60, y:40 } });
  await page.keyboard.type("어제");
  // window.print 는 막고, 찍는 순간의 인쇄 층을 들여다본다.
  await page.evaluate(() => {
    window.__printed = null;
    window.print = () => {
      const layer = document.getElementById("diaryPrintLayer");
      window.__printed = {
        printing:document.body.classList.contains("diary-printing"),
        pages:layer.querySelectorAll(".diary-print-page").length,
        texts:[...layer.querySelectorAll(".diary-print-text")].map(el => el.textContent),
        genko:[...layer.querySelectorAll(".diary-genko-ch")].map(el => el.textContent),
        stickers:[...layer.querySelectorAll(".diary-print-sticker img")].map(img => img.complete && img.naturalWidth),
        lines:getComputedStyle(layer.querySelector(".diary-print-text")).backgroundImage,
        dates:[...layer.querySelectorAll(".diary-print-date")].map(el => el.textContent),
        // 전역 header{color:#fff} 를 물려받으면 흰 종이에 흰 글자로 찍힌다
        dateColor:getComputedStyle(layer.querySelector(".diary-print-date")).color
      };
    };
  });
  await page.locator(".diary-bar .diary-btn", { hasText:"인쇄" }).click();
  const menu = page.locator(".text-context-menu");
  await expect(menu).toBeVisible();
  await menu.locator("button", { hasText:"이번 달 인쇄" }).click();
  await expect.poll(() => page.evaluate(() => window.__printed)).not.toBeNull();
  const printed = await page.evaluate(() => window.__printed);
  const today = new Date();
  const sameMonth = today.getDate() > 1;                            // 1일이면 전날은 지난달이다
  expect(printed.printing).toBe(true);
  expect(printed.pages).toBe(sameMonth ? 2 : 1);
  expect(printed.texts).toContain("오늘 일기");
  if (sameMonth) expect(printed.genko).toEqual(["어", "제"]);
  expect(printed.stickers).toEqual([60]);
  expect(printed.lines).toContain("linear-gradient");
  expect(printed.dates.length).toBe(printed.pages);
  expect(printed.dates.join("|")).toMatch(/년 \d+월 \d+일/);
  expect(printed.dateColor).not.toBe("rgb(255, 255, 255)");
  await expect(page.locator("#diaryPrintLayer")).toHaveCount(0);   // 찍고 나면 치운다
  await expect(page.locator("body")).not.toHaveClass(/diary-printing/);

  // 위쪽 머리글의 인쇄 단추도 같은 고르기 메뉴를 연다
  await page.locator("#btnPrint").click();
  await expect(menu).toBeVisible();
  await expect(menu.locator("button", { hasText:"일기장 전체 인쇄" })).toBeEnabled();
});

test("영어 화면: 단추·날짜·달력·날씨가 영어로 나오고, 한국어로 되돌리면 다시 한국어", async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "en"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newDiaryScratch());
  await expect(page.locator(".diary-paper")).toBeVisible();

  const now = new Date();
  const longDate = now.toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  await expect(page.locator(".diary-date")).toHaveText(longDate);
  await expect(page.locator(".diary-date")).toHaveAttribute("data-today", "Today");
  await expect(page.locator(".diary-cal-month")).toHaveText(now.toLocaleDateString("en-US", { year:"numeric", month:"long" }));
  await expect(page.locator(".diary-cal-wd").first()).toHaveText("Su");
  await expect(page.locator(".diary-bar")).toContainText("Add photo");
  await expect(page.locator(".diary-bar")).toContainText("Decorate");
  await expect(page.locator(".diary-bar")).toContainText("Print");
  await expect(page.locator(".diary-text")).toHaveAttribute("placeholder", "How was your day?");
  await expect(page.locator(".diary-month-list-head")).toHaveText("No entries this month yet");

  await page.locator('.diary-pick[data-pick="weather"]').click();
  await page.locator('.diary-pick-option[data-value="rainy"]').click();
  await expect(page.locator('.diary-pick[data-pick="weather"]')).toContainText("Rainy");
  await expect(page.locator(".diary-month-list-head")).toHaveText("1 entry this month");

  await page.locator(".diary-bar .diary-btn", { hasText:"Decorate" }).click();
  await expect(page.locator(".diary-style-panel")).toContainText("Apply to this day only");
  await expect(page.locator('.diary-line-chip[data-lines="genko"]')).toContainText("Manuscript");
  await page.keyboard.press("Escape");

  // 한국어로 되돌리기 — 고정 단추(translateTree)와 그때그때 그린 글자 모두
  await page.evaluate(() => MNI18N.setLang("ko"));
  await expect(page.locator(".diary-bar")).toContainText("사진 붙이기");
  await expect(page.locator(".diary-date")).toHaveText(new RegExp("^" + now.getFullYear() + "년"));
  await expect(page.locator('.diary-pick[data-pick="weather"]')).toContainText("비");
  await expect(page.locator(".diary-month-list-head")).toHaveText("이번 달 일기 1편");
});

test("그림 칸에 펜으로 그리고, 지우개·전체 지우기·되돌리기가 되며, 인쇄에도 나온다", async ({ page }) => {
  await boot(page);
  await chooseLines(page, "picture");
  const layer = page.locator(".diary-draw-layer");
  await expect(layer).toBeVisible();
  await page.locator(".diary-draw-toggle").click();
  const bar = page.locator(".diary-draw-bar");
  await expect(bar).toBeVisible();
  await expect(page.locator(".diary-paper")).toHaveClass(/is-drawing/);
  await bar.locator('.diary-pen[data-color="#ef4444"]').click();
  await bar.locator('.diary-pen-size[data-size="thick"]').click();

  const lb = await stableBox(layer);
  const y = lb.y + lb.height / 2;
  await page.mouse.move(lb.x + lb.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.8, y, { steps:12 });
  await page.mouse.up();

  const strokes = () => page.evaluate(() => (docs.find(d => d.kind === "diary").diary.entries[0] || {}).drawing || []);
  // 그림 칸 한가운데 픽셀의 불투명도(0~255)
  const alphaAt = (fx) => page.evaluate((f) => {
    const c = document.querySelector(".diary-draw-canvas");
    const ctx = c.getContext("2d");
    return ctx.getImageData(Math.round(c.width * f), Math.round(c.height / 2), 1, 1).data[3];
  }, fx);
  await expect.poll(async () => (await strokes()).length).toBe(1);
  const first = (await strokes())[0];
  expect(first.c).toBe("#ef4444");
  expect(first.w).toBe(0.024);
  expect(first.p.length).toBeGreaterThan(4);
  expect(await alphaAt(0.5)).toBeGreaterThan(200);
  await expect(page.locator(`.diary-cal-day[data-date="${todayKey()}"]`)).toHaveClass(/has-entry/);   // 그림만 그린 날도 일기

  // 지우개로 가운데를 문지르면 그 자리만 지워진다
  await bar.locator(".diary-draw-tool").first().click();
  await page.mouse.move(lb.x + lb.width * 0.45, y - 20);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.55, y + 20, { steps:6 });
  await page.mouse.up();
  await expect.poll(async () => (await strokes()).length).toBe(2);
  expect((await strokes())[1].e).toBe(true);
  expect(await alphaAt(0.5)).toBe(0);
  expect(await alphaAt(0.3)).toBeGreaterThan(200);

  // 전체 지우기 → Ctrl+Z 로 되살리기
  await bar.locator(".diary-draw-tool").nth(1).click();
  await expect.poll(async () => (await strokes()).length).toBe(0);
  expect(await alphaAt(0.3)).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await strokes()).length).toBe(2);
  await expect.poll(() => alphaAt(0.3)).toBeGreaterThan(200);

  // Esc 로 그리기를 끝낸다 — 도구막대가 들어가고, 그림이 있으니 안내 글도 감춘다
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.locator(".diary-draw-toggle")).toBeVisible();
  await expect(page.locator(".diary-picture-hint")).toBeHidden();

  // 인쇄에도 그림이 한 장으로 들어간다
  await page.evaluate(() => {
    window.__drawn = null;
    window.print = () => { const img = document.querySelector("#diaryPrintLayer .diary-print-drawing"); window.__drawn = img ? img.src.slice(0, 22) : "none"; };
  });
  await page.locator(".diary-bar .diary-btn", { hasText:"인쇄" }).click();
  await page.locator(".text-context-menu button", { hasText:"이 날 인쇄" }).click();
  await expect.poll(() => page.evaluate(() => window.__drawn)).toBe("data:image/png;base64,");
});

test("손글씨 글꼴을 고르면 그때 글꼴을 읽어 본문과 원고지 칸에 쓴다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").fill("오늘은 손글씨로 쓴다");
  // 고르기 전에는 글꼴 파일을 읽지 않는다(시작 비용 없음)
  expect(await page.evaluate(() => MNLazy.isLoaded("handPen"))).toBe(false);
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  await page.locator('.diary-font-chip[data-font="pen"]').click();
  await page.keyboard.press("Escape");

  await expect.poll(() => page.evaluate(() => document.fonts.check('20px "ClassDock Nanum Pen"', "가"))).toBe(true);
  const area = page.locator(".diary-text");
  expect(await area.evaluate(el => getComputedStyle(el).fontFamily)).toContain("ClassDock Nanum Pen");
  expect(await area.evaluate(el => getComputedStyle(el).fontSize)).toBe("22px");        // 16px × 1.35
  expect(await area.evaluate(el => getComputedStyle(el).lineHeight)).toBe("34px");      // 줄 간격은 그대로
  // 실제로 다른 글꼴로 그려지는지 — 같은 글을 고딕과 손글씨로 쟀을 때 폭이 다르다
  const widths = await page.evaluate(() => {
    const c = document.createElement("canvas").getContext("2d");
    c.font = '22px "ClassDock Nanum Pen"'; const hand = c.measureText("오늘은 손글씨로 쓴다").width;
    c.font = "22px sans-serif"; const plain = c.measureText("오늘은 손글씨로 쓴다").width;
    return { hand, plain };
  });
  expect(Math.abs(widths.hand - widths.plain)).toBeGreaterThan(5);

  // 원고지 칸 글자도 같은 글꼴
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  await page.locator('.diary-line-chip[data-lines="genko"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".diary-genko-ch").first()).toHaveText("오");
  expect(await page.locator(".diary-genko").evaluate(el => getComputedStyle(el).fontFamily)).toContain("ClassDock Nanum Pen");

  // 저장했다 열어도 글꼴이 남는다
  const font = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "diary");
    const { model } = await diaryUnpack(diaryPack(doc.diary, doc.diaryAssets));
    return [model.version === DIARY_VERSION, model.style.font];
  });
  expect(font).toEqual([true, "pen"]);
});

test("스티커 여러 장: Shift+클릭·Ctrl+끌기·Ctrl+A 로 고르고, 함께 옮기고 돌리고 떼며, 되돌리기는 한 번에", async ({ page }) => {
  await boot(page);
  const paper = page.locator(".diary-paper");
  const pb = await stableBox(paper);
  // 세 장을 서로 떨어진 자리에 떨어뜨린다
  const b64 = solidPng(60, 60, [40, 140, 90]).toString("base64");
  for (const [fx, fy] of [[0.2, 200], [0.5, 200], [0.8, 420]]){
    await page.evaluate(async ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "s" + x + ".png", { type:"image/png" }));
      const target = document.querySelector(".diary-text");
      for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles:true, cancelable:true, dataTransfer:dt, clientX:x, clientY:y }));
    }, { b64, x:pb.x + pb.width * fx, y:pb.y + fy });
  }
  const stickers = page.locator(".diary-sticker");
  await expect(stickers).toHaveCount(3);
  const model = () => page.evaluate(() => docs.find(d => d.kind === "diary").diary.entries[0].stickers.map(s => ({ id:s.id, x:s.x, y:s.y, rot:s.rot || 0 })));
  const ids = (await model()).map(s => s.id);

  // 첫째를 누르고 Shift+클릭으로 둘째를 더한다 → 둘 다 고름, 손잡이는 감춘다
  await stickers.nth(0).click();
  await stickers.nth(1).click({ modifiers:["Shift"] });
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(2);
  await expect(page.locator(".diary-stickers")).toHaveClass(/is-multi/);
  await expect(stickers.nth(1).locator(".diary-sticker-handle")).toBeHidden();
  await expect(page.locator(".diary-status")).toContainText("사진 2장을 골랐어요");

  // 고른 것 하나를 끌면 둘이 함께, 셋째는 그대로
  const before = await model();
  const s1 = await stableBox(stickers.nth(1));
  await page.mouse.move(s1.x + s1.width / 2, s1.y + s1.height / 2);
  await page.mouse.down();
  await page.mouse.move(s1.x + s1.width / 2 + 40, s1.y + s1.height / 2 + 30, { steps:5 });
  await page.mouse.up();
  const after = await model();
  const w = pb.width;
  for (const i of [0, 1]){
    expect(Math.round((after[i].x - before[i].x) * w)).toBe(40);
    expect(Math.round((after[i].y - before[i].y) * w)).toBe(30);
  }
  expect(after[2]).toEqual(before[2]);
  // 되돌리기 한 번에 둘 다 제자리
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await model()).map(s => [s.x, s.y])).toEqual(before.map(s => [s.x, s.y]));

  // Shift+클릭으로 다시 빼기
  await stickers.nth(1).click({ modifiers:["Shift"] });
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(1);

  // Ctrl+끌기로 네모를 그려 셋 모두
  await page.mouse.move(pb.x + 10, pb.y + 100);
  await page.keyboard.down("Control");
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width - 10, pb.y + 500, { steps:6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(3);
  await expect(page.locator(".diary-marquee")).toBeHidden();
  expect(await page.locator(".diary-text").evaluate(el => el.selectionStart === el.selectionEnd)).toBe(true);   // 글은 고르지 않았다

  // 방향키·돌리기가 셋 모두에
  const b2 = await model();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("BracketRight");
  const a2 = await model();
  for (let i = 0; i < 3; i++){
    expect(Math.round((a2[i].x - b2[i].x) * w)).toBe(2);
    expect(a2[i].rot - b2[i].rot).toBe(5);
  }

  // 무리 안 하나를 끌지 않고 누르면 그 한 장만 고른다 → 맨 뒤로(Ctrl+Shift+[) 보내면 쌓는 순서 맨 앞 칸으로
  await stickers.nth(2).click();
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+BracketLeft");
  await expect.poll(async () => (await model()).map(s => s.id)).toEqual([ids[2], ids[0], ids[1]]);

  // Ctrl+A → 모두, 우클릭 → "사진 3장 떼기", 되돌리기로 한 번에 되살리기
  await page.keyboard.press("Control+a");
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(3);
  await stickers.nth(0).click({ button:"right" });
  const menu = page.locator(".text-context-menu");
  await menu.locator("button", { hasText:"사진 3장 떼기" }).click();
  await expect(stickers).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(stickers).toHaveCount(3);
});

test("원고지 칸 수: 원고지·그림일기일 때만 고를 수 있고, 10칸을 고르면 한 줄에 10자씩", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-btn", { hasText:"꾸미기" }).click();
  const panel = page.locator(".diary-style-panel");
  const colsRow = panel.locator(".diary-cols-chip").first().locator("xpath=../..");
  await expect(colsRow).toBeHidden();                               // 줄 공책에선 감춘다
  await panel.locator('.diary-line-chip[data-lines="genko"]').click();
  await expect(colsRow).toBeVisible();
  await expect(panel.locator('.diary-cols-chip[data-cols="0"]')).toHaveClass(/is-on/);
  await panel.locator('.diary-cols-chip[data-cols="10"]').click();
  await expect(panel.locator('.diary-cols-chip[data-cols="10"]')).toHaveText("10칸");
  await page.keyboard.press("Escape");

  const row = page.locator(".diary-genko-row").first();
  const layer = page.locator(".diary-genko");
  const rb = await stableBox(row), lb = await stableBox(layer);
  await layer.click({ position:{ x:rb.x - lb.x + 5, y:rb.y - lb.y + 10 } });
  await page.keyboard.type("가나다라마바사아자차카");                // 11자 → 둘째 줄 첫 칸으로
  const pos = await page.evaluate(() => [...document.querySelectorAll(".diary-genko-ch")].map(el => [el.offsetTop, el.offsetLeft, el.offsetWidth]));
  expect(new Set(pos.slice(0, 10).map(p => p[0])).size).toBe(1);
  expect(pos[10][0]).toBeGreaterThan(pos[0][0]);
  expect(pos[10][1]).toBe(pos[0][1]);
  const cell = pos[0][2];
  expect(Math.round(rb.width)).toBe(cell * 10 + 1);                 // 줄 폭 = 10칸
  expect(cell).toBeGreaterThan(60);                                 // 폭 780 기준 칸이 커졌다(자동은 34)

  // 저장했다 열어도 남는다
  const saved = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "diary");
    const { model } = await diaryUnpack(diaryPack(doc.diary, doc.diaryAssets));
    return [model.version === DIARY_VERSION, model.style.genkoCols];
  });
  expect(saved).toEqual([true, 10]);
});
