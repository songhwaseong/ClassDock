const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

test("command palette opens and closes without console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.locator("#commandPaletteOpen").click();
  await expect(page.locator(".cmdk-overlay")).toBeVisible();
  await expect(page.locator(".cmdk-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cmdk-overlay")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a text document can be opened through the real file input", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("E2E regression content", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-note.txt");
  await expect(page.getByText("E2E regression content")).toBeVisible();
});

test("a large (>1MB) text file opens the lightweight editor and stays editable", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });   // 첫 실행 환영 모달이 클릭을 가로막지 않게 미리 끈다
  await collapseSidebar(page);
  await page.goto("/");
  // 1.2MB 남짓 — 편집 임계값(1MB) 초과 → 가벼운 편집기(B안)로 열려야 한다.
  const big = ("A".repeat(60) + "\n").repeat(20000);
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-big.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(big, "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-big.txt");
  // 읽기 전용 보기에서 [✎ 편집]을 눌러 편집 진입
  await page.getByRole("button", { name: /편집/ }).first().click();
  const lite = page.locator(".code-host-light .code-input");
  await expect(lite).toBeVisible();
  // 실제로 편집 가능한지: 맨 앞에 글자를 넣고 값이 반영되는지 확인
  await lite.click();
  await page.keyboard.press("Control+Home");   // 문서 맨 앞으로(클릭 위치가 아닌 절대 시작)
  await page.keyboard.type("ZZZ");
  await expect.poll(() => page.evaluate(() => document.querySelector(".code-host-light .code-input").value.slice(0, 3))).toBe("ZZZ");
  // 문서 내부 찾기(Ctrl+F)가 일치 부분을 강조 박스로 표시하는지 확인
  await lite.press("Control+f");
  const findInput = page.locator(".lite-find .ro-find-input");
  await expect(findInput).toBeVisible();
  await findInput.fill("AAA");
  await expect(page.locator(".lite-hit")).toBeVisible();
  await expect(page.locator(".lite-find .ro-find-count")).toContainText("/");
  expect(errors).toEqual([]);
});

test("in-editor find highlights Korean (full-width) matches at the correct position", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  // 3번째 줄에 한글 + 고유 검색어. 뒤에 채움 텍스트로 1MB(문자 수) 초과 → 경량 편집기.
  const marker = "먼저 쓰레기표적 뒤";
  const filler = "가나다라마바사아자차카타파하 리뷰 텍스트 채우기\n".repeat(60000);   // 넉넉히 100만 자 초과
  const content = "첫째 줄\n둘째 줄\n" + marker + "\n" + filler;
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-cjk.txt", mimeType: "text/plain", buffer: Buffer.from(content, "utf8")
  });
  await page.getByRole("button", { name: /편집/ }).first().click();
  const lite = page.locator(".code-host-light .code-input");
  await expect(lite).toBeVisible();
  await lite.press("Control+f");
  const findInput = page.locator(".lite-find .ro-find-input");
  await expect(findInput).toBeVisible();
  await findInput.fill("쓰레기표적");
  await expect(page.locator(".lite-hit")).toBeVisible();
  // 강조 박스가 3번째 줄에 있고, 왼쪽·폭이 독립 측정한 접두("먼저 ")·검색어 폭과 일치하는지(한글 전각 반영)
  const check = await page.evaluate(() => {
    const ta = document.querySelector(".code-host-light .code-input");
    const box = document.querySelector(".lite-hit");
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight), padTop = parseFloat(cs.paddingTop), padLeft = parseFloat(cs.paddingLeft);
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:-99999px;top:0";
    probe.style.fontFamily = cs.fontFamily; probe.style.fontSize = cs.fontSize; probe.style.fontWeight = cs.fontWeight;
    probe.style.letterSpacing = cs.letterSpacing; probe.style.fontFeatureSettings = cs.fontFeatureSettings; probe.style.fontKerning = cs.fontKerning;
    document.body.appendChild(probe);
    probe.textContent = "먼저 "; const prefixW = probe.getBoundingClientRect().width;
    probe.textContent = "쓰레기표적"; const matchW = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      boxTop: parseFloat(box.style.top), expectedTop: padTop + 2 * lh - ta.scrollTop,
      boxLeft: parseFloat(box.style.left), expectedLeft: padLeft + prefixW - ta.scrollLeft,
      boxWidth: parseFloat(box.style.width), matchW
    };
  });
  expect(Math.abs(check.boxTop - check.expectedTop)).toBeLessThan(2);
  expect(Math.abs(check.boxLeft - check.expectedLeft)).toBeLessThan(3);
  expect(Math.abs(check.boxWidth - check.matchW)).toBeLessThan(3);
  // IME 조합 중에는 검색이 돌지 않고(조합 방해 방지), 조합이 끝난 뒤에만 반영된다
  await findInput.fill("");
  await expect(page.locator(".lite-hit")).toBeHidden();
  await findInput.evaluate((el) => {
    el.value = "쓰";
    el.dispatchEvent(new CompositionEvent("compositionstart"));
    el.dispatchEvent(new InputEvent("input", { isComposing: true, bubbles: true }));
  });
  await expect(page.locator(".lite-hit")).toBeHidden();               // 조합 중 → 아직 강조 없음
  await findInput.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionend")));
  await expect(page.locator(".lite-hit")).toBeVisible();              // 조합 확정 → 강조 표시
  expect(errors).toEqual([]);
});

test("typing in the read-only text view switches straight into the editor", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-direct-edit.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello\nworld\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-direct-edit.txt");
  const pre = page.locator(".code-host-readonly .code-pre");
  await expect(pre).toBeVisible();
  // 본문 첫 줄을 클릭해 캐럿을 두고 바로 타이핑 → [✎ 편집] 없이 편집 모드로 전환 + 그 글자가 입력된다
  await pre.click({ position: { x: 30, y: 24 } });
  await page.keyboard.press("Z");
  const ta = page.locator(".code-host-edit .code-input");
  await expect(ta).toBeVisible();
  // 클릭한 위치(첫 줄 "hello" 안쪽)에 Z 가 들어갔는지 — 정확한 캐럿 컬럼은 렌더 폭에 따라 다르므로 앞 6자 안이면 통과
  await expect.poll(() => page.evaluate(() => document.querySelector(".code-host-edit .code-input").value.slice(0, 6))).toContain("Z");
  expect(errors).toEqual([]);
});

test("double-clicking a word in the read-only view enters edit with the word selected", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "e2e-dblclick-edit.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello\nworld\n", "utf8")
  });
  await expect(page.locator("#activeFileName")).toHaveText("e2e-dblclick-edit.txt");
  const pre = page.locator(".code-host-readonly .code-pre");
  await expect(pre).toBeVisible();
  await pre.dblclick({ position: { x: 30, y: 24 } });   // 첫 줄 "hello" 위 더블클릭
  const ta = page.locator(".code-host-edit .code-input");
  await expect(ta).toBeVisible();
  // 더블클릭으로 잡힌 단어("hello")가 편집기에서도 그대로 선택돼 있어야 한다
  const sel = await page.evaluate(() => {
    const el = document.querySelector(".code-host-edit .code-input");
    return el.value.slice(el.selectionStart, el.selectionEnd);
  });
  expect(sel).toBe("hello");
  expect(errors).toEqual([]);
});

test("a new whiteboard initializes its canvas through the module boundary", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });   // 환영 모달이 클릭을 가로막지 않게 미리 끈다
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#dzNew").click();          // '＋ 새로 만들기' 드롭다운 열기
  await page.locator("#dzNewBoard").click();      // 그 안의 '새 화이트보드' 항목
  await expect(page.locator(".wb-canvas")).toBeVisible();
  await expect(page.locator("#activeFileName")).not.toHaveText("");
  await expect.poll(() => page.evaluate(() => typeof MNBoardRenderer)).toBe("object");
});

test("two text files can be compared in the diff viewer", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles([
    { name: "diff-a.txt", mimeType: "text/plain", buffer: Buffer.from("line one\nsame line\nlast\n", "utf8") },
    { name: "diff-b.txt", mimeType: "text/plain", buffer: Buffer.from("line two\nsame line\nlast\nappended\n", "utf8") }
  ]);
  await expect(page.locator("#activeFileName")).not.toHaveText("");
  // 명령 팔레트 대신 전역 진입점을 직접 호출해 선택 모달을 연다(팔레트 흐름은 별도 테스트가 있음)
  await page.evaluate(() => window.openFileComparePicker());
  const modal = page.locator(".diff-pick-modal");
  await expect(modal).toBeVisible();
  await modal.locator("select").nth(0).selectOption({ label: "diff-a.txt" });
  await modal.locator("select").nth(1).selectOption({ label: "diff-b.txt" });
  await modal.locator("button.primary").click();
  // 비교 문서: 바뀐 줄은 좌우로 강조되고, 추가 줄은 오른쪽에만 나타난다
  await expect(page.locator("#activeFileName")).toHaveText("비교: diff-a.txt ⇄ diff-b.txt");
  const body = page.locator(".diff-body");
  await expect(body).toBeVisible();
  await expect(body.locator(".diff-cell.is-del")).toContainText("line one");
  await expect(body.locator(".diff-cell.is-ins .diff-mark").first()).toHaveText("two");
  await expect(body.locator(".diff-cell.is-ins").nth(1)).toHaveText("appended");
  await expect(page.locator(".diff-stats .diff-plus")).toHaveText("+2");
  await expect(page.locator(".diff-stats .diff-minus")).toHaveText("−1");
  // 한 줄(unified) 보기 전환도 동작해야 한다 (버튼 문구는 언어 설정에 따라 번역되므로 클래스로 찾는다)
  await page.locator(".diff-view-toggle").click();
  await expect(page.locator(".diff-body.diff-view-unified")).toBeVisible();
  expect(errors).toEqual([]);
});
