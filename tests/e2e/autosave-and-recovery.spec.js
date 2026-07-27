const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 자동 저장 통합과 실패 안내.
 *
 * 예전에는 자동 저장이 Python 에만 있고 설정 이름도 pythonAutosave 여서, 같은 편집기를 쓰는
 * .txt·.md 는 "알아서 저장되는 파일"과 아닌 파일이 뒤섞여 있었다. 하나의 설정으로 묶였는지와,
 * 저장이 실패했을 때 사용자가 막다른 길에 놓이지 않는지를 지킨다.
 */

async function boot(page, settings){
  await page.addInitScript((extra) => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
      if (extra) localStorage.setItem("pdfSignerSettings", JSON.stringify(extra));
    } catch(_){}
  }, settings || null);
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

test("설정 창의 자동 저장 항목은 하나로 묶여 있고 복구본과 구분된다", async ({ page }) => {
  await boot(page);
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="document"]').click();
  await expect(page.locator("#settingAutoSave")).toBeVisible();
  await expect(page.locator("#settingPdfRecovery")).toBeVisible();
  // 예전의 Python 전용 항목은 사라져야 한다.
  await expect(page.locator("#settingPythonAutosave")).toHaveCount(0);
  // 두 항목이 무엇을 하는지(원본에 씀 ↔ 복구본만) 화면에서 구분돼야 한다.
  await expect(page.locator("#settingAutoSave").locator("xpath=../span")).toContainText("원본에 자동 저장");
  await expect(page.locator("#settingPdfRecovery").locator("xpath=../span")).toContainText("원본 파일은 건드리지 않고");
});

test("예전 pythonAutosave 설정을 켜 두었으면 새 설정도 켜진 채로 열린다", async ({ page }) => {
  await boot(page, { pythonAutosave: true });
  expect(await page.evaluate(() => appSettings.autoSave)).toBe(true);
  await page.locator("#settingsOpen").click();
  await page.locator('[data-settings-tab="document"]').click();
  await expect(page.locator("#settingAutoSave")).toBeChecked();
});

test("자동 저장을 켜면 텍스트 편집기도 저장 위치를 묻지 않고 조용히 저장한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page, { autoSave: true });
  await page.locator("#fileInput").setInputFiles({
    name: "자동저장.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("처음 내용\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("자동저장.txt");

  // 원본에 조용히 쓸 수 있는 상태(폴더로 연 파일)를 흉내 낸다.
  const wrote = await page.evaluate(() => {
    const doc = docs.find((d) => d.name === "자동저장.txt");
    window.__wrote = [];
    doc.originalSaveMode = true;
    doc.fsHandle = {
      kind: "file", name: "자동저장.txt",
      async queryPermission(){ return "granted"; },
      async requestPermission(){ return "granted"; },
      async createWritable(){
        return { async write(v){ window.__wrote.push(typeof v === "string" ? v : "blob"); }, async close(){}, async abort(){} };
      }
    };
    return true;
  });
  expect(wrote).toBe(true);

  await page.getByRole("button", { name: /편집/ }).first().click();
  const editor = page.locator("textarea.code-input").first();
  await editor.click();
  await page.keyboard.type("자동으로 저장되어야 함");

  // 입력이 멈춘 뒤 3초 → 대화상자 없이 저장되고 '저장 안 됨' 표시가 사라진다.
  await expect.poll(() => page.evaluate(() => window.__wrote.length), { timeout: 15000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const doc = docs.find((d) => d.name === "자동저장.txt");
    return !!(doc && doc.hasUnsavedEdits);
  }), { timeout: 15000 }).toBe(false);
  expect(errors).toEqual([]);
});

test("자동 저장을 끄면 텍스트 편집기가 저장하지 않는다", async ({ page }) => {
  await boot(page, { autoSave: false });
  await page.locator("#fileInput").setInputFiles({
    name: "안함.txt", mimeType: "text/plain", buffer: Buffer.from("처음\n", "utf8")
  });
  await page.evaluate(() => {
    const doc = docs.find((d) => d.name === "안함.txt");
    window.__wrote = [];
    doc.originalSaveMode = true;
    doc.fsHandle = {
      kind: "file", name: "안함.txt",
      async queryPermission(){ return "granted"; },
      async createWritable(){ return { async write(){ window.__wrote.push(1); }, async close(){}, async abort(){} }; }
    };
  });
  await page.getByRole("button", { name: /편집/ }).first().click();
  const editor = page.locator("textarea.code-input").first();
  await editor.click();
  await page.keyboard.type("저장되면 안 됨");
  await page.waitForTimeout(4500);            // 자동 저장 지연(3초)을 넘겨 기다린다
  expect(await page.evaluate(() => window.__wrote.length)).toBe(0);
  expect(await page.evaluate(() => docs.find((d) => d.name === "안함.txt").hasUnsavedEdits)).toBe(true);
});

test("원본 저장이 막히면 사본으로 내려받는 길을 함께 준다", async ({ page }) => {
  await boot(page);
  await page.locator("#fileInput").setInputFiles({
    name: "막힘.txt", mimeType: "text/plain", buffer: Buffer.from("내용\n", "utf8")
  });
  await page.evaluate(() => {
    const doc = docs.find((d) => d.name === "막힘.txt");
    doc.originalSaveMode = true;
    doc.fsHandle = {
      kind: "file", name: "막힘.txt",
      async queryPermission(){ return "denied"; },
      async requestPermission(){ return "denied"; },
      async createWritable(){ throw new Error("권한 없음"); }
    };
  });
  await page.getByRole("button", { name: /편집/ }).first().click();
  const editor = page.locator("textarea.code-input").first();
  await editor.click();
  await page.keyboard.type("저장 시도");
  await page.locator("button.run-save").first().click();
  await expect(page.getByText(/저장하지 못했어요/)).toBeVisible();
  await expect(page.locator(".toast-action", { hasText: "사본으로 내려받기" })).toBeVisible();
});

test(".mnote 도 편집하면 복구본을 남긴다", async ({ page }) => {
  await boot(page, { pdfRecovery: true });
  await page.evaluate(() => newMnoteScratch());
  await expect(page.locator("textarea.mnote-text").first()).toBeVisible();
  // 복구본은 다른 편집기와 같은 경로(saveDocumentRecoverySnapshot)를 쓴다 — 실제로 불리는지 본다.
  await page.evaluate(() => {
    window.__recoveryHits = 0;
    window.saveDocumentRecoverySnapshot = async () => { window.__recoveryHits++; return true; };
  });
  await page.locator("textarea.mnote-text").first().click();
  await page.keyboard.type("복구본이 남아야 해요");
  await expect.poll(() => page.evaluate(() => window.__recoveryHits), { timeout: 10000 }).toBeGreaterThan(0);
});

test("복구본 설정을 끄면 .mnote 도 복구본을 남기지 않는다", async ({ page }) => {
  await boot(page, { pdfRecovery: false });
  await page.evaluate(() => newMnoteScratch());
  await expect(page.locator("textarea.mnote-text").first()).toBeVisible();
  await page.evaluate(() => {
    window.__recoveryHits = 0;
    window.saveDocumentRecoverySnapshot = async () => { window.__recoveryHits++; return true; };
  });
  await page.locator("textarea.mnote-text").first().click();
  await page.keyboard.type("남기지 않아야 해요");
  await page.waitForTimeout(2600);
  expect(await page.evaluate(() => window.__recoveryHits)).toBe(0);
});
