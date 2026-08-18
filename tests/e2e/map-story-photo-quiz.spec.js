const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 발표 모드 · 표시 사진 · 지도 문제(.task) — 배경 타일은 인터넷에서 받으므로 여기서도 기대하지 않는다. */
async function openApp(page){
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mn_onboarded_v1", "1");
      localStorage.setItem("uiLang", "ko");
      localStorage.setItem("mn.mapListPanel", "1");     // 목록을 편 채로 시작(순서 바꾸기 검사)
      localStorage.setItem("mn.studentName", "12 홍길동");
    } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

const mapModel = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
  return doc ? JSON.parse(JSON.stringify(doc.mapDoc)) : null;
});

// 표시를 하나 찍고 이름을 붙인다(말풍선이 겹치지 않게 닫은 것을 확인하고 나온다).
async function dropPin(page, name, dx, dy){
  const stage = page.locator(".map-stage");
  await page.locator(".map-add").click();
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.locator(".map-popup-label").last().fill(name);
  await page.evaluate(() => docs.find(d => d.kind === "map").mapInstance.closePopup());
  await expect(page.locator(".map-popup-label")).toHaveCount(0);
}

// 1×1 붉은 점 PNG — 사진 담기 경로(줄이기·JPEG 변환)를 태우기만 하면 되므로 가장 작은 그림을 쓴다.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

test("발표 모드는 목록 순서대로 돌고, 순서는 목록에서 바꾼다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await dropPin(page, "첫째 자리", -70, -40);
  await dropPin(page, "둘째 자리", 80, 50);
  await expect(page.locator(".map-list-item")).toHaveCount(2);

  // 두 번째 줄을 위로 올리면 문서의 표시 순서(=발표 순서)가 바뀐다.
  await page.locator(".map-list-item").nth(1).locator(".map-list-move").first().click();
  expect((await mapModel(page)).markers.map(m => m.label)).toEqual(["둘째 자리", "첫째 자리"]);

  await page.locator(".map-present-start").click();
  await expect(page.locator(".map-present")).toBeVisible();
  await expect(page.locator(".map-bar")).toBeHidden();              // 발표 중에는 도구막대를 감춘다
  await expect(page.locator(".map-present-name")).toHaveText("둘째 자리");
  await expect(page.locator(".map-present-count")).toHaveText("1 / 2");

  await page.locator(".map-present-next").click();
  await expect(page.locator(".map-present-name")).toHaveText("첫째 자리");
  await expect(page.locator(".map-present-count")).toHaveText("2 / 2");
  // 마지막에서 더 눌러도 넘어가지 않는다.
  await page.locator(".map-present-next").click();
  await expect(page.locator(".map-present-count")).toHaveText("2 / 2");

  await page.keyboard.press("Escape");
  await expect(page.locator(".map-present")).toBeHidden();
  await expect(page.locator(".map-bar")).toBeVisible();
  // 발표는 보기만 하는 일이라 문서를 고친 것으로 보지 않는다(순서를 바꾼 ● 는 그대로 남는다).
  await expect(page.locator(".map-status")).toContainText("저장 안 됨");

  expect(errors).toEqual([]);
});

test("표시에 넣은 사진은 지도 파일에 담기고 발표 카드에도 나온다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  // 표시를 찍고 말풍선을 연 채로 사진을 넣는다.
  const stage = page.locator(".map-stage");
  await page.locator(".map-add").click();
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(".map-popup-label").fill("답사 지점");
  await page.locator(".map-popup-photo input[type=file]").setInputFiles({
    name: "답사.png", mimeType: "image/png", buffer: TINY_PNG
  });

  await expect(page.locator(".map-popup-photo-img")).toBeVisible();
  const model = await mapModel(page);
  expect(model.markers[0].photo).toBeTruthy();
  // 사진은 늘 JPEG 로 줄여 담는다(휴대전화 사진이 원본대로 들어가면 파일이 열리지 않는다).
  expect(model.markers[0].photo.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  await expect(page.locator(".leaflet-marker-icon.has-photo")).toHaveCount(1);

  // 발표 카드에도 그 사진이 뜬다.
  await page.evaluate(() => docs.find(d => d.kind === "map").mapInstance.closePopup());
  await page.locator(".map-present-start").click();
  await expect(page.locator(".map-present-photo")).toBeVisible();
  await page.locator(".map-present-end").click();

  // 사진 빼기 → 모델에서도 빠진다.
  await page.locator(".leaflet-marker-icon").click();
  await page.locator(".map-popup-photo-remove").click();
  expect((await mapModel(page)).markers[0].photo).toBe(null);
  await expect(page.locator(".leaflet-marker-icon.has-photo")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("지도 문제는 지도를 눌러 답하고 거리로 채점한다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 선생님이 만든 .task 를 학생이 여는 것과 같은 길(handleFiles)로 연다.
  await page.evaluate(() => {
    const task = {
      format: "classdock-task", version: 1, id: "quiz-e2e", kind: "map",
      meta: { title: "우리 지역 찾기", author: "김선생", createdAt: new Date().toISOString() },
      problem: { md: "지도를 눌러 답해 보세요." },
      map: {
        basemap: "osm", center: [37.5665, 126.978], zoom: 15, grid: false,
        questions: [
          { id: "q1", prompt: "여기는 어디일까요?", lat: 37.5665, lng: 126.978, toleranceM: 500 },
          { id: "q2", prompt: "아주 먼 곳", lat: 33.5, lng: 126.5, toleranceM: 500 }
        ]
      }
    };
    return handleFiles([new File([JSON.stringify(task)], "우리 지역 찾기.task", { type:"application/json" })], {});
  });

  const taskBar = page.locator(".map-task-bar");
  await expect(taskBar).toBeVisible();
  await expect(page.locator(".map-bar")).toBeHidden();          // 학생 화면에는 편집 도구를 내놓지 않는다
  await expect(page.locator(".map-task-step")).toContainText("1/2");
  await expect(page.locator(".map-task-prompt")).toHaveText("여기는 어디일까요?");

  // 1번은 지도 한가운데(=정답 자리)를 눌러 맞히고, 2번은 같은 자리를 눌러 틀린다.
  const stage = page.locator(".map-stage");
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".map-answer-pin")).toHaveCount(1);
  await expect(page.locator(".map-task-state")).toContainText("답을 찍었어요");

  await page.locator(".map-task-next").click();
  await expect(page.locator(".map-task-prompt")).toHaveText("아주 먼 곳");
  await page.mouse.click(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30);
  await expect(page.locator(".map-answer-pin")).toHaveCount(2);

  await page.locator(".map-task-grade").click();
  await expect(page.locator(".map-task-score")).toHaveText("맞힘 1/2");

  // 학생이 찍은 답은 지도 문서(표시)로 새어 나가지 않는다 — 정답이 파일에 적히면 안 된다.
  expect((await mapModel(page)).markers).toEqual([]);

  expect(errors).toEqual([]);
});

test("지도 문제 제출본은 검수 화면에서 거리로 다시 채점된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);

  // 선생님 쪽: 원본 .task 를 연다(재채점 기준). 그 다음 학생 제출본(.taskdone)을 연다.
  await page.evaluate(async () => {
    const task = {
      format: "classdock-task", version: 1, id: "quiz-review", kind: "map",
      meta: { title: "제출 검수 시험", author: "김선생", createdAt: "2026-08-18T00:00:00.000Z" },
      problem: { md: "" },
      map: {
        basemap: "osm", center: [37.5665, 126.978], zoom: 13, grid: false,
        questions: [
          { id: "q1", prompt: "가까이", lat: 37.5665, lng: 126.978, toleranceM: 500 },
          { id: "q2", prompt: "멀리", lat: 35.1796, lng: 129.0756, toleranceM: 500 }
        ]
      }
    };
    await handleFiles([new File([JSON.stringify(task)], "제출 검수 시험.task", { type:"application/json" })], {});
    const submission = {
      format: "classdock-task-result", version: 1, kind: "map",
      taskId: "quiz-review", taskTitle: "제출 검수 시험", taskHash: "",
      student: "12 홍길동", code: "",
      answers: [{ id:"q1", lat:37.5670, lng:126.9785 }, { id:"q2", lat:37.5, lng:127 }],
      grade: { passed: 1, total: 2, results: [
        { name:"가까이", passed:true, actual:"70 m (허용 500 m)", error:"" },
        { name:"멀리", passed:false, actual:"325 km (허용 500 m)", error:"" }
      ] },
      gradedWith: "map-distance", submittedAt: "2026-08-18T01:00:00.000Z"
    };
    await handleFiles([new File([JSON.stringify(submission)], "제출 검수 시험_12 홍길동.taskdone", { type:"application/json" })], {});
  });

  const review = page.locator(".task-review");
  await expect(review).toBeVisible();
  // 지도 문제에는 코드가 없다 — 코드 상자 대신 학생이 찍은 답이 온다.
  await expect(page.locator(".task-review-code").first()).toBeHidden();
  await expect(page.locator(".task-review-mapanswers")).toBeVisible();
  await expect(page.locator(".task-review-mapanswers")).toContainText("37.56700");

  // 원본 문제가 열려 있으므로 재채점이 켜진다 — 코드 실행 없이 거리로 채점한다.
  const regrade = page.locator(".task-review-match .btn.primary");
  await expect(regrade).toBeEnabled();
  await regrade.click();
  await expect(page.locator(".task-review-compare")).toContainText("일치");
  await expect(page.locator(".task-review-mapanswers")).toContainText("허용");

  expect(errors).toEqual([]);
});

test("표시가 있는 지도에서 지도 문제 파일을 만들어 학생 화면으로 열어 본다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);

  await dropPin(page, "우리 학교", -60, -30);
  await dropPin(page, "도서관", 60, 40);

  await page.locator(".map-make-task").click();
  const modal = page.locator(".task-builder-modal");
  await expect(modal).toBeVisible();
  // 표시 이름이 문제 글의 기본값으로 들어온다.
  await expect(modal.locator(".task-builder-test-row")).toHaveCount(2);
  await expect(modal.locator(".task-builder-test-name").first()).toHaveValue("우리 학교");
  // 둘째 문제는 빼고, 첫 문제의 글을 고친다.
  await modal.locator(".task-builder-test-row").nth(1).locator("input[type=checkbox]").uncheck();
  await modal.locator(".task-builder-test-name").first().fill("우리가 다니는 학교는 어디일까요?");
  await modal.locator("input[type=text]").first().fill("우리 동네 찾기");

  await modal.getByRole("button", { name: /학생 화면 미리보기/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".map-task-bar")).toBeVisible();
  await expect(page.locator(".map-task-prompt")).toHaveText("우리가 다니는 학교는 어디일까요?");
  await expect(page.locator(".map-task-step")).toContainText("1/1");

  expect(errors).toEqual([]);
});
