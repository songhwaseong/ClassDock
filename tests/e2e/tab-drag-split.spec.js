const { test, expect } = require("@playwright/test");

// 탭 두 개를 열어둔 상태로 시작한다(탭바는 2개 이상일 때만 보인다).
async function openTwoDocs(page) {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await page.goto("/");
  // 한 번에 두 개를 넣으면 묶음으로 열려 탭이 하나만 생긴다 — 하나씩 열어 각각 탭을 만든다.
  await page.locator("#fileInput").setInputFiles(
    { name: "ref-note.txt", mimeType: "text/plain", buffer: Buffer.from("참고용 문서", "utf8") });
  await expect(page.locator("#activeFileName")).toHaveText("ref-note.txt");
  await page.locator("#fileInput").setInputFiles(
    { name: "work-note.txt", mimeType: "text/plain", buffer: Buffer.from("작업용 문서", "utf8") });
  await expect(page.locator("#activeFileName")).toHaveText("work-note.txt");
  await expect(page.locator("#tabBar .tab")).toHaveCount(2);
}

// 실제 리스너를 그대로 태운다 — Playwright 의 마우스 조작은 HTML5 드래그를 일으키지 못한다.
async function dragTabTo(page, tabName, fraction) {
  return page.evaluate(({ tabName, fraction }) => {
    const tab = [...document.querySelectorAll("#tabBar .tab")]
      .find(el => el.querySelector(".tab-name").textContent === tabName);
    if (!tab) throw new Error("탭을 찾지 못함: " + tabName);
    const dt = new DataTransfer();
    tab.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const zone = document.querySelector(".split-drop");
    if (!zone || zone.hidden) throw new Error("드롭 안내가 뜨지 않음");
    const rect = zone.getBoundingClientRect();
    const clientX = rect.left + rect.width * fraction;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, dataTransfer: dt, clientX, clientY };
    zone.dispatchEvent(new DragEvent("dragover", opts));
    const highlighted = zone.classList.contains("on-left") ? "left"
      : zone.classList.contains("on-right") ? "right" : null;
    zone.dispatchEvent(new DragEvent("drop", opts));
    tab.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    return { highlighted };
  }, { tabName, fraction });
}

// 사이드바 파일도 같은 드롭존 파이프라인을 탄다. 탭과 마찬가지로 실제 리스너를 태운다.
async function dragSidebarItemTo(page, fileName, fraction) {
  return page.evaluate(({ fileName, fraction }) => {
    const item = [...document.querySelectorAll("#sbList .sb-item")]
      .find(el => { const n = el.querySelector(".sb-name"); return n && n.textContent === fileName; });
    if (!item) throw new Error("사이드바 항목을 찾지 못함: " + fileName);
    if (!item.draggable) throw new Error("사이드바 항목이 draggable 이 아님: " + fileName);
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const zone = document.querySelector(".split-drop");
    if (!zone || zone.hidden) throw new Error("드롭 안내가 뜨지 않음");
    const rect = zone.getBoundingClientRect();
    const opts = { bubbles: true, dataTransfer: dt,
      clientX: rect.left + rect.width * fraction, clientY: rect.top + rect.height / 2 };
    zone.dispatchEvent(new DragEvent("dragover", opts));
    zone.dispatchEvent(new DragEvent("drop", opts));
    item.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  }, { fileName, fraction });
}

// 참고/작업 칸에 실제로 들어간 문서 이름 — 역할 상태(studyPdfId·activeId)를 그대로 읽는다.
const paneNames = (page) => page.evaluate(() => ({
  refName: (docs.find(d => d.id === studyPdfId) || {}).name || null,
  workName: (docs.find(d => d.id === activeId) || {}).name || null
}));

const tabNames = (page) => page.locator("#tabBar .tab .tab-name").allTextContents();

test("탭을 본문 왼쪽으로 끌면 그 문서가 참고 칸에 고정되고 분할로 들어간다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);
  await expect(page.locator("#content")).not.toHaveClass(/study-mode/);

  const { highlighted } = await dragTabTo(page, "ref-note.txt", 0.25);
  expect(highlighted).toBe("left");

  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  const panes = await paneNames(page);
  expect(panes.refName).toBe("ref-note.txt");     // 끌어온 문서가 참고 칸
  expect(panes.workName).toBe("work-note.txt");   // 보던 문서가 작업 칸
  expect(errors).toEqual([]);
});

test("탭을 본문 오른쪽으로 끌면 보던 문서가 참고로 고정되고 끌어온 문서가 작업 칸에 열린다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);
  // 지금 보고 있는 문서는 마지막에 연 work-note.txt — ref-note.txt 를 오른쪽(작업 칸)으로 끈다.
  const { highlighted } = await dragTabTo(page, "ref-note.txt", 0.75);
  expect(highlighted).toBe("right");

  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  const panes = await paneNames(page);
  expect(panes.refName).toBe("work-note.txt");
  expect(panes.workName).toBe("ref-note.txt");
  expect(errors).toEqual([]);
});

test("보던 문서의 탭을 참고 칸으로 끌면 직전에 보던 문서가 작업 칸 짝이 된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);
  // 활성 문서(work-note.txt) 자신의 탭을 왼쪽으로 → 짝(ref-note.txt)이 작업 칸에 와야 한다.
  await dragTabTo(page, "work-note.txt", 0.25);

  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  const panes = await paneNames(page);
  expect(panes.refName).toBe("work-note.txt");
  expect(panes.workName).toBe("ref-note.txt");
  expect(errors).toEqual([]);
});

test("분할 중 참고 문서의 탭을 작업 칸으로 끌면 좌우 역할이 교대된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);
  await dragTabTo(page, "ref-note.txt", 0.25);
  expect((await paneNames(page)).refName).toBe("ref-note.txt");

  await dragTabTo(page, "ref-note.txt", 0.75);   // 참고 문서를 작업 칸으로
  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  const panes = await paneNames(page);
  expect(panes.refName).toBe("work-note.txt");
  expect(panes.workName).toBe("ref-note.txt");
  expect(errors).toEqual([]);
});

test("드롭 안내는 탭 드래그 중에만 뜨고 끝나면 사라진다", async ({ page }) => {
  await openTwoDocs(page);
  await expect(page.locator(".split-drop")).toBeHidden();
  await dragTabTo(page, "ref-note.txt", 0.25);
  await expect(page.locator(".split-drop")).toBeHidden();   // dragend 후 정리
});

test("사이드바 파일을 본문 왼쪽으로 끌면 참고 칸에 고정되고 분할로 들어간다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);
  await dragSidebarItemTo(page, "ref-note.txt", 0.25);

  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  const panes = await paneNames(page);
  expect(panes.refName).toBe("ref-note.txt");     // 끌어온 파일이 참고 칸
  expect(panes.workName).toBe("work-note.txt");   // 보던 문서가 작업 칸
  expect(errors).toEqual([]);
});

test("탭에 없던 사이드바 파일을 참고 칸으로 끌어도 탭이 생긴다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);
  // ref-note.txt 를 탭바에서만 제거한다(파일은 사이드바에 남는다) → tabOrder 에서 빠진 상태
  await page.evaluate(() => untabDoc(docs.find(d => d.name === "ref-note.txt").id));
  expect(await tabNames(page)).not.toContain("ref-note.txt");

  await dragSidebarItemTo(page, "ref-note.txt", 0.25);   // 참고 칸(왼쪽)으로

  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  expect((await paneNames(page)).refName).toBe("ref-note.txt");
  expect(await tabNames(page)).toContain("ref-note.txt");   // 참고 칸 경로에서도 탭 복구
  expect(errors).toEqual([]);
});

test("사이드바 파일을 본문 오른쪽으로 끌면 작업 칸에 열리고 보던 문서가 참고가 된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTwoDocs(page);   // 보던 문서 = work-note.txt
  await dragSidebarItemTo(page, "ref-note.txt", 0.75);

  await expect(page.locator("#content")).toHaveClass(/study-mode/);
  const panes = await paneNames(page);
  expect(panes.refName).toBe("work-note.txt");
  expect(panes.workName).toBe("ref-note.txt");
  expect(errors).toEqual([]);
});
