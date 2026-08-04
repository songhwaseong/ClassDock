const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

// 메모 목록(카드 격자)과 전 메모 검색.
// 화면 기준으로 확인한다: 목록이 탭을 없애지 않고 편집 영역 위에 덮이는지, 카드를 고르면 그 메모로 가는지,
// 검색이 제목·본문을 함께 걸러 내는지, Esc 가 메모창이 아니라 목록만 걷는지.

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

// 문서를 열기 전에는 도구막대의 메모 버튼이 숨어 있어 단축키로 연다.
async function openMemo(page){
  await page.keyboard.press("Control+m");
  await expect(page.locator("#scratchpad")).toBeVisible();
}

// 메모를 여러 개 만들어 둔다. [제목, 본문] 순서.
async function seedNotes(page, notes){
  for (let i = 0; i < notes.length; i++){
    if (i > 0) await page.locator("#scratchpadNew").click();
    const textarea = page.locator("#scratchpadEditor textarea").first();
    await textarea.click();
    await textarea.fill(notes[i][1]);
    await page.locator("#scratchpadRename").click();
    await page.locator("#textInput").fill(notes[i][0]);
    await page.locator("#textOk").click();
    await expect(page.locator(".scratchpad-tab-main", { hasText: notes[i][0] })).toHaveCount(1);
  }
}

const SEED = [
  ["수업 준비", "색연필 24색\n도화지 30장"],
  ["회의록", "예산 확인\n색연필 추가 주문"],
  ["할 일", "출석부 정리"]
];

test("목록 버튼은 탭을 그대로 둔 채 카드 격자를 덮고, 카드를 고르면 그 메모로 간다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await openMemo(page);
  await seedNotes(page, SEED);

  await page.locator("#scratchpadOverviewOpen").click();
  await expect(page.locator("#scratchpadOverview")).toBeVisible();
  await expect(page.locator("#scratchpadEditor")).toBeHidden();
  await expect(page.locator(".scratchpad-tabs")).toBeVisible();          // 탭은 없어지지 않는다
  await expect(page.locator(".scratchpad-card")).toHaveCount(3);
  await expect(page.locator("#scratchpadOverviewCount")).toHaveText("메모 3개");

  // 카드에는 제목과 본문 앞부분이 함께 보인다
  const first = page.locator(".scratchpad-card").first();
  await expect(first).toContainText("수업 준비");
  await expect(first).toContainText("색연필 24색");

  // 목록을 보는 동안에는 현재 메모를 고치는 도구를 잠근다
  const insertbar = page.locator(".scratchpad-insertbar");
  expect(await insertbar.evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");

  await page.locator(".scratchpad-card", { hasText: "회의록" }).click();
  await expect(page.locator("#scratchpadOverview")).toBeHidden();
  await expect(page.locator("#scratchpadEditor")).toBeVisible();
  await expect(page.locator("#scratchpadEditor textarea").first()).toHaveValue(/색연필 추가 주문/);
  await expect(page.locator(".scratchpad-tab.active .scratchpad-tab-main")).toHaveText("회의록");

  expect(errors).toEqual([]);
});

test("검색은 제목과 본문을 함께 걸러 내고 일치한 줄을 보여 준다", async ({ page }) => {
  await openApp(page);
  await openMemo(page);
  await seedNotes(page, SEED);
  await page.locator("#scratchpadOverviewOpen").click();

  const search = page.locator("#scratchpadSearch");
  await expect(search).toBeFocused();                                    // 열면 바로 칠 수 있다
  await search.fill("색연필");
  await expect(page.locator(".scratchpad-card")).toHaveCount(2);
  await expect(page.locator("#scratchpadOverviewCount")).toHaveText("메모 2개 찾음");
  await expect(page.locator(".scratchpad-card").nth(1)).toContainText("색연필 추가 주문");
  await expect(page.locator(".scratchpad-card").nth(1)).not.toContainText("예산 확인");   // 일치한 줄만
  await expect(page.locator(".scratchpad-card mark").first()).toHaveText("색연필");        // 찾은 말에 표시

  await search.fill("회의");                                             // 제목만 맞아도 남는다
  await expect(page.locator(".scratchpad-card")).toHaveCount(1);
  await expect(page.locator(".scratchpad-card").first()).toContainText("회의록");

  await search.fill("없는말");
  await expect(page.locator(".scratchpad-card")).toHaveCount(0);
  await expect(page.locator(".scratchpad-cards-empty")).toBeVisible();

  // Enter 는 첫 번째 결과로 바로 이동
  await search.fill("출석부");
  await search.press("Enter");
  await expect(page.locator("#scratchpadOverview")).toBeHidden();
  await expect(page.locator(".scratchpad-tab.active .scratchpad-tab-main")).toHaveText("할 일");
});

test("전체 내용 보기는 모든 메모 내용을 세로로 이어 보여 주고 카드에서 한 메모를 크게 연다", async ({ page }) => {
  await openApp(page);
  await openMemo(page);
  await seedNotes(page, [
    ["긴 메모", "첫 줄\n" + "중간 내용\n".repeat(8) + "마지막 줄"],
    ["둘째 메모", "두 번째 메모 전체 내용"]
  ]);
  await page.locator("#scratchpadOverviewOpen").click();

  const fullButton = page.locator("#scratchpadOverviewFull");
  await fullButton.click();
  await expect(fullButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#scratchpadCards")).toHaveClass(/full-content/);
  await expect(page.locator(".scratchpad-card").first()).toContainText("마지막 줄");
  await expect(page.locator(".scratchpad-card").nth(1)).toContainText("두 번째 메모 전체 내용");

  await page.locator(".scratchpad-card").nth(1).locator(".scratchpad-card-actions button", { hasText:"크게 보기" }).click();
  await expect(page.locator("#scratchpadOverview")).toBeVisible();
  await expect(page.locator("#scratchpad")).toHaveClass(/note-focus/);
  await expect(page.locator(".scratchpad-card")).toHaveCount(1);
  await expect(page.locator(".scratchpad-card")).toContainText("둘째 메모");
  await expect(page.locator(".scratchpad-card-enlarge")).toHaveText(/이전 크기/);
});

test("Esc 는 검색어 → 목록 순으로 걷고 메모창은 열어 둔다", async ({ page }) => {
  await openApp(page);
  await openMemo(page);
  await seedNotes(page, SEED.slice(0, 2));
  await page.locator("#scratchpadOverviewOpen").click();

  await page.locator("#scratchpadSearch").fill("색연필");
  await page.locator("#scratchpadSearch").press("Escape");
  await expect(page.locator("#scratchpadSearch")).toHaveValue("");        // 먼저 검색어만 지운다
  await expect(page.locator("#scratchpadOverview")).toBeVisible();

  await page.locator("#scratchpadSearch").press("Escape");
  await expect(page.locator("#scratchpadOverview")).toBeHidden();
  await expect(page.locator("#scratchpad")).toBeVisible();                // 메모창은 그대로

  await page.keyboard.press("Escape");
  await expect(page.locator("#scratchpad")).toBeHidden();                 // 이제야 메모창이 닫힌다

  // 다시 열면 늘 편집 화면부터
  await openMemo(page);
  await expect(page.locator("#scratchpadEditor")).toBeVisible();
  await expect(page.locator("#scratchpadOverview")).toBeHidden();
});

test("팔레트의 '메모 목록·검색'은 메모창을 열면서 바로 목록을 편다", async ({ page }) => {
  await openApp(page);
  await openMemo(page);
  await seedNotes(page, SEED.slice(0, 2));
  await page.keyboard.press("Escape");
  await expect(page.locator("#scratchpad")).toBeHidden();

  await page.locator("#commandPaletteOpen").click();
  await expect(page.locator(".cmdk-overlay")).toBeVisible();
  await page.locator(".cmdk-input").fill("메모 목록");
  await expect(page.locator(".cmdk-item-label").first()).toHaveText("메모 목록·검색");
  await page.keyboard.press("Enter");

  await expect(page.locator("#scratchpad")).toBeVisible();
  await expect(page.locator("#scratchpadOverview")).toBeVisible();
  await expect(page.locator(".scratchpad-card")).toHaveCount(2);
});
