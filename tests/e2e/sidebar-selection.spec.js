const { test, expect } = require("@playwright/test");

/* 사이드바 다중 선택과 일괄 작업.
 *
 * "탭 닫기"(앱에서만 치우기)와 "삭제"(디스크에서 지우기)는 결과가 완전히 다르므로,
 * 두 동작이 섞이지 않는 것과 지울 수 없는 파일에서 삭제가 잠기는 것을 함께 지킨다.
 * 실제 디스크 삭제는 폴더 권한이 있어야 해 자동화 브라우저에서 만들 수 없다.
 */

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

async function openFiles(page, names){
  await page.locator("#fileInput").setInputFiles(names.map((name) => ({
    name, mimeType: "text/plain", buffer: Buffer.from(name + " 내용\n", "utf8")
  })));
  await expect(page.locator("#sbList .sb-item")).toHaveCount(names.length);
}

const rows = (page) => page.locator("#sbList .sb-item");
const bar = (page) => page.locator("#sbSelectionBar");

test("Ctrl+클릭으로 여러 파일을 고르면 선택 바가 뜬다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt", "다.txt"]);
  await expect(bar(page)).toBeHidden();

  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("#sbSelectionCount")).toHaveText("1개 선택");

  await rows(page).nth(2).click({ modifiers: ["Control"] });
  await expect(page.locator("#sbSelectionCount")).toHaveText("2개 선택");
  await expect(rows(page).nth(0)).toHaveClass(/selected/);
  await expect(rows(page).nth(1)).not.toHaveClass(/selected/);
  await expect(rows(page).nth(2)).toHaveClass(/selected/);
});

test("Ctrl+클릭을 다시 하면 선택이 풀린다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt"]);
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await expect(bar(page)).toBeHidden();
  await expect(rows(page).nth(0)).not.toHaveClass(/selected/);
});

test("Shift+클릭은 기준 줄부터 범위를 고른다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt", "다.txt", "라.txt"]);
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await rows(page).nth(2).click({ modifiers: ["Shift"] });
  await expect(page.locator("#sbSelectionCount")).toHaveText("3개 선택");
  await expect(rows(page).nth(3)).not.toHaveClass(/selected/);
});

test("평범한 클릭과 Esc 는 선택을 푼다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt"]);
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await expect(bar(page)).toBeVisible();
  await rows(page).nth(1).click();                       // 평범한 클릭 = 그 파일 열기 + 선택 해제
  await expect(bar(page)).toBeHidden();
  await expect(page.locator("#activeFileName")).toHaveText("나.txt");

  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await expect(bar(page)).toBeVisible();
  await page.locator("#sbList").click({ position: { x: 5, y: 5 }, force: true });
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
});

test("'파일 닫기'는 고른 파일만 앱에서 치운다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt", "다.txt"]);
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await rows(page).nth(1).click({ modifiers: ["Control"] });
  await page.locator("#sbSelectionClose").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0)).toContainText("다.txt");
  await expect(bar(page)).toBeHidden();
});

test("폴더로 열지 않은 파일은 삭제 버튼이 잠긴다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt"]);
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  const del = page.locator("#sbSelectionDelete");
  await expect(del).toBeVisible();
  await expect(del).toBeDisabled();
  await expect(del).toHaveAttribute("title", /폴더 열기.*로 연 파일만/);
});

test("삭제할 수 없는 파일에는 팔레트에도 삭제 명령이 안 뜬다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt"]);
  await page.locator("#commandPaletteOpen").click();
  await page.locator(".cmdk-input").fill("삭제");
  const labels = await page.locator(".cmdk-item-label").allInnerTexts();
  expect(labels).not.toContain("현재 파일을 디스크에서 삭제");
});

test("파일을 닫으면 선택 목록에서도 함께 빠진다", async ({ page }) => {
  await boot(page);
  await openFiles(page, ["가.txt", "나.txt"]);
  await rows(page).nth(0).click({ modifiers: ["Control"] });
  await rows(page).nth(1).click({ modifiers: ["Control"] });
  await expect(page.locator("#sbSelectionCount")).toHaveText("2개 선택");
  // 다른 경로(탭 닫기 단축키)로 하나를 닫아도 선택 개수가 따라와야 한다.
  await page.evaluate(() => {
    const doc = docs.find((d) => d.name === "가.txt");
    closeDoc(doc.id, { forgetWorkspace: true });
  });
  await expect(page.locator("#sbSelectionCount")).toHaveText("1개 선택");
});

/* 실제 삭제 경로.
 * 진짜 폴더 권한은 자동화 브라우저에서 만들 수 없으므로, 표준 File System Access 와 같은 모양의
 * 폴더 핸들을 문서에 끼워 넣어 "removeEntry 를 부르고 뒤처리까지 하는지"를 확인한다. */
async function makeDeletableDoc(page, name){
  await openFiles(page, [name]);
  return page.evaluate((docName) => {
    const doc = docs.find((d) => d.name === docName);
    window.__removed = [];
    const dirHandle = {
      kind: "directory",
      async queryPermission(){ return "granted"; },
      async requestPermission(){ return "granted"; },
      async getFileHandle(n){ return { kind: "file", name: n, async getFile(){ return new File([""], n); } }; },
      async removeEntry(n){ window.__removed.push(n); }
    };
    doc.originalSaveMode = true;
    doc.fsDirHandle = dirHandle;
    doc.workspacePath = "수업/" + docName;
    // 폴더 루트 그룹을 만들어 원본 조작이 가능한 상태로 만든다.
    const group = navNodes.find((n) => n.type === "group") || null;
    if (!group){
      const made = makeGroup("folder", "수업", null);
      made.folderRefreshRootId = made.nodeId;
      made.originalSaveMode = true;
      made.folderHandle = dirHandle;
      made.expanded = true;                 // 접혀 있으면 안의 파일이 사이드바에 그려지지 않는다
      doc.parentId = made.nodeId;
      const node = navNodes.find((n) => n.type === "doc" && n.docId === doc.id);
      if (node) node.parentId = made.nodeId;
    }
    renderSidebar();
    return canDeleteOriginalDoc(doc);
  }, name);
}

test("삭제 가능한 파일은 확인을 거쳐 removeEntry 로 실제로 지운다", async ({ page }) => {
  await boot(page);
  expect(await makeDeletableDoc(page, "지울파일.txt")).toBe(true);

  await rows(page).filter({ hasText: "지울파일.txt" }).click({ modifiers: ["Control"] });
  const del = page.locator("#sbSelectionDelete");
  await expect(del).toBeEnabled();
  await del.click();

  // 되돌릴 수 없는 동작이므로 반드시 확인 창을 거쳐야 한다.
  await expect(page.locator("#confirmModal")).toBeVisible();
  await expect(page.locator("#confirmSub")).toContainText("되돌릴 수 없어요");
  await expect(page.locator("#confirmSub")).toContainText("지울파일.txt");
  await page.locator("#confirmOk").click();

  await expect.poll(() => page.evaluate(() => window.__removed)).toEqual(["지울파일.txt"]);
  await expect(rows(page)).toHaveCount(0);               // 앱에서도 함께 닫힌다
  await expect(page.getByText(/지웠어요/)).toBeVisible();
});

test("확인 창에서 취소하면 아무것도 지우지 않는다", async ({ page }) => {
  await boot(page);
  await makeDeletableDoc(page, "남길파일.txt");
  await rows(page).filter({ hasText: "남길파일.txt" }).click({ modifiers: ["Control"] });
  await page.locator("#sbSelectionDelete").click();
  await expect(page.locator("#confirmModal")).toBeVisible();
  await page.locator("#confirmCancel").click();
  expect(await page.evaluate(() => window.__removed)).toEqual([]);
  await expect(rows(page).filter({ hasText: "남길파일.txt" })).toHaveCount(1);   // 파일은 그대로 열려 있다
});

test("지운 파일은 최근 목록에서도 빠진다", async ({ page }) => {
  await boot(page);
  await makeDeletableDoc(page, "최근파일.txt");
  await page.evaluate(() => MNRecent.rememberFile("최근파일.txt", "수업/최근파일.txt"));
  expect(await page.evaluate(() => MNRecent.list().length)).toBe(1);

  await rows(page).filter({ hasText: "최근파일.txt" }).click({ modifiers: ["Control"] });
  await page.locator("#sbSelectionDelete").click();
  await page.locator("#confirmOk").click();
  await expect.poll(() => page.evaluate(() => MNRecent.list().length)).toBe(0);
});
