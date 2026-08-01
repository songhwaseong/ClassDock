const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { buildPdf } = require("../fixtures/build-pdf");

// 최근 검색어(MNSearchHistory)의 DOM 쪽 동작. 저장 규칙 자체는 tests/search-history.test.js 가 지키고,
// 여기서는 실제 페이지에서만 확인할 수 있는 것들 — 언제 목록이 뜨고, 항목을 고르면 검색이 도는지,
// Esc 한 번이 목록만 닫는지(검색어·찾기 바는 살아 있는지), 문서를 옮겨도 마지막 검색어가 이어지는지 — 를 본다.

const seed = (page, value) => page.addInitScript((json) => {
  try {
    localStorage.setItem("mn_onboarded_v1", "1");
    localStorage.setItem("mn.searchHistory", json);
  } catch(_){}
}, JSON.stringify(value));

async function openTextDoc(page, name, body){
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(body, "utf8") });
  await expect(page.locator("#activeFileName")).toHaveText(name);
}

// .py 는 읽기 전용 보기를 거치지 않고 곧바로 편집기로 열린다.
async function openPy(page, name, body){
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({ name, mimeType: "text/x-python", buffer: Buffer.from(body, "utf8") });
  await expect(page.locator("textarea.code-input")).toBeVisible();
}

test.describe("사이드바 통합검색", () => {
  test("빈 검색창에 포커스가 오면 최근 검색어가 뜨고, 고르면 그 말로 검색한다", async ({ page }) => {
    await seed(page, { files: [{ q: "성적표" }, { q: "학생부" }] });
    await openTextDoc(page, "성적표-정리.txt", "학생부 요약\n성적표 초안");

    const panel = page.locator(".sb-search-history");
    await expect(panel).toBeHidden();
    const listTop = async () => (await page.locator("#sbList").boundingBox()).y;
    const before = await listTop();
    await page.locator("#sbSearch").focus();
    await expect(panel).toBeVisible();
    await expect(panel.locator(".search-history-pick")).toHaveText(["성적표", "학생부"]);
    // 목록은 파일 목록 위에 떠야 한다 — 흐름 안에 들어가면 검색어가 쌓일수록 파일이 아래로 밀린다.
    expect(await listTop()).toBe(before);
    expect(await page.evaluate(() => {
      const box = document.querySelector(".sb-search-history").getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
      return !!(hit && hit.closest(".sb-search-history"));
    })).toBe(true);

    await panel.locator(".search-history-pick", { hasText: "학생부" }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator("#sbSearch")).toHaveValue("학생부");
    // 고른 것이 맨 위로 올라간다(방금 쓴 것)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")).files[0].q)).toBe("학생부");
  });

  test("Enter 로 검색하면 기록에 남고, Esc 한 번은 목록만 닫는다", async ({ page }) => {
    await seed(page, {});
    await openTextDoc(page, "메모.txt", "요약 내용");

    const search = page.locator("#sbSearch");
    await search.fill("요약");
    await search.press("Enter");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")).files.map(r => r.q))).toEqual(["요약"]);

    // 검색창을 비우고 다시 포커스 → 목록이 뜬다. 첫 Esc 는 목록만 닫고 검색어를 지우지 않는다.
    await search.fill("");
    await search.focus();
    const panel = page.locator(".sb-search-history");
    await expect(panel).toBeVisible();
    await search.fill("요");
    await search.press("ArrowDown");
    await expect(panel).toBeVisible();
    await search.press("Escape");
    await expect(panel).toBeHidden();
    await expect(search).toHaveValue("요");        // 검색어는 그대로
    await search.press("Escape");
    await expect(search).toHaveValue("");          // 두 번째 Esc 는 원래대로 검색을 닫는다
  });

  test("기억을 끄면 목록이 뜨지 않고 새로 쌓이지도 않는다", async ({ page }) => {
    await seed(page, { files: [{ q: "성적표" }] });
    await page.addInitScript(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("pdfSignerSettings") || "{}");
        saved.searchHistory = false;
        localStorage.setItem("pdfSignerSettings", JSON.stringify(saved));
      } catch(_){}
    });
    await openTextDoc(page, "메모.txt", "요약 내용");

    await page.locator("#sbSearch").focus();
    await expect(page.locator(".sb-search-history")).toBeHidden();
    await page.locator("#sbSearch").fill("요약");
    await page.locator("#sbSearch").press("Enter");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")).files.map(r => r.q))).toEqual(["성적표"]);
  });
});

test.describe("편집기 찾기", () => {
  test("찾기 바를 열면 마지막 검색어가 채워지고 '최근' 버튼으로 목록을 본다", async ({ page }) => {
    // 저장 형식은 {q, m}(m = 찾기 옵션) — tests/search-history.test.js 와 같은 모양으로 심는다.
    await seed(page, { text: [{ q: "print", m: { case: true, word: false, regex: false } }, { q: "def" }] });
    await openPy(page, "hello.py", "print('hi')\ndef go(): pass\n");

    await page.locator("textarea.code-input").first().click();
    await page.keyboard.press("Control+f");
    const findInput = page.locator(".code-find-input").first();
    await expect(findInput).toBeVisible();
    await expect(findInput).toHaveValue("print");                       // 마지막으로 찾던 말
    await expect(page.locator('.code-find-opt[data-opt="case"]').first()).toHaveClass(/on/);   // 옵션까지 함께

    const panel = page.locator(".code-find .search-history").first();
    await expect(panel).toBeHidden();
    await page.locator(".search-history-toggle").first().click();
    await expect(panel).toBeVisible();
    await expect(panel.locator(".search-history-pick")).toHaveText(["print", "def"]);

    await panel.locator(".search-history-pick", { hasText: "def" }).click();
    await expect(findInput).toHaveValue("def");
    await expect(page.locator(".code-find-count").first()).toHaveText(/1\s*\/\s*1|1개/);
  });

  test("Enter 로 찾으면 옵션과 함께 기록에 남고, 항목을 지우면 목록에서 빠진다", async ({ page }) => {
    await seed(page, {});
    await openPy(page, "hello.py", "print('hi')\nPRINT('bye')\n");

    await page.locator("textarea.code-input").first().click();
    await page.keyboard.press("Control+f");
    const findInput = page.locator(".code-find-input").first();
    await findInput.fill("print");
    await page.locator('.code-find-opt[data-opt="case"]').first().click();   // 대소문자 구분 켜기
    await findInput.press("Enter");

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")).text[0]))
      .toEqual({ q: "print", m: { case: true, word: false, regex: false } });

    await page.locator(".search-history-toggle").first().click();
    const panel = page.locator(".code-find .search-history").first();
    await expect(panel.locator(".search-history-pick")).toHaveText(["print"]);
    await panel.locator(".search-history-del").first().click();
    await expect(panel).toBeHidden();                                        // 마지막 항목을 지우면 목록도 닫힌다
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory") || "{}").text || [])).toEqual([]);
  });

  test("실행 결과 찾기도 같은 목록(text)을 쓰고 마지막 검색어가 채워진다", async ({ page }) => {
    await seed(page, { text: [{ q: "hi" }] });
    await openPy(page, "hello.py", "print('hi')\n");

    // 결과 패널은 한 번 실행해야 열린다. 여기서 볼 것은 검색 목록 배선뿐이라
    // Pyodide 를 띄우는 대신 패널만 드러낸다(실행 결과가 있을 때와 같은 상태).
    await page.evaluate(() => document.querySelector(".run-split").classList.add("show-out"));
    await page.locator(".out-find-open").first().click();
    const outInput = page.locator(".out-find-input").first();
    await expect(outInput).toBeVisible();
    await expect(outInput).toHaveValue("hi");
    await outInput.fill("");
    await expect(page.locator(".out-find-bar .search-history").first()).toBeVisible();
  });

  test("'바꿀 내용'은 기억하지 않는다", async ({ page }) => {
    await seed(page, {});
    await openPy(page, "hello.py", "print('hi')\n");

    await page.locator("textarea.code-input").first().click();
    await page.keyboard.press("Control+f");
    await page.locator(".code-find-input").first().fill("print");
    await page.locator(".code-find-replace").first().fill("logging.info");
    await page.locator('.code-find-do[data-do="all"]').first().click();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")));
    expect(saved.text.map(row => row.q)).toEqual(["print"]);
    expect(JSON.stringify(saved)).not.toContain("logging.info");
  });
});

test.describe("구획이 다른 찾기 창", () => {
  test("PDF 찾기는 pdf 구획을 쓰고 마지막 검색어·옵션까지 되살린다", async ({ page }) => {
    await seed(page, {
      pdf: [{ q: "summary", m: { case: true, word: false, regex: false } }],
      text: [{ q: "코드에서 찾던 말" }]
    });
    await collapseSidebar(page);
    await page.goto("/");
    await page.locator("#fileInput").setInputFiles({
      name: "안내문.pdf",
      mimeType: "application/pdf",
      buffer: buildPdf([["report 2025 summary", "second line here"], ["page two summary"]])
    });
    await expect(page.locator("#activeFileName")).toHaveText("안내문.pdf");
    await expect(page.locator("#content .page").first()).toBeVisible();

    await page.keyboard.press("Control+f");
    const findInput = page.locator(".pdf-find-input");
    await expect(findInput).toBeVisible();
    await expect(findInput).toHaveValue("summary");                                   // 편집기 쪽 말이 넘어오지 않는다
    await expect(page.locator('.pdf-find-opt[data-opt="case"]')).toHaveClass(/on/);   // 옵션까지 함께
    await expect(page.locator(".pdf-find-count")).toHaveText(/2/);                    // 두 쪽에 하나씩

    // 새로 찾은 말은 pdf 구획에만 쌓인다.
    await findInput.fill("second");
    await findInput.press("Enter");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")));
    expect(saved.pdf.map(row => row.q)).toEqual(["second", "summary"]);
    expect(saved.text.map(row => row.q)).toEqual(["코드에서 찾던 말"]);

    await page.locator(".pdf-find .search-history-toggle").click();
    await expect(page.locator(".pdf-find .search-history-pick")).toHaveText(["second", "summary"]);
  });


  test("노트북 찾기는 notebook 구획에 쌓이고 편집기 목록과 섞이지 않는다", async ({ page }) => {
    await seed(page, { text: [{ q: "코드에서 찾던 말" }], notebook: [{ q: "노트북에서 찾던 말" }] });
    await collapseSidebar(page);
    await page.goto("/");
    await page.evaluate(() => newNotebookScratch());
    await expect(page.locator(".nbv-cell").first()).toBeVisible();
    await page.evaluate(() => nbOpenNotebookFind(docs.find(d => d.notebookModel)));

    const findInput = page.locator(".nbv-find-input");
    await expect(findInput).toHaveValue("노트북에서 찾던 말");   // 편집기 쪽 말이 넘어오지 않는다
    await page.locator(".nbv-find .search-history-toggle").click();
    await expect(page.locator(".nbv-find .search-history-pick")).toHaveText(["노트북에서 찾던 말"]);

    await findInput.fill("셀");
    await findInput.press("Enter");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mn.searchHistory")));
    expect(saved.notebook.map(row => row.q)).toEqual(["셀", "노트북에서 찾던 말"]);
    expect(saved.text.map(row => row.q)).toEqual(["코드에서 찾던 말"]);
  });

  test("여러 파일 찾아 바꾸기는 목록만 보여 주고 자동으로 채우지 않는다", async ({ page }) => {
    await seed(page, { batch: [{ q: "2025" }] });
    await openTextDoc(page, "안내문.txt", "2025년 안내\n2025학년도");

    await page.evaluate(() => window.openBatchReplace());   // 진입점은 명령 팔레트뿐이라 함수를 바로 부른다
    const findInput = page.locator(".batch-replace-field input").first();
    await expect(findInput).toHaveValue("");                    // 한꺼번에 바꾸는 창이라 자동으로 채우지 않는다

    await findInput.focus();
    const panel = page.locator(".batch-replace-form .search-history");
    await expect(panel).toBeVisible();
    // 이 창의 Esc 는 창을 닫지만, 목록이 열려 있는 동안에는 목록만 닫는다.
    await findInput.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.locator(".batch-replace-modal")).toBeVisible();   // 창은 그대로 살아 있다

    await findInput.press("ArrowDown");                                 // 다시 열어서 고른다
    await expect(panel).toBeVisible();
    await panel.locator(".search-history-pick", { hasText: "2025" }).click();
    await expect(findInput).toHaveValue("2025");
  });
});
