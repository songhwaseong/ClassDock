const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const { buildPdf } = require("../fixtures/build-pdf");

// PDF 가 든 폴더를 사이드바 ×로 닫으면 문서 위에 떠 있던 PDF 바(#pageCtl)도 사라져야 한다.
// closeGroup 이 activeId 만 0 으로 되돌리고 #content 의 pdf-active 를 남겨 두어, 시작 화면 위에
// 확대·페이지 컨트롤이 그대로 떠 있던 버그의 회귀 테스트.
test("PDF 가 든 폴더를 닫으면 떠 있던 PDF 바도 사라진다", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); } catch(_){} });
  await collapseSidebar(page);
  await page.goto("/");
  await page.locator("#fileInput").setInputFiles({
    name: "안내문.pdf", mimeType: "application/pdf", buffer: buildPdf([["page one"]])
  });
  await expect(page.locator("#activeFileName")).toHaveText("안내문.pdf");
  await expect(page.locator("#pageCtl")).toBeVisible();

  const groupId = await page.evaluate(() => {
    const group = makeGroup("folder", "수업", null);
    const doc = docs[0];
    doc.parentId = group.nodeId;
    navNodes.find(n => n.type === "doc" && n.docId === doc.id).parentId = group.nodeId;
    bumpNavTree();
    return group.nodeId;
  });
  await page.evaluate((id) => closeGroup(id), groupId);

  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#content")).not.toHaveClass(/pdf-active/);
  await expect(page.locator("#pageCtl")).toBeHidden();
});
