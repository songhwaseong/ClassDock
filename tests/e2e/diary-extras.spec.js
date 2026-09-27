const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { collapseSidebar, stableBox } = require("./helpers");
const { solidPng } = require("./helpers-png");

/* 일기장 확장(2026-09-28) — 맞춤법(F7·우클릭) · 내 글감 · Markdown/HTML 내보내기 · 사진 테두리 · 녹음 스티커 · 기념일. */

async function boot(page){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko");
      localStorage.removeItem("mn.diaryUserPrompts");
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newDiaryScratch && window.newDiaryScratch());
  await expect(page.locator(".diary-bar")).toBeVisible();
  await expect(page.locator(".diary-paper")).toBeVisible();
}
const diaryModel = page => page.evaluate(() => JSON.parse(JSON.stringify(docs.find(d => d.kind === "diary").diary)));
const todayKey = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const addDays = (key, n) => {
  const d = new Date(key + "T00:00:00"); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
// 0.6초짜리 8kHz 16bit 모노 WAV(작은 소리) — 녹음 대신 '소리 파일 넣기'로 넣는다.
function wavBuffer(seconds){
  const rate = 8000, n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return buf;
}

test("맞춤법 검사는 도구막대 단추 없이 F7 과 글칸 우클릭 메뉴로 열린다", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".diary-bar .spellcheck-trigger")).toHaveCount(0);
  const area = page.locator(".diary-text");
  await area.click();
  await page.keyboard.type("오늘은 않 좋았다.");
  await page.keyboard.press("F7");
  const panel = page.locator(".spellcheck-panel");
  await expect(panel).toBeVisible();
  await page.locator(".spellcheck-close").click();
  await expect(panel).toBeHidden();
  await area.click({ button:"right" });
  await page.locator(".text-context-menu").getByText("맞춤법 검사 (F7)").click();
  await expect(panel).toBeVisible();
});

test("내 글감을 만들고 고르면 본문에 들어가며, 이 컴퓨터에 남아 다음에도 보인다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-template-btn").click();
  const panelEl = page.locator(".diary-template-panel");
  await expect(panelEl).toBeVisible();
  await panelEl.locator(".diary-template-add").click();
  await panelEl.locator(".diary-template-name").fill("주간 회고");
  await panelEl.locator(".diary-template-text").fill("잘한 것\n아쉬운 것");
  await panelEl.locator(".diary-template-save").click();
  await expect(panelEl.locator(".diary-template-user-use")).toHaveText(["주간 회고"]);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mn.diaryUserPrompts"))).map(p => p.name)).toEqual(["주간 회고"]);
  await page.keyboard.press("Escape");                        // 저장 뒤에도 창 안에 포커스가 남아 Esc 로 닫힌다
  await expect(panelEl).toBeHidden();
  await page.locator(".diary-template-btn").click();

  await panelEl.locator(".diary-template-user-use").click();
  await expect(panelEl).toBeHidden();
  await expect(page.locator(".diary-text")).toHaveValue("잘한 것\n아쉬운 것");

  // 지금 쓴 글로 만들기 → 이름만 붙이면 된다
  await page.locator(".diary-template-btn").click();
  await panelEl.locator(".diary-template-from-text").click();
  await expect(panelEl.locator(".diary-template-text")).toHaveValue("잘한 것\n아쉬운 것");
  await panelEl.locator(".diary-template-cancel").click();
  await expect(panelEl.locator(".diary-template-form")).toHaveCount(0);
});

test("인쇄 메뉴의 '파일로 내보내기'가 Markdown 과 사진 넣은 HTML 을 내려받는다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-text").fill("첫 줄\n# 제목처럼 보이는 줄");
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"꽃.png", mimeType:"image/png", buffer:solidPng(40, 20, [200, 80, 80]) });
  await expect(page.locator(".diary-sticker")).toHaveCount(1);
  const md = await Promise.all([page.waitForEvent("download"),
    page.evaluate(() => { const d = docs.find(x => x.kind === "diary"); return d._diaryExportEntries(d.diary.entries, "md", ""); })]);
  expect(md[0].suggestedFilename()).toMatch(/\.md$/);
  const mdText = fs.readFileSync(await md[0].path(), "utf8");
  expect(mdText).toContain("첫 줄  \n\\# 제목처럼 보이는 줄");
  expect(mdText).toContain("*(사진 1장)*");
  const html = await Promise.all([page.waitForEvent("download"),
    page.evaluate(() => { const d = docs.find(x => x.kind === "diary"); return d._diaryExportEntries(d.diary.entries, "html", ""); })]);
  const htmlText = fs.readFileSync(await html[0].path(), "utf8");
  expect(htmlText).toMatch(/^<!doctype html>/);
  expect(htmlText).toContain('<img src="data:image/png;base64,');
  // 메뉴에도 있다
  await page.evaluate(() => docs.find(x => x.kind === "diary").printDiary());
  await expect(page.locator(".text-context-menu").getByText("파일로 내보내기")).toBeVisible();
});

test("사진 우클릭 → 사진 테두리 → 폴라로이드: 상자 크기는 그대로, 저장 모델에 frame 이 담긴다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-bar input[type=file]").first().setInputFiles({ name:"꽃.png", mimeType:"image/png", buffer:solidPng(200, 100, [220, 80, 120]) });
  const sticker = page.locator(".diary-sticker");
  await expect(sticker).toHaveCount(1);
  const before = await stableBox(sticker);
  await sticker.click({ button:"right" });
  const menu = page.locator(".text-context-menu");
  await menu.getByText("사진 테두리").hover();
  await menu.getByText("폴라로이드").click();
  await expect(sticker).toHaveClass(/diary-frame-polaroid/);
  const after = await stableBox(sticker);
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(Math.round(after.height)).toBe(Math.round(before.height));
  const model = await diaryModel(page);
  expect(model.entries[0].stickers[0].frame).toBe("polaroid");
  await page.locator(".diary-undo-btn").click();
  await expect(sticker).not.toHaveClass(/diary-frame-/);
});

test("소리 파일을 녹음 스티커로 붙이고, 재생 단추로 듣고, 이름표를 붙인다", async ({ page }) => {
  await boot(page);
  await page.locator(".diary-sticker-btn").click();
  const art = page.locator(".diary-art-panel");
  await expect(art.locator(".diary-audio-record")).toBeVisible();
  await art.locator(".diary-audio-file ~ input[type=file], input[type=file][accept='audio/*']").first()
    .setInputFiles({ name:"노래.wav", mimeType:"audio/wav", buffer:wavBuffer(0.6) });
  const sticker = page.locator(".diary-sticker.diary-sticker-is-audio");
  await expect(sticker).toHaveCount(1);
  await expect(sticker.locator(".diary-audio-time")).toHaveText("0:01");
  let model = await diaryModel(page);
  const st = model.entries[0].stickers[0];
  expect(st.kind).toBe("audio");
  expect(st.asset).toMatch(/^assets\/[a-z0-9_-]+\.wav$/);

  await sticker.locator(".diary-audio-play").click();
  await expect(sticker).toHaveClass(/is-playing/);
  await expect(sticker).not.toHaveClass(/is-playing/, { timeout:5000 });   // 0.6초 소리라 곧 끝난다

  await sticker.click({ button:"right" });
  await page.locator(".text-context-menu").getByText("이름표 붙이기…").click();
  await page.locator("#textInput").fill("생일 노래");
  await page.locator("#textOk").click();
  await expect(sticker.locator(".diary-audio-label")).toHaveText("생일 노래");

  // 저장본 왕복 — 소리 바이트가 ZIP 안에 있다
  const round = await page.evaluate(async () => {
    const d = docs.find(x => x.kind === "diary");
    const back = await diaryUnpack(diaryPack(d.diary, d.diaryAssets));
    const s = back.model.entries[0].stickers[0];
    return { kind:s.kind, label:s.label, bytes:back.assets.get(s.asset).bytes.length };
  });
  expect(round).toEqual({ kind:"audio", label:"생일 노래", bytes:44 + 4800 * 2 });
});

test("기념일을 넣으면 달력 아래에 D-n 으로 뜨고, 그 날 달력 칸·날짜 옆에 표시된다", async ({ page }) => {
  await boot(page);
  const today = todayKey();
  const soon = addDays(today, 3);
  await page.locator(".diary-anniv-empty").click();
  const panelEl = page.locator(".diary-anniv-panel");
  await expect(panelEl).toBeVisible();
  await panelEl.locator(".diary-anniv-name-input").fill("엄마 생신");
  await panelEl.locator(".diary-anniv-date-input").fill("1970-" + soon.slice(5));
  await panelEl.locator(".diary-anniv-repeat").selectOption("yearly");
  await panelEl.locator("form button[type=submit]").click();
  await expect(panelEl.locator(".diary-anniv-item")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(panelEl).toBeHidden();

  const row = page.locator(".diary-anniv-row").first();
  await expect(row.locator(".diary-anniv-name")).toHaveText("엄마 생신");
  await expect(row.locator(".diary-anniv-when")).toHaveText("D-3");
  const model = await diaryModel(page);
  expect(model.anniversaries.map(a => [a.name, a.repeat])).toEqual([["엄마 생신", "yearly"]]);

  await row.click();                                            // 그 날로 간다
  await expect(page.locator(".diary-anniv-badge")).toContainText("엄마 생신");
  await expect(page.locator(".diary-anniv-badge")).toContainText("번째");
  await expect(page.locator(`.diary-cal-day[data-date="${soon}"]`)).toHaveClass(/has-anniv/);
  await expect(page.locator(".diary-status")).toContainText("저장 안 됨");
  // 되돌리기 한 번이면 기념일이 빠진다
  await page.locator(".diary-undo-btn").click();
  await expect(page.locator(".diary-anniv-row")).toHaveCount(0);
});
