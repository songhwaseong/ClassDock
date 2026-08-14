const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { collapseSidebar } = require("./helpers");

/* 시험지 한 바퀴: 선생님이 만들어 배포 → 학생이 풀고 서명·제출 → 선생님이 열어 채점.
 *
 * 이 흐름의 핵심은 "정답은 배포본에 없고, 제출본은 선생님 열쇠로만 열린다"는 것이라
 * 화면 조작뿐 아니라 실제로 내려받아진 파일의 내용까지 확인한다. */

const TEACHER_PASSWORD = "teacher-1234";

async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
}

async function downloadText(page, action){
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: fs.readFileSync(path, "utf8") };
}

// 배포본을 만들면 마지막에 "제출 기록 초기화 코드" 안내창이 뜬다 — 닫고 코드 문구를 돌려준다.
async function exportPaper(page, editor){
  const paper = await downloadText(page, async () => {
    await editor.locator(".btn", { hasText: "배포본 만들기" }).click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.locator("#confirmAlt").click();                    // 세 번째 버튼 "암호 없이 배포"
  });
  const notice = page.locator("#confirmModal");
  await expect(notice).toBeVisible();
  const text = await page.locator("#confirmSub").textContent();
  await page.locator("#confirmOk").click();
  await expect(notice).toBeHidden();
  const code = (text.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/) || [])[1] || "";
  return { ...paper, code };
}

async function typePassword(page, value, withConfirm){
  const modal = page.locator(".exam-pass-modal");
  await expect(modal).toBeVisible();
  const inputs = modal.locator('input[type="password"]');
  await inputs.nth(0).fill(value);
  if (withConfirm) await inputs.nth(1).fill(value);
  await modal.locator(".btn.primary").click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

test("시험지를 만들어 배포하고, 학생 제출본을 선생님 열쇠로 채점한다", async ({ page }) => {
  await boot(page);

  // --- 선생님: 시험지 만들기 ---
  await page.evaluate(() => window.newExamPaper());
  const editor = page.locator(".exam-edit");
  await expect(editor).toBeVisible();
  await editor.locator(".exam-meta-row input").nth(0).fill("e2e 쪽지시험");

  // 1번(객관식): 지문 · 보기 · 정답
  const first = editor.locator(".exam-item").nth(0);
  await first.locator(".exam-stem-input").fill("1 + 1 은?");
  const choices = first.locator(".exam-choice-input");
  for (let i = 0; i < 4; i++) await choices.nth(i).fill(String(i + 1));
  await first.locator('input[type="radio"]').nth(1).check();      // 정답 ② = 2

  // 2번(주관식)
  await editor.locator(".exam-bar .btn", { hasText: "주관식" }).click();
  const second = editor.locator(".exam-item").nth(1);
  await second.locator(".exam-stem-input").fill("광합성을 하는 기관은?");
  await second.locator(".exam-answer-field input").fill("잎|leaf");

  // --- 원본(.examkey) 저장: 선생님 암호 설정 ---
  const master = await downloadText(page, async () => {
    await editor.locator(".btn", { hasText: "원본 저장" }).click();
    await typePassword(page, TEACHER_PASSWORD, true);
  });
  expect(master.name).toBe("e2e 쪽지시험.examkey");
  const masterJson = JSON.parse(master.text);
  expect(masterJson.format).toBe("classdock-exam-master");
  expect(master.text).not.toContain("광합성");        // 원본은 통째로 잠긴다

  // --- 배포본(.exam) 내보내기: 열기 암호 없이 ---
  const paper = await exportPaper(page, editor);
  expect(paper.name).toBe("e2e 쪽지시험.exam");
  const paperJson = JSON.parse(paper.text);
  expect(paperJson.format).toBe("classdock-exam");
  expect(paperJson.publicJwk).toBeTruthy();
  expect(paperJson.privateJwk).toBeUndefined();
  expect(JSON.stringify(paperJson.items)).not.toMatch(/answerIndex|answerText/);
  expect(paper.text).not.toContain("leaf");                       // 정답 문자열이 배포본에 없다

  // --- 학생: 배포본 열어 풀기 ---
  await page.locator("#fileInput").setInputFiles({
    name: "e2e 쪽지시험.exam", mimeType: "application/json", buffer: Buffer.from(paper.text, "utf8")
  });
  const take = page.locator(".exam-take");
  await expect(take).toBeVisible();
  await expect(take.locator(".exam-progress")).toContainText("0 / 2");

  await take.locator(".exam-item").nth(0).locator('input[type="radio"]').nth(1).check();   // 정답
  await take.locator(".exam-short-input").fill(" 잎 ");                                    // 공백 포함 정답
  await expect(take.locator(".exam-progress")).toContainText("2 / 2");

  await take.locator(".exam-submit-box > .exam-field input[type='text']").fill("12 홍길동");
  const pad = take.locator(".exam-sign-pad");
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 30, { steps: 8 });
  await page.mouse.move(box.x + 200, box.y + box.height - 20, { steps: 8 });
  await page.mouse.up();

  const submitted = await downloadText(page, async () => {
    await take.locator(".exam-submit-btn").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.locator("#confirmOk").click();                     // "제출하기"
  });
  expect(submitted.name).toBe("e2e 쪽지시험_12 홍길동.examdone");
  const doneJson = JSON.parse(submitted.text);
  expect(doneJson.format).toBe("classdock-exam-result");
  expect(doneJson.seal.sealedKey).toBeTruthy();
  expect(submitted.text).not.toContain("잎");                     // 답안은 봉인 안에만 있다

  // 이 기기에서는 제출 화면이 잠기고 초안도 지워진다
  await expect(page.locator(".exam-done-panel")).toBeVisible();
  await expect(take.locator(".exam-submit-btn")).toHaveCount(0);
  const draftLeft = await page.evaluate((id) => localStorage.getItem("mn.exam." + id), paperJson.id);
  expect(draftLeft).toBeNull();

  // --- 선생님: 채점 ---
  await page.evaluate(() => window.openExamGrading(null));
  const grade = page.locator(".exam-grade");
  await expect(grade).toBeVisible();

  const [masterChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    grade.locator(".btn", { hasText: "원본" }).click()
  ]);
  await masterChooser.setFiles({ name: master.name, mimeType: "application/json", buffer: Buffer.from(master.text, "utf8") });
  await typePassword(page, TEACHER_PASSWORD, false);
  await expect(grade.locator(".exam-head-sub")).toContainText("e2e 쪽지시험");

  // 초기화 코드는 원본만 열면 언제든 다시 확인할 수 있다 — 배포할 때 알려 준 값 그대로다
  await grade.locator(".btn", { hasText: "초기화 코드" }).click();
  await expect(page.locator("#confirmSub")).toContainText(paper.code);
  await page.locator("#confirmOk").click();
  await expect(page.locator("#confirmModal")).toBeHidden();

  const [doneChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    grade.locator(".btn", { hasText: "제출본 추가" }).click()
  ]);
  await doneChooser.setFiles({ name: submitted.name, mimeType: "application/json", buffer: Buffer.from(submitted.text, "utf8") });

  const row = grade.locator(".exam-table tbody tr").first();
  await expect(row).toContainText("12 홍길동");
  await expect(row.locator(".exam-score")).toHaveText("2 / 2");    // 객관식 + 공백 무시 주관식

  // 답안 상세 — 서명과 정답 대조가 보이고, O/X 를 손으로 바꿀 수 있다
  await row.locator(".btn", { hasText: "답안 보기" }).click();
  const sheet = page.locator(".exam-sheet-modal");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".exam-sheet-sign img")).toBeVisible();
  await sheet.locator(".exam-mark-toggle").nth(0).click();
  await expect(sheet.locator(".exam-sheet-score")).toContainText("1 / 2");
  await sheet.locator(".modal-actions .btn.primary").click();
  await expect(row.locator(".exam-score")).toHaveText("1 / 2");

  // 성적 CSV — 옆에 "📚 누적 성적 CSV"(모든 시험 합본)가 나란히 있어 부분 일치로는 둘 다 잡힌다.
  // 아이콘 글자는 icons.js 가 SVG 로 바꿔 텍스트에서 사라지기도 하므로 "누적"만 배제한다.
  const csvBtn = grade.locator(".btn").filter({ hasText: "성적 CSV" }).filter({ hasNotText: "누적" });
  await expect(csvBtn).toHaveCount(1);
  const csv = await downloadText(page, () => csvBtn.click());
  expect(csv.name).toMatch(/^성적_e2e 쪽지시험_/);
  expect(csv.text).toContain("12 홍길동");
  expect(csv.text).toContain("1번");
});

test("열기 암호를 건 배포본과 잠긴 원본을 암호로만 연다", async ({ page }) => {
  await boot(page);

  // 파일 두 개를 앱 안의 포맷 함수로 직접 만들어(편집기 조작 없이) 여는 경로만 검사한다.
  const files = await page.evaluate(async () => {
    const item = { ...examNewItem("choice"), id: "q1", stem: "잠긴 시험 문항", answerIndex: 3 };
    item.choices = [{ text: "가", image: "" }, { text: "나", image: "" }, { text: "다", image: "" }];
    const items = [item];
    const keys = await examGenerateKeyPair();
    const stripped = examStripAnswers(items);
    const meta = { title: "잠금 시험", author: "김선생", createdAt: new Date().toISOString(), count: 1 };
    return {
      master: JSON.stringify({
        format: "classdock-exam-master", version: 1, id: "exam-locked", meta,
        enc: await examSealWithPassword({ items, keys }, "tpw-1234")
      }),
      paper: JSON.stringify({
        format: "classdock-exam", version: 1, id: "exam-locked", meta,
        itemsHash: await examSha256Hex(examCanonicalStringify(stripped)),
        publicJwk: keys.publicJwk, locked: true,
        enc: await examSealWithPassword({ items: stripped }, "open-9999")
      })
    };
  });
  expect(files.paper).not.toContain("answerIndex");

  // 학생: 틀린 암호로는 열리지 않고, 맞는 암호에서만 문항이 보인다
  await page.locator("#fileInput").setInputFiles({
    name: "잠금 시험.exam", mimeType: "application/json", buffer: Buffer.from(files.paper, "utf8")
  });
  await typePassword(page, "0000", false);
  await expect(page.locator(".exam-take")).toHaveCount(0);
  await typePassword(page, "open-9999", false);
  await expect(page.locator(".exam-take .exam-stem")).toHaveText("잠긴 시험 문항");

  // 선생님: 잠긴 원본을 다시 열면 정답까지 복원된다
  await page.locator("#fileInput").setInputFiles({
    name: "잠금 시험.examkey", mimeType: "application/json", buffer: Buffer.from(files.master, "utf8")
  });
  await typePassword(page, "tpw-1234", false);
  const editor = page.locator(".exam-edit");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".exam-meta-row input").nth(0)).toHaveValue("잠금 시험");
  await expect(editor.locator(".exam-item").nth(0).locator('input[type="radio"]').nth(2)).toBeChecked();
  await expect(editor.locator(".exam-answer-hint")).toContainText("정답: ③번");
});

test("문항 카드의 ＋ 버튼은 그 문항 바로 아래에 새 문항을 끼워 넣는다", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.newExamPaper());
  const editor = page.locator(".exam-edit");
  await expect(editor).toBeVisible();

  // 1번 지문을 채우고, 1번 카드의 ＋주관식 → 2번으로 들어가야 한다.
  const items = editor.locator(".exam-item");
  await items.nth(0).locator(".exam-stem-input").fill("첫 문항");
  await editor.locator(".exam-bar .btn", { hasText: "객관식" }).click();     // 맨 뒤에 하나(→ 2번)
  await items.nth(1).locator(".exam-stem-input").fill("끝 문항");
  await items.nth(0).locator(".exam-item-add .btn", { hasText: "주관식" }).click();

  await expect(items).toHaveCount(3);
  await expect(items.nth(1).locator(".exam-item-kind")).toHaveText("주관식");
  await expect(items.nth(1).locator(".exam-stem-input")).toHaveValue("");    // 새로 끼운 빈 문항
  await expect(items.nth(2).locator(".exam-stem-input")).toHaveValue("끝 문항");
  await expect(items.nth(1).locator(".exam-stem-input")).toBeFocused();      // 커서까지 새 문항으로
});

test("학생 화면의 그림은 눌러 크게 볼 수 있고, 보기 그림을 눌러도 답이 찍히지 않는다", async ({ page }) => {
  await boot(page);

  const paper = await page.evaluate(async () => {
    const draw = (bg) => {
      const c = document.createElement("canvas"); c.width = 240; c.height = 160;
      const g = c.getContext("2d"); g.fillStyle = bg; g.fillRect(0, 0, 240, 160);
      return c.toDataURL("image/png");
    };
    const keys = await examGenerateKeyPair();
    const items = [{
      ...examNewItem("choice"), id: "q1", stem: "그림을 보고 답하시오.",
      images: [draw("#fde68a")],
      choices: [
        { text: "가", image: draw("#bfdbfe") }, { text: "나", image: "" },
        { text: "다", image: "" }, { text: "라", image: "" }
      ],
      answerIndex: 1
    }];
    const stripped = examStripAnswers(items);
    return JSON.stringify({
      format: "classdock-exam", version: 1, id: "exam-zoom",
      meta: { title: "그림 시험", author: "", createdAt: new Date().toISOString(), count: items.length },
      itemsHash: await examSha256Hex(examCanonicalStringify(stripped)),
      publicJwk: keys.publicJwk, locked: false, items: stripped
    });
  });
  await page.locator("#fileInput").setInputFiles({
    name: "그림 시험.exam", mimeType: "application/json", buffer: Buffer.from(paper, "utf8")
  });
  await expect(page.locator(".exam-take")).toBeVisible();

  // 지문 그림 → 큰 창이 열리고 [닫기]로 사라진다
  const lightbox = page.locator(".plot-zoom");
  await page.locator(".exam-image-cell img").first().click();
  await expect(lightbox).toBeVisible();
  // 시험 중에는 문제 그림을 빼갈 수 없어야 한다
  await expect(page.locator("#plotZoomSave")).toBeHidden();
  await expect(page.locator("#plotZoomMemo")).toBeHidden();
  await page.locator("#plotZoomDone").click();
  await expect(lightbox).toBeHidden();

  // 보기 그림은 <label> 안에 있다 — 크게 보려고 눌렀는데 그 보기가 골라지면 안 된다
  await page.locator(".exam-take-choice-image").click();
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(page.locator('.exam-take-choice input[type="radio"]').first()).not.toBeChecked();
  expect(await page.evaluate(() => Object.keys(docs.find(d => d.examTake).examTake.answers).length)).toBe(0);

  // 시험지 밖(실행 결과 그래프 등)에서는 저장·메모 버튼이 그대로 있어야 한다 — 공용 확대 창이라 같이 죽으면 안 된다
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.className = "mn-zoomable"; img.id = "plainZoomProbe";
    img.src = document.querySelector(".exam-image-cell img").src;
    document.body.appendChild(img);
  });
  await page.locator("#plainZoomProbe").click();
  await expect(lightbox).toBeVisible();
  await expect(page.locator("#plotZoomSave")).toBeVisible();
  await expect(page.locator("#plotZoomMemo")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("서명하려고 끌어도 시험지 화면이 스크롤되지 않는다", async ({ page }) => {
  await boot(page);

  // 스크롤이 생길 만큼 긴 시험지를 만들어 연다(손바닥 드래그는 넘치는 문서에서만 동작한다).
  const paper = await page.evaluate(async () => {
    const keys = await examGenerateKeyPair();
    const items = [];
    for (let i = 0; i < 12; i++){
      const item = { ...examNewItem("short"), id: "q" + i, stem: (i + 1) + "번 문항입니다.", answerText: "답" };
      items.push(item);
    }
    const stripped = examStripAnswers(items);
    return JSON.stringify({
      format: "classdock-exam", version: 1, id: "exam-scroll",
      meta: { title: "스크롤 시험", author: "", createdAt: new Date().toISOString(), count: items.length },
      itemsHash: await examSha256Hex(examCanonicalStringify(stripped)),
      publicJwk: keys.publicJwk, locked: false, items: stripped
    });
  });
  await page.locator("#fileInput").setInputFiles({
    name: "스크롤 시험.exam", mimeType: "application/json", buffer: Buffer.from(paper, "utf8")
  });
  const take = page.locator(".exam-take");
  await expect(take).toBeVisible();

  const pad = take.locator(".exam-sign-pad");
  await pad.scrollIntoViewIfNeeded();
  const host = page.locator(".office:not([hidden])").last();
  const before = await host.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(120);                     // 위로 끌어올릴 여지가 있는 화면인지 확인

  // 위 → 아래로 끈다. 손바닥 드래그가 살아 있으면 scrollTop 이 끌린 만큼(약 90px) 줄어든다.
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 60, { steps: 10 });
  await page.mouse.move(box.x + 300, box.y + 105, { steps: 10 });
  await page.mouse.up();

  expect(await host.evaluate((el) => el.scrollTop)).toBe(before);
  const signed = await page.evaluate(() => (docs.find(d => d.examTake).examTake.signature || "").slice(0, 15));
  expect(signed).toBe("data:image/png;");                  // 스크롤 대신 서명이 그려졌다
});

// 폴더를 열면 그 안의 파일이 한꺼번에 열린다. 예전에는 .examkey 도 그때 바로 풀어서,
// 볼 생각도 없던 시험지 때문에 시작하자마자 암호를 묻고 — 일괄로 연 문서라 탭도 없어
// "암호를 넣었는데 아무것도 안 뜬다"가 됐다.
test("폴더 안의 시험지 원본은 폴더를 열 때가 아니라 열어 볼 때 암호를 묻는다", async ({ page }, testInfo) => {
  await boot(page);

  // 원본(.examkey) 하나를 만들어 폴더에 넣는다
  await page.evaluate(() => window.newExamPaper());
  const editor = page.locator(".exam-edit");
  await expect(editor).toBeVisible();
  await editor.locator(".exam-meta-row input").nth(0).fill("중간고사");
  await editor.locator(".exam-stem-input").first().fill("1 + 1 은?");
  const choices = editor.locator(".exam-choice-input");
  for (let i = 0; i < 4; i++) await choices.nth(i).fill(String(i + 1));
  await editor.locator('input[type="radio"]').nth(1).check();
  const master = await downloadText(page, async () => {
    await editor.locator(".btn", { hasText: "원본 저장" }).click();
    await typePassword(page, TEACHER_PASSWORD, true);
  });

  const dir = testInfo.outputPath("수업폴더");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/메모.txt", "수업 메모\n", "utf8");
  fs.writeFileSync(dir + "/중간고사.examkey", master.text, "utf8");
  await page.evaluate(() => { docs.slice().forEach(d => closeDoc(d.id, { skipUi: true })); });

  // 폴더만 열었을 때는 암호를 묻지 않는다 — 문서는 잠긴 채로만 만들어 둔다
  await page.locator("#folderInput").setInputFiles(dir);
  await expect(page.locator(".exam-item").first()).toBeHidden();
  await expect(page.locator(".exam-pass-modal")).toBeHidden();
  await expect.poll(() => page.evaluate(() => docs.filter(d => d.examLocked).length)).toBe(1);

  // 그 문서를 열면 그때 묻고, 암호를 넣으면 편집기가 뜬다
  await page.evaluate(() => { const d = docs.find(x => x.examLocked); setActiveDoc(d.id); });
  await typePassword(page, TEACHER_PASSWORD, false);
  await expect(editor.locator(".exam-item").first()).toBeVisible();
  await expect(editor.locator(".exam-stem-input").first()).toHaveValue("1 + 1 은?");
  expect(await page.evaluate(() => docs.filter(d => d.examLocked).length)).toBe(0);
});

test("잠긴 시험지에서 암호를 취소해도 다시 열 수 있는 안내가 남는다", async ({ page }, testInfo) => {
  await boot(page);
  await page.evaluate(() => window.newExamPaper());
  const editor = page.locator(".exam-edit");
  await expect(editor).toBeVisible();
  await editor.locator(".exam-meta-row input").nth(0).fill("기말고사");
  await editor.locator(".exam-stem-input").first().fill("2 + 2 는?");
  const choices = editor.locator(".exam-choice-input");
  for (let i = 0; i < 4; i++) await choices.nth(i).fill(String(i + 1));
  await editor.locator('input[type="radio"]').nth(3).check();
  const master = await downloadText(page, async () => {
    await editor.locator(".btn", { hasText: "원본 저장" }).click();
    await typePassword(page, TEACHER_PASSWORD, true);
  });

  const dir = testInfo.outputPath("취소폴더");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/기말고사.examkey", master.text, "utf8");
  await page.evaluate(() => { docs.slice().forEach(d => closeDoc(d.id, { skipUi: true })); });
  await page.locator("#folderInput").setInputFiles(dir);
  await expect.poll(() => page.evaluate(() => docs.filter(d => d.examLocked).length)).toBe(1);

  await page.evaluate(() => { const d = docs.find(x => x.examLocked); setActiveDoc(d.id); });
  const modal = page.locator(".exam-pass-modal");
  await expect(modal).toBeVisible();
  await modal.locator(".btn").filter({ hasText: "취소" }).click();
  await expect(modal).toBeHidden();

  // 빈 화면이 아니라 다시 열 수 있는 안내가 남아야 한다
  const openBtn = page.locator(".exam-locked-open");
  await expect(openBtn).toBeVisible();
  await openBtn.click();
  await typePassword(page, TEACHER_PASSWORD, false);
  await expect(editor.locator(".exam-item").first()).toBeVisible();
});

// 네트워크 제출은 편의 기능일 뿐이다. 선생님 PC 에 닿지 못했다고 학생 답안이 사라지면 안 된다 —
// 연결 실패는 파일로 떨어뜨려 제출을 확정하고, 코드가 틀린 경우처럼 고쳐서 다시 낼 수 있는
// 실패는 확정하지 않고 돌려보낸다.
test("선생님 PC 로 보내기가 실패하면 파일 제출로 떨어진다", async ({ page }) => {
  await boot(page);

  const paper = await page.evaluate(async () => {
    const keys = await examGenerateKeyPair();
    const items = [{ ...examNewItem("short"), id: "q1", stem: "1 + 1 은?", answerText: "2" }];
    const stripped = examStripAnswers(items);
    return JSON.stringify({
      format: "classdock-exam", version: 1, id: "exam-send",
      meta: { title: "보내기 시험", author: "", createdAt: new Date().toISOString(), count: items.length },
      itemsHash: await examSha256Hex(examCanonicalStringify(stripped)),
      publicJwk: keys.publicJwk, locked: false, items: stripped
    });
  });
  await page.locator("#fileInput").setInputFiles({
    name: "보내기 시험.exam", mimeType: "application/json", buffer: Buffer.from(paper, "utf8")
  });
  const take = page.locator(".exam-take");
  await expect(take).toBeVisible();

  await take.locator(".exam-short-input").fill("2");
  await take.locator(".exam-submit-box > .exam-field input[type='text']").fill("12 홍길동");
  const pad = take.locator(".exam-sign-pad");
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 30, { steps: 8 });
  await page.mouse.up();

  // 보내기를 켜면 주소·코드 칸이 나타난다
  const sendBox = take.locator(".exam-send-box");
  await sendBox.locator('input[type="checkbox"]').check();
  await expect(sendBox.locator(".exam-send-fields")).toBeVisible();

  // 코드가 6자리가 아니면 제출 자체를 확정하지 않는다(고쳐서 다시 낼 수 있는 실패)
  // 선생님 화면에 표시되는 것과 같은, 콜론 양쪽에 공백이 있는 주소도 그대로 받는다.
  await sendBox.locator('input[placeholder*="192.168"]').fill("192.168.0.12 : 17650");
  await sendBox.locator('input[placeholder="6자리"]').fill("12");
  await take.locator(".exam-submit-btn").click();
  await expect(page.locator("#confirmModal")).toBeVisible();
  await page.locator("#confirmOk").click();
  await expect(take.locator(".exam-submit-btn")).toBeVisible();          // 아직 제출 화면 그대로
  expect(await page.evaluate(() => docs.find(d => d.examTake).examTake.submitted)).toBe(false);

  // 코드는 맞췄지만 그 주소에 아무도 없다 → 파일로 저장하고 제출은 확정된다
  await sendBox.locator('input[placeholder="6자리"]').fill("123456");
  const saved = await downloadText(page, async () => {
    await take.locator(".exam-submit-btn").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.locator("#confirmOk").click();
  });
  expect(saved.name).toBe("보내기 시험_12 홍길동.examdone");
  expect(JSON.parse(saved.text).format).toBe("classdock-exam-result");
  await expect(take.locator(".exam-done-panel")).toBeVisible();
  expect(await page.evaluate(() => docs.find(d => d.examTake).examTake.submitted)).toBe(true);
});

test("다른 시험지의 열쇠로는 제출본을 열 수 없다", async ({ page }) => {
  await boot(page);
  const built = await page.evaluate(async () => {
    const keys = await window.examGenerateKeyPair();
    const stranger = await window.examGenerateKeyPair();
    const seal = await window.examSealForTeacher({ student: "홍길동", answers: [] }, keys.publicJwk);
    return {
      mine: !!(await window.examUnsealWithPrivate(seal, keys.privateJwk)),
      theirs: await window.examUnsealWithPrivate(seal, stranger.privateJwk)
    };
  });
  expect(built.mine).toBe(true);
  expect(built.theirs).toBeNull();
});

/* 제출 잠금은 시험지 id 로 걸리므로 배포본을 새로 만들어도 낸 기기에서는 계속 잠긴다.
 * 그 자물쇠를 여는 문이 완료 화면의 [제출 기록 초기화]인데, 학생이 혼자 열 수 있으면 잠금 자체가
 * 의미를 잃는다 — 선생님이 불러 준 코드나 '그 시험지의 원본 + 선생님 암호' 로만 풀리는지 확인한다. */
test("제출 기록 초기화는 선생님이 불러 준 코드나 원본+암호로만 풀린다", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => window.newExamPaper());
  const editor = page.locator(".exam-edit");
  await expect(editor).toBeVisible();
  await editor.locator(".exam-meta-row input").nth(0).fill("e2e 재응시");
  const first = editor.locator(".exam-item").nth(0);
  await first.locator(".exam-stem-input").fill("1 + 1 은?");
  const choices = first.locator(".exam-choice-input");
  for (let i = 0; i < 4; i++) await choices.nth(i).fill(String(i + 1));
  await first.locator('input[type="radio"]').nth(1).check();

  const master = await downloadText(page, async () => {
    await editor.locator(".btn", { hasText: "원본 저장" }).click();
    await typePassword(page, TEACHER_PASSWORD, true);
  });
  const paper = await exportPaper(page, editor);
  const paperId = JSON.parse(paper.text).id;
  expect(paper.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);        // 배포 직후 코드를 알려 준다
  expect(paper.text).not.toContain(paper.code.replace("-", ""));  // 배포본에는 지문만 들어간다

  // 이미 제출한 기기인 것처럼 완료 표식만 남겨 둔다(제출 흐름 자체는 위 시나리오에서 확인한다)
  await page.evaluate((id) => {
    localStorage.setItem("mn.examDone." + id, JSON.stringify({ at: "2026-08-05T05:22:30.000Z", student: "12 홍길동" }));
  }, paperId);
  await page.locator("#fileInput").setInputFiles({
    name: "e2e 재응시.exam", mimeType: "application/json", buffer: Buffer.from(paper.text, "utf8")
  });
  await expect(page.locator(".exam-done-panel")).toBeVisible();
  await expect(page.locator(".exam-submit-btn")).toHaveCount(0);

  const chooseMaster = async (text) => {
    await page.locator(".exam-done-reset").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#confirmAlt").click()                         // 세 번째 버튼 "원본 파일 고르기"
    ]);
    await chooser.setFiles({ name: "e2e 재응시.examkey", mimeType: "application/json", buffer: Buffer.from(text, "utf8") });
  };
  const typeCode = async (code) => {
    await page.locator(".exam-done-reset").click();
    await expect(page.locator("#confirmModal")).toBeVisible();
    await page.locator("#confirmOk").click();                     // "초기화 코드 넣기"
    await expect(page.locator("#textModal")).toBeVisible();
    await page.locator("#textInput").fill(code);
    await page.locator("#textOk").click();
  };
  // 시험지를 다시 열면 예전 탭의 문서도 DOM 에 남아 있어, 보이는 문서만 골라 확인한다.
  const stillLocked = async () => {
    await expect(page.locator(".exam-done-panel:visible")).toBeVisible();
    await expect(page.locator(".exam-submit-btn:visible")).toHaveCount(0);
    expect(await page.evaluate((id) => localStorage.getItem("mn.examDone." + id), paperId)).not.toBeNull();
  };

  // 1) 틀린 코드 — 다시 물어볼 뿐 풀리지 않는다
  await typeCode("ABCD-2345");
  await expect(page.locator("#textModal")).toBeVisible();         // 재입력 창
  await page.locator("#textCancel").click();
  await stillLocked();

  // 2) 다른 시험지의 원본 — 암호를 묻지도 않는다
  await chooseMaster(JSON.stringify({ ...JSON.parse(master.text), id: "다른-시험지" }));
  await expect(page.locator(".exam-pass-modal")).toHaveCount(0);
  await stillLocked();

  // 3) 원본은 맞지만 암호가 틀리면 역시 풀리지 않는다
  await chooseMaster(master.text);
  const modal = page.locator(".exam-pass-modal");
  await expect(modal).toBeVisible();
  await modal.locator('input[type="password"]').fill("아무-암호-9999");
  await modal.locator(".btn.primary").click();
  await expect(page.locator('.exam-pass-modal input[type="password"]')).toHaveValue("");  // 빈 칸 = 새로 물어본 창
  await page.locator(".exam-pass-modal .btn", { hasText: "취소" }).click();
  await expect(page.locator(".exam-pass-modal")).toHaveCount(0);
  await stillLocked();

  // 4) 선생님이 불러 준 코드 — 원본 파일 없이 풀린다
  await typeCode(paper.code);
  await expect(page.locator(".exam-done-panel:visible")).toHaveCount(0);
  await expect(page.locator(".exam-submit-btn:visible")).toBeVisible();
  expect(await page.evaluate((id) => localStorage.getItem("mn.examDone." + id), paperId)).toBeNull();

  // 5) 다시 잠긴 기기에서 원본 + 선생님 암호로도 풀린다
  await page.evaluate((id) => {
    localStorage.setItem("mn.examDone." + id, JSON.stringify({ at: "2026-08-05T05:22:30.000Z", student: "12 홍길동" }));
  }, paperId);
  await page.locator("#fileInput").setInputFiles({
    name: "e2e 재응시.exam", mimeType: "application/json", buffer: Buffer.from(paper.text, "utf8")
  });
  await stillLocked();
  await chooseMaster(master.text);
  await typePassword(page, TEACHER_PASSWORD, false);
  await expect(page.locator(".exam-done-panel:visible")).toHaveCount(0);
  await expect(page.locator(".exam-submit-btn:visible")).toBeVisible();
  expect(await page.evaluate((id) => localStorage.getItem("mn.examDone." + id), paperId)).toBeNull();
});
