const { test, expect } = require("@playwright/test");
const { buildWordDoc } = require("../fixtures/build-doc");

/* 구형 Word(.doc) 회귀 검사 — 실제 파일 입력을 거쳐 앱이 여는 경로를 그대로 탄다.
 * .doc 은 내용에 따라 세 갈래로 갈린다(file-loaders.js 의 docLegacyKindOf 분기).
 *   · 구형 바이너리(CFB)·RTF → 글자 미리보기(.doc-host)
 *   · 실은 텍스트           → 기존 텍스트 뷰(편집·저장 가능)
 * 배포본마다 스크립트 로드 방식이 달라 원본 HTML 과 단일 파일 양쪽에서 확인한다. */
const PAGES = [
  { name: "원본 HTML", url: "/" },
  { name: "단일 파일(EXE 산출물)", url: "/classdock-offline.html" }
];

async function openDoc(page, url, name, buffer){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await page.goto(url);
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/msword", buffer });
  await expect(page.locator("#activeFileName")).toHaveText(name);
}

for (const target of PAGES){
  test(`${target.name}: 구형 .doc 을 열면 본문 문단이 보인다`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const bytes = buildWordDoc({ text: "ClassDock 문서\r둘째 문단입니다\r" });
    await openDoc(page, target.url, "e2e-legacy.doc", Buffer.from(bytes));

    await expect(page.locator(".doc-host")).toBeVisible();
    await expect(page.locator(".doc-host .doc-p", { hasText: "ClassDock 문서" })).toBeVisible();
    await expect(page.locator(".doc-host .doc-p", { hasText: "둘째 문단입니다" })).toBeVisible();
    await expect(page.locator(".code-note")).toContainText("표·그림·서식은 빠지고");
    expect(errors).toEqual([]);
  });

  test(`${target.name}: 이름만 .doc 인 텍스트 파일은 텍스트 뷰로 열린다`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDoc(page, target.url, "e2e-fake.doc", Buffer.from("A1 20 A0 D5 2E 12\n두 번째 줄\n", "utf8"));

    await expect(page.getByText("A1 20 A0 D5 2E 12")).toBeVisible();
    await expect(page.locator(".doc-host")).toHaveCount(0);      // 구형 Word 미리보기로 잘못 가지 않는다
    expect(errors).toEqual([]);
  });
}

test("암호로 보호된 .doc 은 이유를 알려준다", async ({ page }) => {
  const bytes = buildWordDoc({ text: "secret\r", encrypted: true });
  await openDoc(page, "/", "e2e-locked.doc", Buffer.from(bytes));
  await expect(page.locator(".code-note")).toContainText("암호로 보호된");
});

test("이름만 .doc 인 RTF 는 글꼴표 대신 본문을 보여준다", async ({ page }) => {
  const rtf = "{\\rtf1\\ansi\\ansicpg949{\\fonttbl{\\f0\\froman Times New Roman;}}" +
              "{\\*\\generator Riched20 10.0;}\\f0 \\'c7\\'d1\\'b1\\'db \\'b9\\'ae\\'bc\\'ad\\par }";
  await openDoc(page, "/", "e2e-rtf.doc", Buffer.from(rtf, "latin1"));
  await expect(page.locator(".doc-host .doc-p", { hasText: "한글 문서" })).toBeVisible();
  await expect(page.locator(".doc-host")).not.toContainText("Times New Roman");
});

test("열지 않은 .doc 도 사이드바 내용 검색에 걸린다", async ({ page }) => {
  const bytes = buildWordDoc({ text: "검색용낱말\r다른 문단\r" });
  await openDoc(page, "/", "e2e-search.doc", Buffer.from(bytes));
  // 렌더된 화면이 아니라 파일에서 직접 뽑는 경로인지 확인한다(문서 객체만 넘겨 추출).
  const text = await page.evaluate(async () => {
    const target = docs.find(d => d.name === "e2e-search.doc");
    return await docLegacyExtractText(target.sourceFile);
  });
  expect(text).toContain("검색용낱말");
});
