const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 관계도 도구 배치(시안 C). 여기서만 확인할 수 있는 것 — 레일이 실제로 관계도 왼쪽에 세로로 서는지,
   위 줄에는 제목·찾기·되돌리기·인쇄·저장만 남는지, 오른쪽 아래에 떠 있는 확대 단추를 눌러도
   화면 끌기가 시작되지 않고 배율만 바뀌는지, 투명하게 덮은 효과 고르개가 그대로 값을 바꾸는지. */

const SOURCE = JSON.stringify({
  type:"classdock-concept", version:1, title:"물의 순환",
  nodes:[
    { id:"sun",   title:"햇빛",   category:"에너지", description:"바다를 데운다",       x:560,  y:420 },
    { id:"vapor", title:"수증기", category:"물질",   description:"공기 중으로 올라간다", x:1200, y:420 }
  ],
  edges:[{ id:"e1", from:"sun", to:"vapor", type:"cause", label:"데워서" }]
});

async function openConcept(page){
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name:"물의 순환.concept", mimeType:"application/json", buffer:Buffer.from(SOURCE, "utf8"),
  });
  await expect(page.locator(".concept-card")).toHaveCount(2);
}

test("만들기·정리·발표 도구는 왼쪽 세로 레일에 그림으로 서고, 위 줄은 제목·찾기·저장만 남는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openConcept(page);

  const rail = page.locator(".concept-rail");
  const labels = await rail.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  expect(labels).toEqual(["개념 추가", "관계 추가", "자동 정렬", "표·개요", "발표 순서", "큰 카드", "전개 발표"]);
  // 그림만 보인다 — 글자 칸은 남아 있지만 감춰져 있다
  for (const button of await rail.locator("button").all()){
    await expect(button.locator("svg.ui-icon")).toBeVisible();
    await expect(button.locator(".concept-tool-label")).toBeHidden();
  }
  // 세로로 선다: 단추들이 같은 x 에서 아래로 내려가고, 관계도 화면은 레일 오른쪽에 있다
  const boxes = await rail.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));
  for (let at = 1; at < boxes.length; at++){
    expect(Math.abs(boxes[at].x - boxes[0].x)).toBeLessThan(2);
    expect(boxes[at].y).toBeGreaterThan(boxes[at - 1].y);
  }
  const railBox = await rail.boundingBox();
  const viewBox = await page.locator(".concept-viewport").boundingBox();
  expect(viewBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 1);

  // 저장 단추 이름은 원본/사본 저장 방식에 따라 documents.js 가 바꾸므로 자리(맨 끝)만 본다
  const barButtons = await page.locator(".concept-bar button").evaluateAll((buttons) =>
    buttons.filter((button) => button.offsetParent).map((button) => button.classList.contains("run-save") ? "저장" : button.getAttribute("aria-label")));
  expect(barButtons).toEqual(["실행 취소", "다시 실행", "인쇄", "저장"]);
  await expect(page.locator(".concept-bar .concept-search")).toBeVisible();

  // 레일 단추는 예전처럼 동작한다
  await rail.locator("button", { hasText:"개념 추가" }).click();
  await expect(page.locator(".concept-modal-card")).toBeVisible();
  expect(errors).toEqual([]);
});

test("확대 단추는 관계도 오른쪽 아래에 떠 있고, 눌러도 화면을 끌지 않는다", async ({ page }) => {
  await openConcept(page);
  const zoom = page.locator(".concept-canvas > .concept-zoom-tools");
  const zoomBox = await zoom.boundingBox();
  const viewBox = await page.locator(".concept-viewport").boundingBox();
  expect(zoomBox.x + zoomBox.width).toBeGreaterThan(viewBox.x + viewBox.width - 40);
  expect(zoomBox.y + zoomBox.height).toBeGreaterThan(viewBox.y + viewBox.height - 40);

  const reset = zoom.locator("button").nth(1);
  const before = await page.locator(".concept-stage").evaluate((el) => el.style.transform);
  await zoom.locator("button").last().click();
  await expect(reset).not.toHaveText("100%");
  await expect(page.locator(".concept-viewport")).not.toHaveClass(/is-panning/);
  expect(await page.locator(".concept-stage").evaluate((el) => el.style.transform)).not.toBe(before);
});

test("효과 칸은 그림 위에 투명한 고르개를 덮어 그대로 값을 바꾼다", async ({ page }) => {
  await openConcept(page);
  const select = page.locator(".concept-rail .concept-rail-select select.concept-animation");
  const tool = await page.locator(".concept-rail-select").boundingBox();
  const box = await select.boundingBox();
  expect(Math.round(box.width)).toBe(Math.round(tool.width));      // 칸 전체를 덮는다 — 어디를 눌러도 열린다
  const values = await select.locator("option").evaluateAll((options) => options.map((option) => option.value));
  const next = values.find((value) => value !== "fade") || values[1];
  await select.selectOption(next);
  await expect(select).toHaveValue(next);
});
