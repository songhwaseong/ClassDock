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
  await expect(page.locator(".diary-today-badge")).toHaveText("오늘");
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
  await page.locator(".diary-bar .diary-style-btn").click();
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
  await page.locator(".diary-bar .diary-style-btn").click();
  const bg = bandPng(64, 64, [250, 200, 0], [0, 160, 90]);
  await page.locator(".diary-bar input[type=file]").nth(1).setInputFiles({ name:"배경.png", mimeType:"image/png", buffer:bg });
  await expect(page.locator(".diary-paper-bg")).toBeVisible();
  await expect(panel.locator(".diary-veil-range")).toBeEnabled();
});

test("꾸미기: 배경 효과는 사진 없이 종이를 칠하고, 색·진하기를 따라 다시 그린다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").fill("오늘은 배경 효과를 골라 보았다.");
  const paper = page.locator(".diary-paper");
  const art = page.locator(".diary-paper-art");
  await page.locator(".diary-bar .diary-style-btn").click();
  const panel = page.locator(".diary-style-panel");
  await expect(paper).toHaveAttribute("data-paper", "none");
  await expect(panel.locator(".diary-paper-tone")).toBeDisabled();          // 효과가 없으면 색·진하기는 잠긴다

  await panel.locator('.diary-paper-chip[data-paper="mesh"]').click();
  await expect(paper).toHaveAttribute("data-paper", "mesh");
  await expect(panel.locator(".diary-paper-tone")).toBeEnabled();
  const meshed = await art.evaluate(el => getComputedStyle(el).backgroundImage);
  expect(meshed).toContain("radial-gradient");

  // 색을 바꾸면 종이도 칩 견본도 다시 그린다(칩은 지금 고른 색으로 보여야 한다)
  const chipBefore = await panel.locator('.diary-paper-chip[data-paper="linear"] .diary-paper-sample')
    .evaluate(el => getComputedStyle(el).backgroundImage);
  await panel.locator(".diary-paper-color").evaluate(el => { el.value = "#ff0000"; el.dispatchEvent(new Event("change", { bubbles:true })); });
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe(meshed);
  await expect.poll(() => panel.locator('.diary-paper-chip[data-paper="linear"] .diary-paper-sample')
    .evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe(chipBefore);

  // 진하기를 낮추면 더 옅게(섞는 비율이 달라진다)
  const strong = await art.evaluate(el => getComputedStyle(el).backgroundImage);
  await panel.locator(".diary-paper-tone").fill("10");
  await panel.locator(".diary-paper-tone").dispatchEvent("input");
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe(strong);

  // 어두운 효과(오로라)는 종이색을 밤하늘로 바꾸면서 글자색까지 밝은 쪽으로 갈아끼운다
  await panel.locator('.diary-paper-chip[data-paper="aurora"]').click();
  await expect(paper).toHaveAttribute("data-paper", "aurora");
  const ink = await page.locator(".diary-text").evaluate(el => getComputedStyle(el).color);
  const bright = ink.match(/\d+/g).slice(0, 3).map(Number).every(v => v > 180);
  expect(bright, "오로라에서 글자는 밝아야 한다: " + ink).toBe(true);
  const sheet = await paper.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(sheet.match(/\d+/g).slice(0, 3).map(Number).every(v => v < 80)).toBe(true);

  // 인쇄 층에도 같은 함수로 깔린다 — 어두운 효과면 인쇄 글자도 밝은 쪽으로 나간다
  await page.evaluate(() => {
    window.__printedPaper = null;
    window.print = () => {
      const el = document.querySelector("#diaryPrintLayer .diary-print-paper");
      const art = el && el.querySelector(".diary-paper-art");
      const text = el && el.querySelector(".diary-print-text");
      window.__printedPaper = el
        ? { paper:el.dataset.paper, art:art ? art.style.backgroundImage : "", ink:text ? getComputedStyle(text).color : "" }
        : null;
    };
  });
  await page.keyboard.press("Escape");
  await page.locator("#btnPrint").click();
  await page.locator(".text-context-menu button", { hasText:"이 날 인쇄" }).click();
  const printed = await page.evaluate(() => window.__printedPaper);
  expect(printed.paper).toBe("aurora");
  expect(printed.art).toContain("radial-gradient");
  expect(printed.ink.match(/\d+/g).slice(0, 3).map(Number).every(v => v > 180)).toBe(true);
  await page.locator(".diary-bar .diary-style-btn").click();

  // 목록 카드 썸네일에도 그 날 종이 배경이 깔린다
  const thumb = page.locator(".diary-entry-card-thumb").first();
  await expect(thumb).toHaveAttribute("data-paper", "aurora");
  expect(await thumb.evaluate(el => getComputedStyle(el).backgroundImage)).toContain("radial-gradient");

  // '인쇄할 땐 배경 빼기' — 효과도 사진도 깔지 않는다(잉크 아끼기)
  await panel.locator(".diary-print-plain input").check();
  await page.keyboard.press("Escape");
  await page.locator("#btnPrint").click();
  await page.locator(".text-context-menu button", { hasText:"이 날 인쇄" }).click();
  const plain = await page.evaluate(() => window.__printedPaper);
  expect(plain.paper || "").toBe("");
  expect(plain.art || "").toBe("");
  await page.locator(".diary-bar .diary-style-btn").click();
  await panel.locator(".diary-print-plain input").uncheck();

  // 거친 질감은 그림 파일 대신 그려 넣은 알갱이(SVG)를 타일로 깐다
  await panel.locator('.diary-paper-chip[data-paper="noise"]').click();
  expect(await art.evaluate(el => getComputedStyle(el).backgroundImage)).toContain("feTurbulence");

  // 효과를 끄면 종이만 남는다
  await panel.locator('.diary-paper-chip[data-paper="none"]').click();
  await expect(paper).toHaveAttribute("data-paper", "none");
  expect(await art.evaluate(el => getComputedStyle(el).backgroundImage)).toBe("none");
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

  await page.locator(".diary-bar .diary-btn[aria-haspopup=menu]").click();
  await page.locator(".text-context-menu button", { hasText:"암호 설정" }).click();
  const setModal = page.locator(".exam-pass-modal");
  await expect(setModal).toBeVisible();
  await setModal.locator('input[type="password"]').nth(0).fill("diary-password-2026");
  await setModal.locator('input[type="password"]').nth(1).fill("diary-password-2026");
  await setModal.locator("button", { hasText:"암호 설정" }).click();
  await expect(page.locator(".diary-bar .diary-btn[aria-haspopup=menu]")).toHaveClass(/is-on/, { timeout:15_000 });
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
  await expect(cell.locator(".diary-cal-emoji .diary-wx")).toBeVisible();       // 날씨·기분은 그린 그림(SVG)
  await expect(cell.locator(".diary-cal-emoji")).toHaveAttribute("data-mark", "sunny");
  await expect(page.locator(".diary-month-item-label")).toHaveText("맑음");

  // 기분이 있으면 달력엔 기분이 먼저
  await page.locator('.diary-pick[data-pick="mood"]').click();
  await pop.locator('.diary-pick-option[data-value="happy"]').click();
  await expect(cell.locator(".diary-cal-emoji")).toHaveAttribute("data-mark", "happy");

  // 고른 것을 다시 누르면 지워진다 · Esc 로 닫힌다
  await page.locator('.diary-pick[data-pick="mood"]').click();
  await pop.locator('.diary-pick-option[data-value="happy"]').click();
  await expect(cell.locator(".diary-cal-emoji")).toHaveAttribute("data-mark", "sunny");
  await weather.click();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await page.locator(".diary-bar .diary-undo-btn").click();             // 되돌리기 단추 — 기분 지운 것을 되살린다
  await expect(cell.locator(".diary-cal-emoji")).toHaveAttribute("data-mark", "happy");
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
  await page.locator(".diary-bar .diary-style-btn").click();
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
  // 사진이 들어오면 안내 문장만 감추고 가운데 단추는 남긴다 — 다시 그리기·사진 바꾸기로 들어가는 유일한 길이다
  const hint = page.locator(".diary-picture-hint");
  await expect(hint).toHaveClass(/is-compact/);
  await expect(hint.locator("> span")).toBeHidden();
  await expect(hint.locator(".diary-picture-hint-btns .diary-btn")).toHaveCount(2);
  // 칸을 채운 사진이 단추를 덮지 않는다 — 단추 자리를 눌렀을 때 맨 위에 있는 것이 그 단추여야 한다
  const drawBtn = page.locator(".diary-picture-draw");
  const covered = await drawBtn.evaluate(btn => {
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(top && btn.contains(top));
  });
  expect(covered).toBe(false);
  await drawBtn.click();
  await expect(page.locator(".diary-paper")).toHaveClass(/is-drawing/);
  await page.locator(".diary-draw-done").click();
  await expect(page.locator(".diary-paper")).not.toHaveClass(/is-drawing/);
  // 사진 우클릭 메뉴에서도 그리기로 들어간다
  await sticker.click({ button:"right" });
  await page.locator(".text-context-menu button", { hasText:"그림 칸에 그리기" }).click();
  await expect(page.locator(".diary-paper")).toHaveClass(/is-drawing/);
  await page.locator(".diary-draw-done").click();

  // 두 장을 더 넣으면 먼저 있던 한 장까지 셋이 칸을 나눠 쓴다(먼저 것이 칸을 덮은 채 남지 않는다)
  await box.locator("input[type=file]").setInputFiles([
    { name:"둘.png", mimeType:"image/png", buffer:solidPng(200, 200, [200, 90, 90]) },
    { name:"셋.png", mimeType:"image/png", buffer:solidPng(200, 200, [90, 200, 140]) }
  ]);
  await expect(page.locator(".diary-sticker")).toHaveCount(3);
  await expect(page.locator(".diary-status")).toContainText("3장");
  await box.scrollIntoViewIfNeeded();
  const bx2 = await stableBox(box);
  const shots = await page.evaluate(() => [...document.querySelectorAll(".diary-sticker")]
    .map(n => ({ x:n.offsetLeft, y:n.offsetTop, w:n.offsetWidth, h:n.offsetHeight })));
  for (let i = 0; i < shots.length; i++){
    const s = shots[i];
    expect(s.w).toBeLessThan(bx2.width);                                  // 한 장이 칸을 다 먹지 않는다
    for (let j = i + 1; j < shots.length; j++){
      const t = shots[j];
      expect(s.x < t.x + t.w - 1 && t.x < s.x + s.w - 1 && s.y < t.y + t.h - 1 && t.y < s.y + s.h - 1).toBe(false);
    }
  }
});

test("글꼴을 바꾸면 본문 글꼴이 바뀐다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-style-btn").click();
  await page.locator('.diary-font-chip[data-font="myeongjo"]').click();
  expect(await page.locator(".diary-text").evaluate(el => getComputedStyle(el).fontFamily)).toContain("Batang");
  await expect(page.locator(".diary-paper")).toHaveAttribute("data-font", "myeongjo");
  await page.locator('.diary-font-chip[data-font="gothic"]').click();
  expect(await page.locator(".diary-text").evaluate(el => getComputedStyle(el).fontFamily)).not.toContain("Batang");
});

/* ---------- 3단계 ---------- */

async function chooseLines(page, id, onlyThisDay){
  await page.locator(".diary-bar .diary-style-btn").click();
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
  await page.locator("#btnPrint").click();
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

  // 다시 눌러도 같은 고르기 메뉴가 열린다
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
  await expect(page.locator(".diary-today-badge")).toHaveText("Today");
  await expect(page.locator(".diary-cal-month")).toHaveText(now.toLocaleDateString("en-US", { year:"numeric", month:"long" }));
  await expect(page.locator(".diary-cal-wd").first()).toHaveText("Su");
  await expect(page.locator(".diary-bar .run-save-label")).toHaveText("Save");   // 단추는 그림만 — 감춘 글자 칸·설명만 영어로
  await expect(page.locator(".diary-bar .diary-style-btn")).not.toHaveAttribute("title", /[가-힣]/);
  await expect(page.locator(".diary-text")).toHaveAttribute("placeholder", "How was your day?");
  await expect(page.locator(".diary-month-list-head")).toHaveText("No entries this month yet");

  await page.locator('.diary-pick[data-pick="weather"]').click();
  await page.locator('.diary-pick-option[data-value="rainy"]').click();
  await expect(page.locator('.diary-pick[data-pick="weather"]')).toContainText("Rainy");
  await expect(page.locator(".diary-month-list-head")).toHaveText("1 entry this month");

  await page.locator(".diary-bar .diary-style-btn").click();
  await expect(page.locator(".diary-style-panel")).toContainText("Apply to this day only");
  await expect(page.locator('.diary-line-chip[data-lines="genko"]')).toContainText("Manuscript");
  await page.keyboard.press("Escape");

  // 한국어로 되돌리기 — 고정 단추(translateTree)와 그때그때 그린 글자 모두
  await page.evaluate(() => MNI18N.setLang("ko"));
  await expect(page.locator(".diary-bar .run-save-label")).toHaveText("저장");
  await expect(page.locator(".diary-date")).toHaveText(now.getFullYear() + ". " + (now.getMonth() + 1) + ". " + now.getDate());
  await expect(page.locator('.diary-pick[data-pick="weather"]')).toContainText("비");
  await expect(page.locator(".diary-month-list-head")).toHaveText("이번 달 일기 1편");
});

test("그림 칸에 펜으로 그리고, 지우개·전체 지우기·되돌리기가 되며, 인쇄에도 나온다", async ({ page }) => {
  await boot(page);
  await chooseLines(page, "picture");
  const layer = page.locator(".diary-draw-layer");
  await expect(layer).toBeVisible();
  await page.locator(".diary-picture-draw").click();
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

  // Esc 로 그리기를 끝낸다 — 도구막대가 들어가고, 그림이 있으니 안내 문장만 감춘다(단추는 남아 다시 그리러 들어간다)
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.locator(".diary-picture-draw")).toBeVisible();
  const hint = page.locator(".diary-picture-hint");
  await expect(hint).toHaveClass(/is-compact/);
  await expect(hint.locator("> span")).toBeHidden();

  // 인쇄에도 그림이 한 장으로 들어간다
  await page.evaluate(() => {
    window.__drawn = null;
    window.print = () => { const img = document.querySelector("#diaryPrintLayer .diary-print-drawing"); window.__drawn = img ? img.src.slice(0, 22) : "none"; };
  });
  await page.locator("#btnPrint").click();
  await page.locator(".text-context-menu button", { hasText:"이 날 인쇄" }).click();
  await expect.poll(() => page.evaluate(() => window.__drawn)).toBe("data:image/png;base64,");
});

test("손글씨 글꼴을 고르면 그때 글꼴을 읽어 본문과 원고지 칸에 쓴다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").fill("오늘은 손글씨로 쓴다");
  // 고르기 전에는 글꼴 파일을 읽지 않는다(시작 비용 없음)
  expect(await page.evaluate(() => MNLazy.isLoaded("handPen"))).toBe(false);
  await page.locator(".diary-bar .diary-style-btn").click();
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
  await page.locator(".diary-bar .diary-style-btn").click();
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

test("손글씨 줄: 창을 열면 견본만 읽고, 새 손글씨를 고르면 그 글꼴과 빈 글자를 이을 펜을 읽는다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").fill("오늘은 바른히피로 쓴다");
  await page.locator(".diary-bar .diary-style-btn").click();
  // 손글씨 일곱 벌은 "글꼴" 줄이 아니라 따로 한 줄에
  const handRow = page.locator(".diary-style-row", { has:page.locator('.diary-font-chip[data-font="hippie"]') });
  await expect(handRow.locator(".diary-font-chip")).toHaveCount(7);
  await expect(handRow.locator(".diary-style-label")).toHaveText("손글씨");
  await expect(handRow.locator('.diary-font-chip[data-font="gothic"]')).toHaveCount(0);
  // 창을 열면 "가나다" 견본만 — 손글씨 본 글꼴은 아직 안 읽는다
  await expect.poll(() => page.evaluate(() => document.fonts.check('20px "ClassDock Hand Sample mago"', "가"))).toBe(true);
  expect(await page.evaluate(() => ["handPen", "handHippie", "handMago"].map(b => MNLazy.isLoaded(b)))).toEqual([false, false, false]);

  await page.locator('.diary-font-chip[data-font="hippie"]').click();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.fonts.check('20px "ClassDock Hand Hippie"', "가"))).toBe(true);
  await expect.poll(() => page.evaluate(() => MNLazy.isLoaded("handPen"))).toBe(true);
  const area = page.locator(".diary-text");
  expect(await area.evaluate(el => getComputedStyle(el).fontFamily)).toContain("ClassDock Hand Hippie");
  expect(await area.evaluate(el => getComputedStyle(el).fontSize)).toBe("20px");        // 16px × 1.25
  // 담지 않은 드문 글자는 이 글꼴에 없다(펜이 잇는다)
  expect(await page.evaluate(async () => {
    const [face] = [...document.fonts].filter(f => f.family.replace(/"/g, "") === "ClassDock Hand Hippie");
    const c = document.createElement("canvas").getContext("2d");
    c.font = '40px "ClassDock Hand Hippie", "ClassDock Nanum Pen"'; const a = c.measureText("똠").width;
    c.font = '40px "ClassDock Nanum Pen"'; const b = c.measureText("똠").width;
    return Boolean(face) && Math.abs(a - b) < 0.01;
  })).toBe(true);
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
  await expect(page.locator(".diary-status")).toContainText("스티커 2개를 골랐어요");

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
  await menu.locator("button", { hasText:"스티커 3개 떼기" }).click();
  await expect(stickers).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(stickers).toHaveCount(3);
});

test("내장 스티커: 색을 골라 붙이면 그림으로 그려지고, 고른 뒤 색을 바꾸면 그 스티커만 바뀐다", async ({ page }) => {
  await boot(page);
  const entry = () => page.evaluate(() => {
    const e = docs.find(d => d.kind === "diary").diary.entries[0];
    return e ? e.stickers.map(s => ({ kind:s.kind, art:s.art, color:s.color, opacity:s.opacity })) : [];
  });
  await page.locator(".diary-bar .diary-sticker-btn").click();
  const panel = page.locator(".diary-art-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".diary-art-chip")).toHaveCount(144);
  await expect(panel.locator(".diary-art-grid")).toHaveCSS("display", "grid");
  const tiles = await panel.locator(".diary-art-chip").evaluateAll(nodes => nodes.slice(0, 13).map(node => {
    const box = node.getBoundingClientRect(); return { x:Math.round(box.x), y:Math.round(box.y), w:Math.round(box.width) };
  }));
  expect(new Set(tiles.slice(0, 12).map(tile => tile.y)).size).toBe(1);
  expect(tiles[12].y).toBeGreaterThan(tiles[0].y);
  expect(Math.max(...tiles.map(tile => tile.w))).toBeLessThan(40);

  // 파랑을 고르고 하트를 붙인다 → 사진이 아니라 SVG 로 그려진다(파일에 바이트가 없다)
  await panel.locator('.diary-art-color[data-color="#3b82f6"]').click();
  await panel.locator('.diary-art-chip[data-art="heart"]').click();
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await expect(page.locator(".diary-sticker-art svg")).toBeVisible();
  await expect(page.locator(".diary-sticker img")).toHaveCount(0);
  assertArt(await entry(), [{ kind:"art", art:"heart", color:"#3b82f6" }]);

  // 둘째로 별을 붙인 뒤, 하트만 골라 빨강으로 → 별은 그대로
  await panel.locator('.diary-art-chip[data-art="star"]').click();
  await expect(page.locator(".diary-sticker")).toHaveCount(2);
  // 새로 붙인 스티커는 조금 어긋나 쌓이므로, 아래의 하트는 겹치지 않는 왼쪽 위 모서리로 고른다
  await page.locator(".diary-sticker").nth(0).click({ position:{ x:4, y:4 } });
  await expect(page.locator(".diary-sticker").nth(0)).toHaveClass(/is-selected/);
  await panel.locator('.diary-art-color[data-color="#ef4444"]').click();
  assertArt(await entry(), [{ kind:"art", art:"heart", color:"#ef4444" }, { kind:"art", art:"star", color:"#3b82f6" }]);

  // 고른 하트만 35%로 흐려지고, 별은 기본 100%를 유지한다
  const opacity = panel.locator(".diary-art-opacity");
  await opacity.fill("35");
  await expect(page.locator(".diary-sticker-art").nth(0)).toHaveCSS("opacity", "0.35");
  const faded = await entry();
  expect(faded.map(row => row.opacity)).toEqual([0.35, 1]);

  // 저장한 .diary 안에는 사진이 하나도 들어가지 않는다
  const names = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "diary");
    const zip = await diaryZipRead(diaryPack(doc.diary, doc.diaryAssets || new Map()));
    return [...zip.keys()];
  });
  expect(names).toEqual(["diary.json"]);
});

test("사진 투명도: 우클릭으로 조절기를 열어 고른 사진만 흐리게 하고, 저장해 다시 열어도 남는다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"꽃.png", mimeType:"image/png", buffer:solidPng(200, 100, [220, 80, 120]) });
  const sticker = page.locator(".diary-sticker");
  await expect(sticker).toHaveCount(1);
  await sticker.click({ button:"right" });
  const menu = page.locator(".text-context-menu");
  await menu.locator("button", { hasText:"사진 투명도 조절" }).click();
  const panel = page.locator(".diary-art-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".diary-art-opacity")).toBeFocused();
  await panel.locator(".diary-art-opacity").fill("40");
  await expect(sticker.locator("img")).toHaveCSS("opacity", "0.4");
  const reopened = await page.evaluate(async () => {
    const doc = docs.find(d => d.kind === "diary");
    const now = doc.diary.entries[0].stickers[0].opacity;
    const back = await diaryUnpack(diaryPack(doc.diary, doc.diaryAssets || new Map()));
    return [now, back.model.entries[0].stickers[0].opacity];
  });
  expect(reopened).toEqual([0.4, 0.4]);
});

function assertArt(rows, want){
  expect(rows.length).toBe(want.length);
  rows.forEach((row, i) => {
    expect(row.kind).toBe(want[i].kind);
    expect(row.art).toBe(want[i].art);
    expect(row.color).toBe(want[i].color);
  });
}

test("색을 직접 골라 붙이면 그림도 글상자도 그 색이고, 고르개를 끄는 동안은 되돌리기 한 걸음이다", async ({ page }) => {
  await boot(page);
  const rows = () => page.evaluate(() => {
    const e = docs.find(d => d.kind === "diary").diary.entries[0];
    return e ? e.stickers.map(s => ({ kind:s.kind, color:s.color })) : [];
  });
  await page.locator(".diary-bar .diary-sticker-btn").click();
  const panel = page.locator(".diary-art-panel");
  const custom = panel.locator(".diary-art-color-custom");
  await custom.fill("#7d5fff");
  await expect(custom).toHaveClass(/is-on/);
  await expect(panel.locator(".diary-art-color.is-on")).toHaveCount(0);      // 팔레트 밖 색이라 칩은 모두 꺼진다

  // 그림도 글상자도 직접 고른 색을 따른다(글상자만 검정으로 붙지 않는다)
  await panel.locator('.diary-art-chip[data-art="heart"]').click();
  await panel.locator(".diary-btn").click();                                  // 글상자 넣기
  await page.keyboard.type("보라색 글");
  await page.keyboard.press("Control+Enter");
  expect(await rows()).toEqual([{ kind:"art", color:"#7d5fff" }, { kind:"text", color:"#7d5fff" }]);

  // 하트만 골라 색 고르개를 끄는 동안(input 이 여러 번) 바뀌어도 되돌리기는 한 걸음이다
  const heart = page.locator(".diary-sticker").nth(0);
  await heart.click({ position:{ x:4, y:4 } });
  await expect(heart).toHaveClass(/is-selected/);
  await page.locator(".diary-bar .diary-sticker-btn").click();
  await page.evaluate(() => {
    const input = document.querySelector(".diary-art-color-custom");
    for (const value of ["#112233", "#445566", "#0a7d33"]){
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles:true }));
    }
    input.dispatchEvent(new Event("change", { bubbles:true }));
  });
  expect((await rows())[0].color).toBe("#0a7d33");
  await heart.click({ position:{ x:4, y:4 } });                               // 입력칸에서 나와야 Ctrl+Z 가 일기장 것이 된다
  await page.keyboard.press("Control+z");
  expect(await rows()).toEqual([{ kind:"art", color:"#7d5fff" }, { kind:"text", color:"#7d5fff" }]);

  // 우클릭 '색 바꾸기 ▸ 직접 고르기…' 는 (메뉴에 칸을 못 넣으므로) 스티커 창의 색 칸을 열어 준다
  await page.locator(".diary-bar .diary-sticker-btn").click();               // 창을 닫아 두고 확인
  await expect(panel).toBeHidden();
  await heart.click({ button:"right", position:{ x:4, y:4 } });
  const menu = page.locator(".text-context-menu");
  await menu.locator("button", { hasText:"색 바꾸기" }).click();
  await page.locator(".text-context-sub button", { hasText:"직접 고르기" }).click();
  await expect(panel).toBeVisible();
  await expect(custom).toBeFocused();
});

test("그림 칸 펜도 팔레트 밖 색으로 그리고, 고른 색을 다음에도 기억한다", async ({ page }) => {
  await boot(page);
  await chooseLines(page, "picture");
  await page.locator(".diary-picture-draw").click();
  const bar = page.locator(".diary-draw-bar");
  await expect(bar).toBeVisible();
  await bar.locator(".diary-pen-custom").fill("#0ea5e9");
  await expect(bar.locator(".diary-pen.is-on")).toHaveCount(0);
  await expect(bar.locator(".diary-pen-custom")).toHaveClass(/is-on/);
  const layer = page.locator(".diary-draw-layer");
  const lb = await stableBox(layer);
  const y = lb.y + lb.height / 2;
  await page.mouse.move(lb.x + lb.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.8, y, { steps:8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const drawing = await page.evaluate(() => (docs.find(d => d.kind === "diary").diary.entries[0] || {}).drawing || []);
    return drawing.length ? drawing[0].c : "";
  }).toBe("#0ea5e9");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.diaryPen") || "null").color)).toBe("#0ea5e9");
});

test("글상자: 종이에 글을 얹고 두 번 눌러 고쳐 쓰며, 비우면 사라지고 검색에도 잡힌다", async ({ page }) => {
  await boot(page);
  const boxes = () => page.evaluate(() => {
    const e = docs.find(d => d.kind === "diary").diary.entries[0];
    return e ? e.stickers.filter(s => s.kind === "text").map(s => ({ text:s.text, align:s.align, size:s.size })) : [];
  });
  await page.locator(".diary-bar .diary-sticker-btn").click();
  await page.locator(".diary-art-panel .diary-btn").click();          // 글상자 넣기

  // 붙자마자 고쳐 쓰는 칸이 열리고 견본 글이 모두 골라져 있다 → 바로 덮어쓴다
  const edit = page.locator(".diary-sticker-edit");
  await expect(edit).toBeFocused();
  await page.keyboard.type("바다에 갔다");
  await page.keyboard.press("Control+Enter");
  await expect(edit).toHaveCount(0);
  await expect(page.locator(".diary-sticker-text")).toHaveText("바다에 갔다");
  expect((await boxes())[0].text).toBe("바다에 갔다");

  // 본문이 비어도 목록 이름과 검색은 글상자 글을 읽는다
  await expect(page.locator(".diary-month-item-label")).toHaveText("바다에 갔다");
  await page.locator('.diary-side-tab[data-side-tab="search"]').click();
  await page.locator(".diary-search-input").fill("바다");
  await expect(page.locator(".diary-search-count")).toHaveText("1개의 일기");   // 카드는 가운데 목록에 그려진다
  await expect(page.locator(".diary-month-list .diary-month-item")).toHaveCount(1);

  // 두 번 눌러 고쳐 쓰기 — Esc 는 고치기 전으로 되돌린다
  await page.locator(".diary-sticker").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("산에 갔다");
  await page.keyboard.press("Escape");
  await expect(page.locator(".diary-sticker-text")).toHaveText("바다에 갔다");

  // 글을 모두 지우면 글상자가 사라지고, 되돌리기로 돌아온다
  await page.locator(".diary-sticker").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.locator(".diary-text").click();
  await expect(page.locator(".diary-sticker")).toHaveCount(0);
  expect(await boxes()).toEqual([]);
});

test("글상자 글자 크기는 종이 폭 비율이라 창이 좁아져도 줄바꿈 자리가 같다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-sticker-btn").click();
  await page.locator(".diary-art-panel .diary-btn").click();
  await page.keyboard.type("한 줄에 담기지 않을 만큼 제법 기다란 문장이다");
  await page.keyboard.press("Control+Enter");
  const box = page.locator(".diary-sticker-text");
  const ratio = async () => page.evaluate(() => {
    const el = document.querySelector(".diary-sticker-text");
    const paper = document.querySelector(".diary-paper");
    return parseFloat(getComputedStyle(el).fontSize) / paper.clientWidth;
  });
  const lines = async () => {
    const r = await stableBox(box);
    const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".diary-sticker-text")).fontSize));
    return Math.round(r.height / (fs * 1.35));
  };
  const before = { ratio:await ratio(), lines:await lines() };
  expect(before.lines).toBeGreaterThan(1);                 // 줄이 실제로 바뀌는 길이여야 의미가 있다
  await page.setViewportSize({ width:900, height:800 });
  await expect(box).toBeVisible();
  // 종이 폭이 바뀌면 ResizeObserver 가 다시 배치한다 — 그 뒤의 값을 본다
  await expect.poll(ratio, { timeout:5000 }).toBeCloseTo(before.ratio, 3);   // 글자 크기는 폭에 대한 비율 그대로
  expect(await lines()).toBe(before.lines);                                  // 줄바꿈 자리도 그대로
});

test("접기: 양옆 칸을 따로 접으면 종이가 제 폭을 찾고, 접은 상태는 다음에도 남는다", async ({ page }) => {
  await boot(page);
  const paperWidth = async () => Math.round((await stableBox(page.locator(".diary-paper"))).width);
  const side = page.locator(".diary-side"), rail = page.locator(".diary-entry-rail");
  const narrowed = await paperWidth();
  expect(narrowed).toBeLessThan(780);                       // 왼쪽 두 칸이 종이를 밀고 있다

  await page.locator(".diary-side-toggle").click();
  await expect(side).toBeHidden();
  await expect(rail).toBeVisible();                         // 둘은 따로 접힌다
  await page.locator(".diary-rail-toggle").click();
  await expect(rail).toBeHidden();
  expect(await paperWidth()).toBe(780);                     // 종이가 제 폭(max-width)을 찾는다
  expect(await paperWidth()).toBeGreaterThan(narrowed);

  // 접은 상태는 보는 사람 편의라 localStorage 에만 — 파일이 더러워지지 않는다
  await expect(page.locator(".diary-status")).not.toContainText("저장 안 됨");
  expect(await page.evaluate(() => localStorage.getItem("mn.diaryPanels"))).toBe('{"side":true,"rail":true,"head":false}');

  // 새로 연 일기장도 접힌 채로 시작한다(앞 탭도 DOM 에 남으므로 새로 붙은 쪽만 본다)
  await page.evaluate(() => window.newDiaryScratch && window.newDiaryScratch());
  await expect(page.locator(".diary-doc")).toHaveCount(2);
  const fresh = page.locator(".diary-doc").last();
  await expect(fresh.locator(".diary-side")).toBeHidden();
  await expect(fresh.locator(".diary-entry-rail")).toBeHidden();

  await fresh.locator(".diary-side-toggle").click();
  await fresh.locator(".diary-rail-toggle").click();
  await expect(fresh.locator(".diary-side")).toBeVisible();
  await expect(fresh.locator(".diary-entry-rail")).toBeVisible();
});

test("몰입 모드: 양옆을 감추고 Esc 로 나오며, 접어 둔 상태는 그대로 돌아온다", async ({ page }) => {
  await boot(page);
  // 목록만 접어 둔 채로 들어간다 → 나올 때 이 상태 그대로여야 한다
  await page.locator(".diary-rail-toggle").click();
  await expect(page.locator(".diary-entry-rail")).toBeHidden();

  await page.locator(".diary-focus-btn").click();
  await expect(page.locator(".diary-side")).toBeHidden();
  await expect(page.locator(".diary-entry-rail")).toBeHidden();
  await expect(page.locator(".diary-focus-btn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".diary-side-toggle")).toBeDisabled();      // 몰입 중엔 접을 게 없다
  await expect(page.locator(".diary-status")).toContainText("Esc");

  // 글을 쓰다가도 Esc 로 나올 수 있다(본문 칸은 예외로 받는다)
  await page.locator(".diary-text").click();
  await page.keyboard.type("몰입해서 쓴 글");
  await page.keyboard.press("Escape");
  await expect(page.locator(".diary-focus-btn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".diary-side")).toBeVisible();
  await expect(page.locator(".diary-entry-rail")).toBeHidden();         // 접어 둔 목록은 접힌 채로
  await expect(page.locator(".diary-text")).toHaveValue("몰입해서 쓴 글");
});

test("몰입 모드는 날짜 머리만 감추고, 종이는 그 높이만큼만 올라간다", async ({ page }) => {
  await boot(page);
  // 양옆을 이미 접어 둔 채로 들어가면 여백 차이가 유일하게 눈에 띄어 화면이 툭 내려간 것처럼 보인다.
  await page.locator(".diary-side-toggle").click();
  await page.locator(".diary-rail-toggle").click();
  const head = page.locator(".diary-page-head"), paper = page.locator(".diary-paper");
  const y = async () => Math.round((await stableBox(paper)).y);
  const before = await y();
  const headBox = await stableBox(head);
  const headSpace = Math.round((await stableBox(paper)).y - headBox.y);  // 머리 높이 + 아래 여백
  await expect(page.locator(".diary-focus-date")).toBeHidden();

  await page.locator(".diary-focus-btn").click();
  await expect(page.locator(".diary-side")).toBeHidden();
  await expect(head).toBeHidden();                                      // 몰입 = 종이만
  await expect(page.locator(".diary-focus-date")).toBeVisible();        // 날짜는 도구막대에서 본다
  await expect(page.locator(".diary-focus-date")).toContainText(await page.locator(".diary-date").textContent());
  expect(Math.abs(await y() - (before - headSpace))).toBeLessThanOrEqual(1);
  await page.locator(".diary-focus-btn").click();
  await expect(page.locator(".diary-focus-btn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".diary-side")).toBeHidden();               // 접어 둔 칸은 접힌 채로 돌아온다
  await expect(head).toBeVisible();
  await expect(page.locator(".diary-focus-date")).toBeHidden();
  expect(await y()).toBe(before);
});

test("Alt+PageUp/PageDown 으로 날짜를 넘기고, 몰입 중엔 도구막대 날짜가 따라간다", async ({ page }) => {
  await boot(page);
  const date = page.locator(".diary-date"), focusDate = page.locator(".diary-focus-date");
  const start = await date.textContent();
  await page.locator(".diary-text").click();
  await page.keyboard.type("오늘 쓴 글");
  await page.keyboard.press("Alt+PageUp");                              // 본문을 쓰다가도 넘어간다
  await expect(date).not.toHaveText(start);
  await expect(page.locator(".diary-text")).toHaveValue("");
  const prev = await date.textContent();

  await page.locator(".diary-focus-btn").click();
  await expect(focusDate).toContainText(prev);
  await page.locator(".diary-text").click();
  await page.keyboard.press("Alt+PageDown");
  await expect(focusDate).toContainText(start);
  await expect(page.locator(".diary-text")).toHaveValue("오늘 쓴 글");

  // 제목 칸 같은 다른 입력칸에서는 넘기지 않는다
  await page.keyboard.press("Escape");
  await page.locator(".diary-entry-title").click();
  await page.keyboard.press("Alt+PageUp");
  await expect(date).toHaveText(start);
});

test("머리 접기: 제목·태그 줄만 접고, 날짜 줄과 그 날의 요약은 남는다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-entry-title").fill("소풍 간 날");
  await page.locator('.diary-pick[data-pick="weather"]').click();
  await page.locator(".diary-pick-pop .diary-pick-option").first().click();

  const toggle = page.locator(".diary-head-toggle"), summary = page.locator(".diary-head-summary");
  await toggle.click();
  await expect(page.locator(".diary-title-row")).toBeHidden();
  await expect(page.locator(".diary-tag-row")).toBeHidden();
  await expect(page.locator(".diary-date")).toBeVisible();
  await expect(page.locator(".diary-day-nav").first()).toBeVisible();   // 접어도 날짜는 옮길 수 있다
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toContainText("소풍 간 날");
  await expect(summary.locator(".diary-pick-emoji")).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.diaryPanels")).head)).toBe(true);

  // 빈 날로 가면 요약도 비어 사라지고, 돌아오면 다시 보인다
  await page.locator(".diary-day-nav").first().click();
  await expect(summary).toBeHidden();
  await page.locator(".diary-day-nav").last().click();
  await expect(summary).toContainText("소풍 간 날");

  // 요약을 누르면 펼쳐진다
  await summary.click();
  await expect(page.locator(".diary-title-row")).toBeVisible();
  await expect(page.locator(".diary-entry-title")).toHaveValue("소풍 간 날");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(summary).toBeHidden();
});

test("몰입 중 Esc 는 글상자 고치기·열린 창·고른 스티커를 먼저 처리한다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-sticker-btn").click();
  await page.locator(".diary-art-panel .diary-btn").click();            // 글상자 넣기
  await page.keyboard.type("쪽지");
  await page.keyboard.press("Control+Enter");
  await page.locator(".diary-focus-btn").click();
  const focused = page.locator(".diary-focus-btn");

  // 글상자를 고쳐 쓰는 중의 Esc 는 '고치기 취소'다 — 몰입에서 나가면 안 된다
  await page.locator(".diary-sticker").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("바뀐 글");
  await page.keyboard.press("Escape");
  await expect(focused).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".diary-sticker-text")).toHaveText("쪽지");

  // 스티커를 고른 채의 Esc 는 '고르기 풀기'다
  await page.locator(".diary-sticker").click();
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(0);
  await expect(focused).toHaveAttribute("aria-pressed", "true");

  // 아무것도 안 걸렸을 때에야 몰입에서 나간다
  await page.keyboard.press("Escape");
  await expect(focused).toHaveAttribute("aria-pressed", "false");
});

test("원고지 칸 수: 원고지·그림일기일 때만 고를 수 있고, 10칸을 고르면 한 줄에 10자씩", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar .diary-style-btn").click();
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

/* ----- 사진 여러 장(정렬·겹친 것 고르기·크게 보기·모아 보기) ----- */

const photoFiles = (n) => Array.from({ length:n }, (_, i) => ({
  name:"사진" + (i + 1) + ".png", mimeType:"image/png",
  buffer:solidPng(200, 100, [40 + i * 50, 200 - i * 40, 120 + i * 30])
}));
// 종이 층 안의 자리로 잰다 — 글을 쓰는 동안 화면이 굴러가도 값이 흔들리지 않는다.
const stickerBoxes = (page) => page.evaluate(() => [...document.querySelectorAll(".diary-sticker")]
  .map(n => ({ x:n.offsetLeft, y:n.offsetTop, w:n.offsetWidth, h:n.offsetHeight, rot:n.style.transform })));
const rootMenu = (page) => page.locator(".text-context-menu:not(.text-context-sub)");

test("사진 여러 장을 한꺼번에 붙이면 겹쳐 쌓지 않고 줄 맞춰 깐다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar input[type=file]").first().setInputFiles(photoFiles(3));
  const stickers = page.locator(".diary-sticker");
  await expect(stickers).toHaveCount(3);
  await expect(page.locator(".diary-status")).toContainText("줄 맞춰");
  const boxes = await stickerBoxes(page);
  // 어느 두 장도 겹치지 않는다(예전에는 3% 씩 어긋내 겹쳐 쌓았다)
  for (let i = 0; i < boxes.length; i++){
    for (let j = i + 1; j < boxes.length; j++){
      const a = boxes[i], b = boxes[j];
      const over = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
      expect(over, "겹치지 않는다 " + i + "-" + j).toBe(false);
    }
  }
  expect(Math.round(boxes[0].y)).toBe(Math.round(boxes[1].y));              // 한 줄에 나란히
  expect(boxes[0].x + boxes[0].w).toBeLessThanOrEqual(boxes[1].x + 1);
  expect(Math.round(boxes[0].h)).toBe(Math.round(boxes[1].h));              // 같은 줄은 높이를 맞춘다
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(3);  // 방금 깐 것이 다 골라져 있다

  // 우클릭 → 정렬해서 깔기 ▸ 격자로 ▸ 2열
  await stickers.first().click({ button:"right" });
  await rootMenu(page).locator("button", { hasText:"정렬해서 깔기" }).click();
  await page.locator(".text-context-sub button", { hasText:"격자로" }).click();
  await page.locator(".text-context-sub button", { hasText:"2열" }).click();
  await expect(page.locator(".diary-status")).toContainText("격자로");
  const grid = await stickerBoxes(page);
  expect(new Set(grid.map(b => Math.round(b.x))).size).toBe(2);
  expect(new Set(grid.map(b => Math.round(b.y))).size).toBe(2);

  // 사진첩처럼 = 살짝 기울여 깔기. 되돌리기는 정렬 한 번이 한 걸음이다.
  await stickers.first().click({ button:"right" });
  await rootMenu(page).locator("button", { hasText:"정렬해서 깔기" }).click();
  await page.locator(".text-context-sub button", { hasText:"사진첩처럼" }).click();
  const album = await stickerBoxes(page);
  expect(album.some(b => /rotate/.test(b.rot))).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await stickerBoxes(page)).map(b => Math.round(b.x)).join(",")).toBe(grid.map(b => Math.round(b.x)).join(","));
});

test("겹친 사진은 Alt+누르기로 아래 것을 고르고, 두 번 누르면 크게 본다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar input[type=file]").first().setInputFiles(photoFiles(2));
  const stickers = page.locator(".diary-sticker");
  await expect(stickers).toHaveCount(2);
  const ids = await page.evaluate(() => [...document.querySelectorAll(".diary-sticker")].map(n => n.dataset.id));

  // 뒤 사진만 골라 앞 사진 위로 끌어 겹쳐 놓는다(둘 다 골라져 있으면 함께 움직인다)
  await stickers.last().click();
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(1);
  const first = await stableBox(stickers.first()), second = await stableBox(stickers.last());
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps:8 });
  await page.mouse.up();
  const at = await stableBox(stickers.first());
  const cx = at.x + at.width / 2, cy = at.y + at.height / 2;

  // 그냥 누르면 늘 위의 것(나중에 붙인 것)만 잡힌다
  await page.mouse.click(cx, cy);
  await expect(page.locator(".diary-sticker.is-selected")).toHaveAttribute("data-id", ids[1]);
  // Alt+누르기 = 한 칸 아래 것으로
  await page.keyboard.down("Alt");
  await page.mouse.click(cx, cy);
  await expect(page.locator(".diary-sticker.is-selected")).toHaveAttribute("data-id", ids[0]);
  await expect(page.locator(".diary-status")).toContainText("2/2");
  await page.mouse.click(cx, cy);                                    // 맨 아래 다음은 다시 맨 위
  await expect(page.locator(".diary-sticker.is-selected")).toHaveAttribute("data-id", ids[1]);
  await page.keyboard.up("Alt");

  // 두 번 누르면 공용 그림 창에서 크게 — ←→ 로 그 날 사진을 넘겨 본다
  await stickers.last().dblclick();                                  // 겹친 자리에서는 위의 것이 잡힌다
  const zoom = page.locator(".plot-zoom");
  await expect(zoom).toBeVisible();
  await expect(page.locator("#plotZoomCount")).toHaveText("2 / 2");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#plotZoomCount")).toHaveText("1 / 2");
  await page.keyboard.press("Escape");
  await expect(zoom).toBeHidden();
  await expect(page.locator(".diary-sticker")).toHaveCount(2);       // Esc 가 스티커를 떼지 않는다
});

test("사진이 많은 날은 목록 카드에 여러 장이 보이고, '사진' 탭에서 모아 본다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").click();
  await page.keyboard.type("소풍 간 날");
  await page.locator(".diary-bar input[type=file]").first().setInputFiles(photoFiles(4));
  await expect(page.locator(".diary-sticker")).toHaveCount(4);
  const thumb = page.locator(".diary-entry-card-thumb").first();
  await expect(thumb).toHaveAttribute("data-photos", "3");
  await expect(thumb.locator("img")).toHaveCount(3);
  await expect(thumb.locator(".diary-entry-card-more")).toHaveText("+1");

  // 어제로 가서 한 장 더 붙인 뒤 '사진' 탭에서 모아 본다
  await page.locator(".diary-day-nav").first().click();
  await page.locator(".diary-bar input[type=file]").first().setInputFiles(photoFiles(1));
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await page.locator('.diary-side-tab[data-side-tab="photos"]').click();
  const cells = page.locator(".diary-photo-cell");
  await expect(cells).toHaveCount(5);
  await expect(page.locator(".diary-photo-day")).toHaveCount(2);
  await expect(page.locator(".diary-photo-pane .diary-search-count")).toContainText("5장");

  // 어제 칸에 있는 사진을 누르면 그 날로 가서 그 사진을 골라 준다
  const target = page.locator(".diary-photo-day").first().locator(".diary-photo-cell").first();
  await target.click();
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(1);
  await expect(page.locator(".diary-sticker")).toHaveCount(4);
});

test("정렬은 사진만 건드리고, 꾸미려고 놓은 그림 스티커는 제 자리에 남는다", async ({ page }) => {
  await boot(page);
  // 하트를 먼저 붙여 종이 한쪽에 옮겨 둔다(꾸미기)
  await page.locator(".diary-bar .diary-sticker-btn").click();
  const panel = page.locator(".diary-art-panel");
  await panel.locator('.diary-art-chip[data-art="heart"]').click();
  await page.keyboard.press("Escape");
  const heart = page.locator('.diary-sticker[data-kind="art"]');
  await expect(heart).toHaveCount(1);
  const hb = await stableBox(heart);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 90, { steps:6 });
  await page.mouse.up();
  const parked = await heart.evaluate(n => ({ x:n.offsetLeft, y:n.offsetTop }));

  // 사진 세 장을 붙이고 정렬한다 → 하트는 움직이지 않는다
  await page.locator(".diary-bar input[type=file]").first().setInputFiles(photoFiles(3));
  await expect(page.locator('.diary-sticker[data-kind="photo"]')).toHaveCount(3);
  const photo = page.locator('.diary-sticker[data-kind="photo"]').first();
  await photo.click();
  await photo.click({ button:"right" });
  await rootMenu(page).locator("button", { hasText:"정렬해서 깔기" }).click();
  await page.locator(".text-context-sub button", { hasText:"줄 맞춰" }).click();
  await expect(page.locator(".diary-status")).toContainText("사진 3장");          // 하트는 세지 않는다
  expect(await heart.evaluate(n => ({ x:n.offsetLeft, y:n.offsetTop }))).toEqual(parked);
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(3);        // 고른 것도 사진 셋뿐

  // 그림 스티커까지 줄 세우려면 함께 골라 놓고 정렬한다(Ctrl+A = 그날 스티커 모두)
  // — 그때는 하트도 함께 움직이고 '스티커 4개'라고 말한다.
  await photo.click();
  await page.keyboard.press("Control+a");
  await expect(page.locator(".diary-sticker.is-selected")).toHaveCount(4);
  await photo.click({ button:"right" });
  await rootMenu(page).locator("button", { hasText:"정렬해서 깔기" }).click();
  await page.locator(".text-context-sub button", { hasText:"줄 맞춰" }).click();
  await expect(page.locator(".diary-status")).toContainText("스티커 4개");
  expect(await heart.evaluate(n => ({ x:n.offsetLeft, y:n.offsetTop }))).not.toEqual(parked);
});

test("저장한 일기장은 탭을 열고 둘러보기만 해서는 '저장 안 됨'이 안 켜지고, 껐다 켜도 깨끗하다", async ({ page }) => {
  await page.setViewportSize({ width:1400, height:900 });
  await boot(page);
  await page.locator(".diary-text").click();
  await page.keyboard.type("바다에 갔다.");
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"a.png", mimeType:"image/png", buffer:solidPng(300, 200, [200, 0, 0]) });
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  await page.locator('.diary-pick[data-pick="weather"]').click();
  await page.locator('.diary-pick-option[data-value="sunny"]').click();
  // 저장본 바이트로 디스크에서 연 것처럼 다시 연다
  await page.evaluate(async () => {
    const tmp = docs.find(d => d.kind === "diary");
    const bytes = diaryPack(tmp.diary, tmp.diaryAssets, Date.now());
    tmp.name = "임시.diary";
    await handleFiles([new File([bytes], "원본.diary", { type:"application/zip" })], {});
  });
  const dirtyOf = () => page.evaluate(() => { const d = docs.find(x => x.name === "원본.diary"); return d ? !!d.hasUnsavedEdits : null; });
  await page.locator('#docTabs .tab[title^="원본.diary "]').first().click();
  const root = page.locator(".office:not([hidden])");
  await expect(root.locator(".diary-paper")).toBeVisible();
  // 고치지 않고 둘러보기만 — 옆 칸 탭, 빈 날·오늘 오가기, 스티커 고르기, 창 크기
  for (const name of ["찾기", "사진", "돌아보기", "달력"]) await root.locator(".diary-side-tab", { hasText:name }).click();
  const month = todayKey().slice(0, 8);
  await root.locator(`.diary-cal-day[data-date="${month}05"]`).click();
  await root.locator(`.diary-cal-day[data-date="${todayKey()}"]`).click();
  await root.locator(".diary-sticker").first().click();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width:1000, height:800 });
  await page.waitForTimeout(500);
  expect(await dirtyOf()).toBe(false);

  await page.evaluate(async () => { window.saveTextDoc = async () => true; await saveDiary(docs.find(x => x.name === "원본.diary")); });
  expect(await dirtyOf()).toBe(false);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await expect.poll(dirtyOf, { timeout:15_000 }).toBe(false);
  await page.locator('#docTabs .tab[title^="원본.diary "]').first().click();
  await expect(page.locator(".office:not([hidden]) .diary-paper")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await dirtyOf()).toBe(false);
});
