const { test, expect } = require("@playwright/test");

const WS_KEY = "classdock-workspaces:v1";

// 작업공간 세 개를 심어 둔 채로 시작한다(순서를 바꿔 볼 대상이 필요하다).
async function openWithThreeWorkspaces(page){
  await page.addInitScript(({ key }) => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
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
  await expect(page.locator("#workspaceTabs .workspace-tab")).toHaveCount(3);
}

const tabNames = page => page.locator("#workspaceTabs .workspace-tab-name").allTextContents();
const savedNames = page => page.evaluate(key =>
  JSON.parse(localStorage.getItem(key)).items.map(row => row.name), WS_KEY);

// 실제 리스너를 그대로 태운다 — Playwright 의 마우스 조작은 HTML5 드래그를 일으키지 못한다.
async function dragWorkspaceTab(page, fromName, toName, side){
  return page.evaluate(({ fromName, toName, side }) => {
    const find = name => [...document.querySelectorAll("#workspaceTabs .workspace-tab")]
      .find(el => el.querySelector(".workspace-tab-name").textContent === name);
    const from = find(fromName), to = find(toName);
    if (!from || !to) throw new Error("작업공간 탭을 찾지 못함: " + fromName + " → " + toName);
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles:true, dataTransfer:dt }));
    const rect = to.getBoundingClientRect();
    const clientX = side === "after" ? rect.right - 2 : rect.left + 2;
    const opts = { bubbles:true, dataTransfer:dt, clientX, clientY:rect.top + rect.height / 2 };
    to.dispatchEvent(new DragEvent("dragover", opts));
    const marker = to.classList.contains("drop-after") ? "after"
      : to.classList.contains("drop-before") ? "before" : null;
    // 내부 드래그 표시가 없으면 자기 창 드롭이 파일 열기로 샌다.
    const internal = [...dt.types].includes("application/x-classdock-internal-drag");
    to.dispatchEvent(new DragEvent("drop", opts));
    from.dispatchEvent(new DragEvent("dragend", { bubbles:true, dataTransfer:dt }));
    return { marker, internal };
  }, { fromName, toName, side });
}

test("작업공간 탭을 드래그하면 순서가 바뀌고 다시 열어도 그대로다", async ({ page }) => {
  await openWithThreeWorkspaces(page);
  expect(await tabNames(page)).toEqual(["하나", "둘", "셋"]);

  const dropped = await dragWorkspaceTab(page, "하나", "셋", "after");
  expect(dropped).toEqual({ marker:"after", internal:true });
  await expect(page.locator("#workspaceTabs .workspace-tab-name").first()).toHaveText("둘");
  expect(await tabNames(page)).toEqual(["둘", "셋", "하나"]);
  // 순서만 바뀌고 활성 작업공간은 그대로여야 한다.
  await expect(page.locator("#workspaceTabs .workspace-tab.active .workspace-tab-name")).toHaveText("하나");
  expect(await savedNames(page)).toEqual(["둘", "셋", "하나"]);

  await page.reload();
  await expect(page.locator("#workspaceTabs .workspace-tab")).toHaveCount(3);
  expect(await tabNames(page)).toEqual(["둘", "셋", "하나"]);
});

test("좁은 창에서는 우클릭 메뉴의 왼쪽/오른쪽 옮기기로 순서를 바꾼다", async ({ page }) => {
  await openWithThreeWorkspaces(page);
  await page.setViewportSize({ width:700, height:800 });
  // 활성 탭만 남아 드래그로는 옮길 수 없는 폭이다.
  await expect(page.locator("#workspaceTabs .workspace-tab:visible")).toHaveCount(1);

  await page.locator('#workspaceTabs [data-workspace-id="one"]').click({ button:"right" });
  await expect(page.locator(".workspace-ctx-menu")).toBeVisible();
  // 맨 왼쪽이라 왼쪽으로 옮기기는 잠겨 있다.
  await expect(page.locator(".workspace-ctx-menu button", { hasText:"왼쪽으로 옮기기" })).toBeDisabled();
  await page.locator(".workspace-ctx-menu button", { hasText:"오른쪽으로 옮기기" }).click();
  expect(await savedNames(page)).toEqual(["둘", "하나", "셋"]);
  expect(await tabNames(page)).toEqual(["둘", "하나", "셋"]);
});
