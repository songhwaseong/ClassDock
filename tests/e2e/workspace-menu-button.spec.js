const { test, expect } = require("@playwright/test");

const WS_KEY = "classdock-workspaces:v1";

// 작업공간 세 개를 심어 둔 채로 시작한다(전환·순서 옮기기를 해 볼 대상이 필요하다).
async function openWithThreeWorkspaces(page){
  await page.addInitScript(({ key }) => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
      localStorage.setItem("sidebarCollapsed", "true");
      // 다시 열기(reload)로 저장이 살아남는지 보려면 처음 한 번만 심어야 한다 — addInitScript 는 매번 실행된다.
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
        version:1, activeId:"one",
        items:[{ id:"one", name:"하나", color:"blue", sidebarCollapsed:true },
               { id:"two", name:"둘", color:"green", sidebarCollapsed:true },
               { id:"three", name:"셋", color:"orange", sidebarCollapsed:true }]
      }));
    } catch(_){}
  }, { key: WS_KEY });
  await page.goto("/");
  await expect(page.locator("#workspaceMenuName")).toHaveText("하나");
}

const menu = page => page.locator(".workspace-ctx-menu");
const menuNames = page => page.locator(".workspace-ctx-menu button[data-workspace-id] .tcx-label").allTextContents();
const savedNames = page => page.evaluate(key =>
  JSON.parse(localStorage.getItem(key)).items.map(row => row.name), WS_KEY);

test("작업공간 버튼은 탭 줄 왼쪽에 있고 탭이 없어도 보인다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openWithThreeWorkspaces(page);

  // 헤더에는 작업공간 UI 가 없다.
  await expect(page.locator("header #workspaceMenuBtn")).toHaveCount(0);
  await expect(page.locator("#tabBar")).toBeVisible();
  await expect(page.locator("#docTabs .tab")).toHaveCount(0);
  const btn = page.locator("#tabBar #workspaceMenuBtn");
  await expect(btn).toBeVisible();
  // 문서 탭 칸보다 왼쪽에 있다.
  const btnBox = await btn.boundingBox();
  const tabsBox = await page.locator("#docTabs").boundingBox();
  expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(tabsBox.x);

  // 하나에 칠판을 열고, 빈 작업공간 둘로 옮겨도 버튼은 남아 있어 돌아올 수 있다.
  await page.keyboard.press("Alt+b");
  await expect(page.locator("#docTabs .tab")).toHaveCount(1);
  await btn.click();
  await expect(menu(page)).toBeVisible();
  await menu(page).locator('button[data-workspace-id="two"]').click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator("#workspaceMenuName")).toHaveText("둘");
  await expect(page.locator("#docTabs .tab")).toHaveCount(0);
  await expect(btn).toBeVisible();
  await expect(page.locator("#docTabs .tab-new-board")).toBeVisible();

  await btn.click();
  await menu(page).locator('button[data-workspace-id="one"]').click();
  await expect(page.locator("#workspaceMenuName")).toHaveText("하나");
  await expect(page.locator("#docTabs .tab")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("버튼을 누르면 바로 아래에 목록이 열리고 다시 누르면 닫힌다", async ({ page }) => {
  await openWithThreeWorkspaces(page);
  const btn = page.locator("#workspaceMenuBtn");
  await expect(btn).toHaveAttribute("aria-expanded", "false");
  await btn.click();
  await expect(menu(page)).toBeVisible();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  expect(await menuNames(page)).toEqual(["하나", "둘", "셋"]);
  await expect(menu(page).locator("button.is-active .tcx-label")).toHaveText("하나");

  const btnBox = await btn.boundingBox();
  const menuBox = await menu(page).boundingBox();
  expect(Math.abs(menuBox.x - btnBox.x)).toBeLessThan(2);
  expect(menuBox.y).toBeGreaterThanOrEqual(btnBox.y + btnBox.height);

  await btn.click();
  await expect(menu(page)).toHaveCount(0);
  await expect(btn).toHaveAttribute("aria-expanded", "false");

  // 바깥을 눌러도 닫힌다. 우클릭으로도 같은 메뉴가 열린다.
  await btn.click({ button:"right" });
  await expect(menu(page)).toBeVisible();
  await page.locator("main").click({ position:{ x:300, y:300 } });
  await expect(menu(page)).toHaveCount(0);
});

test("메뉴의 위/아래로 옮기기로 순서를 바꾸고 다시 열어도 그대로다", async ({ page }) => {
  await openWithThreeWorkspaces(page);
  const btn = page.locator("#workspaceMenuBtn");
  await btn.click();
  // 맨 위라 위로 옮기기는 잠겨 있다.
  await expect(menu(page).locator("button", { hasText:"위로 옮기기" })).toBeDisabled();
  await menu(page).locator("button", { hasText:"아래로 옮기기" }).click();
  expect(await savedNames(page)).toEqual(["둘", "하나", "셋"]);
  // 순서만 바뀌고 활성 작업공간은 그대로다.
  await expect(page.locator("#workspaceMenuName")).toHaveText("하나");

  await page.reload();
  await expect(page.locator("#workspaceMenuName")).toHaveText("하나");
  await btn.click();
  expect(await menuNames(page)).toEqual(["둘", "하나", "셋"]);
});

test("좁은 창에서도 버튼 하나로 전환한다", async ({ page }) => {
  await page.setViewportSize({ width:420, height:760 });
  await openWithThreeWorkspaces(page);
  const btn = page.locator("#workspaceMenuBtn");
  await expect(btn).toBeVisible();
  await btn.click();
  await menu(page).locator('button[data-workspace-id="three"]').click();
  await expect(page.locator("#workspaceMenuName")).toHaveText("셋");
});

test("키보드로 메뉴를 열고 고르고 닫는다", async ({ page }) => {
  await openWithThreeWorkspaces(page);
  const btn = page.locator("#workspaceMenuBtn");
  await btn.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page)).toBeVisible();
  // 지금 작업공간에 초점이 간다.
  await expect(menu(page).locator('button[data-workspace-id="one"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).locator('button[data-workspace-id="two"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(btn).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu(page).locator('button[data-workspace-id="one"]')).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspaceMenuName")).toHaveText("둘");
});
