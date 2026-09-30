"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

async function openLotto(page, url="/"){
  await page.addInitScript(() => { localStorage.setItem("mn_onboarded_v1", "1"); });
  await page.goto(url);
  await page.locator("#commandPaletteOpen").click();
  await page.locator(".cmdk-input").fill("로또");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lotto-shell")).toBeVisible();
}

async function checkLayout(page){
  const geometry = await page.locator(".lotto-shell").evaluate(shell => {
    const box = selector => {
      const r = shell.querySelector(selector).getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
    };
    const shellBox = shell.getBoundingClientRect();
    const balls = [...shell.querySelectorAll(".lotto-game>.lotto-balls>.lotto-ball")].map(node => {
      const r = node.getBoundingClientRect(); return { width:r.width, height:r.height };
    });
    return { heading:box(".lotto-heading"), controls:box(".lotto-controls"), result:box(".lotto-result"),
      close:box(".lotto-close"), icon:box(".lotto-close svg"), draw:box(".lotto-draw"), main:box(".lotto-main"),
      shell:{ x:shellBox.x, y:shellBox.y, right:shellBox.right, bottom:shellBox.bottom, width:shellBox.width },
      overflow:shell.scrollWidth - shell.clientWidth, balls, viewport:{ width:innerWidth, height:innerHeight } };
  });
  expect(geometry.controls.y).toBeGreaterThanOrEqual(geometry.heading.bottom - 1);
  expect(geometry.result.y).toBeGreaterThanOrEqual(geometry.controls.bottom - 1);
  expect(geometry.draw.width).toBeGreaterThan(180);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.shell.x).toBeGreaterThanOrEqual(-1);
  expect(geometry.shell.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.shell.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
  const center = r => [r.x + r.width / 2, r.y + r.height / 2];
  const closeCenter = center(geometry.close), iconCenter = center(geometry.icon);
  expect(Math.abs(closeCenter[0] - iconCenter[0])).toBeLessThan(1);
  expect(Math.abs(closeCenter[1] - iconCenter[1])).toBeLessThan(1);
  expect(geometry.balls).toHaveLength(6);
  for (const ball of geometry.balls){
    expect(Math.abs(ball.width - ball.height)).toBeLessThan(1);
    expect(ball.width).toBeGreaterThan(24);
  }
}

for (const [label, width, height] of [["desktop", 1440, 900], ["tablet", 900, 900], ["mobile", 390, 844], ["small-mobile", 320, 700]]){
  test("로또 배치와 X 아이콘 중앙 정렬 — " + label, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openLotto(page);
    await checkLayout(page);
    await page.locator(".lotto-draw").click();
    await expect(page.locator(".lotto-game .lotto-ball-empty")).toHaveCount(0);
    await expect(page.locator(".lotto-history-rows .lotto-history-row")).toHaveCount(1);
    await checkLayout(page);
    if (process.env.CLASSDOCK_LOTTO_QA_DIR){
      fs.mkdirSync(process.env.CLASSDOCK_LOTTO_QA_DIR, { recursive:true });
      await page.locator(".lotto-shell").screenshot({ path:path.join(process.env.CLASSDOCK_LOTTO_QA_DIR, label + ".png"), animations:"disabled" });
    }
    await page.locator(".lotto-close").click();
    await expect(page.locator(".lotto-shell")).toHaveCount(0);
  });
}

test("화면 확대 시 카드가 실제 가용 너비에 맞춰 접힌다", async ({ page }) => {
  await page.setViewportSize({ width:1440, height:900 });
  await openLotto(page);
  for (const scale of [1.25, 1.75, 2]){
    await page.evaluate(scale => {
      document.body.style.zoom = String(scale);
      document.documentElement.style.setProperty("--ui-zoom", String(scale));
    }, scale);
    await checkLayout(page);
  }
});

test("5게임·저장·제외·기록 복원과 조건 부족 안내가 같은 창에서 동작한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openLotto(page);
  await page.locator(".lotto-count").filter({ hasText:"5게임" }).click();
  await page.locator(".lotto-draw").click();
  await expect(page.locator(".lotto-game")).toHaveCount(5);
  const firstGames = await page.locator(".lotto-game .lotto-ball").allTextContents();
  await page.locator(".lotto-actions button").filter({ hasText:"저장하기" }).click();
  await page.locator(".lotto-nav").filter({ hasText:"저장한 번호" }).click();
  await expect(page.locator(".lotto-full-history .lotto-history-row")).toHaveCount(1);
  await page.locator(".lotto-nav").filter({ hasText:"번호 뽑기" }).click();
  await page.locator(".lotto-toggle").filter({ hasText:"이전 번호 제외" }).locator("input").check();
  await page.locator(".lotto-draw").click();
  const nextGames = await page.locator(".lotto-game .lotto-ball").allTextContents();
  expect(nextGames.every(number => !firstGames.includes(number))).toBe(true);
  await page.locator(".lotto-toggle").filter({ hasText:"이전 번호 제외" }).locator("input").uncheck();
  await page.locator(".lotto-toggle").filter({ hasText:"공통 번호로 뽑기" }).locator("input").check();
  await expect(page.locator(".lotto-draw")).toBeDisabled();
  await expect(page.locator(".lotto-status")).toContainText("6개 이상");
  await page.locator(".lotto-toggle").filter({ hasText:"공통 번호로 뽑기" }).locator("input").uncheck();
  await page.locator(".lotto-number-details summary").click();
  await page.locator(".lotto-number").first().click();
  await expect(page.locator(".lotto-number").first()).toHaveAttribute("aria-pressed", "true");
  await page.locator(".lotto-chip").filter({ hasText:"1 ×" }).click();
  await expect(page.locator(".lotto-number").first()).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lotto-shell")).toHaveCount(0);
  await page.reload();
  await page.evaluate(() => window.openLottoPicker());
  await expect(page.locator(".lotto-history-rows .lotto-history-row")).toHaveCount(2);
  await page.locator(".lotto-nav").filter({ hasText:"저장한 번호" }).click();
  await expect(page.locator(".lotto-full-history .lotto-history-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("오프라인 단일 HTML에서도 중앙 배치와 번호 뽑기가 정상이다", async ({ page }) => {
  await page.setViewportSize({ width:1440, height:900 });
  await openLotto(page, "/classdock-offline.html");
  await checkLayout(page);
  await page.locator(".lotto-draw").click();
  await expect(page.locator(".lotto-game .lotto-ball-empty")).toHaveCount(0);
  await expect(page.locator(".lotto-history-rows .lotto-history-row")).toHaveCount(1);
  await checkLayout(page);
  if (process.env.CLASSDOCK_LOTTO_QA_DIR){
    fs.mkdirSync(process.env.CLASSDOCK_LOTTO_QA_DIR, { recursive:true });
    await page.locator(".lotto-shell").screenshot({ path:path.join(process.env.CLASSDOCK_LOTTO_QA_DIR, "offline-desktop.png"), animations:"disabled" });
  }
});

test("연금복권 탭: 모든 조 5장·조 지정·자리 고정·로또와 따로 쌓이는 기록", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("mn_onboarded_v1", "1"); });
  await page.goto("/");
  await page.locator("#commandPaletteOpen").click();
  await page.locator(".cmdk-input").fill("연금복권");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lotto-shell")).toHaveAttribute("data-game", "pension");
  await expect(page.locator(".lotto-kind").filter({ hasText:"연금복권" })).toHaveAttribute("aria-pressed", "true");
  const labels = () => page.locator(".lotto-game .lotto-balls").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  await page.locator(".lotto-group-choice").filter({ hasText:"모든 조" }).click();
  await expect(page.locator(".lotto-count").filter({ hasText:"1장" })).toBeDisabled();
  await page.locator(".lotto-draw").click();
  await expect(page.locator(".lotto-game")).toHaveCount(5);
  const all = await labels();
  expect(all.map(label => label.split(" ")[0])).toEqual(["1조", "2조", "3조", "4조", "5조"]);
  expect(new Set(all.map(label => label.slice(3))).size).toBe(1);
  await page.locator(".lotto-group-choice").filter({ hasText:"3조" }).click();
  await page.locator(".lotto-count").filter({ hasText:"2장" }).click();
  await page.locator(".lotto-fixed-cell select").last().selectOption("7");
  await page.locator(".lotto-draw").click();
  await expect(page.locator(".lotto-game")).toHaveCount(2);
  for (const label of await labels()){ expect(label.startsWith("3조 ")).toBe(true); expect(label.endsWith(" 7")).toBe(true); }
  await expect(page.locator(".lotto-history-rows .lotto-history-row")).toHaveCount(2);
  await page.locator(".lotto-kind").filter({ hasText:"로또" }).click();
  await expect(page.locator(".lotto-shell")).toHaveAttribute("data-game", "lotto");
  await expect(page.locator(".lotto-toggle").first()).toBeVisible();
  await expect(page.locator(".lotto-history-rows .lotto-history-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});
