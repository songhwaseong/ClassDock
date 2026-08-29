const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("../../vendor/exceljs.min.js");

const IMAGE_FILES = [
  "008_광개토대왕릉비.png",
  "054_수원화성.png",
  "075_광주학생항일운동.png"
];
/* 이 검사는 저장소에 담지 않는 사진 자료(연대표-테스트자료)를 써서 진짜 그림이 든 xlsx 를 만든다.
   자료가 없는 작업 폴더에서는 ENOENT 로 실패해 "그림 배치가 깨졌다"로 잘못 읽히므로, 없으면 건너뛴다. */
const IMAGE_DIR = path.resolve("연대표-테스트자료", "연대표이미지");
const imagesReady = IMAGE_FILES.every((name) => fs.existsSync(path.join(IMAGE_DIR, name)));

async function imageLayoutWorkbook(){
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("역사");
  [12, 26, 11, 24, 37, 56, 12, 62, 10, 22].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  ["종류", "제목", "분류", "유적지", "유적지 주소", "설명 앞", "비고", "설명", "색상", "이미지"].forEach((value, index) => {
    sheet.getCell(1, index + 1).value = value;
  });
  const descriptions = [
    "주 지역에서 전개되는 여러 고대 국가의 역사와 연결되는 중요한 출발점으로 평가된다. 긴 설명이 원본처럼 여러 줄로 표시되어야 한다.",
    "왕조가 성장하면서 주변 세력과 교류하였고 이후 갈등이 심화되는 배경이 되었다. 이미지와 설명은 같은 행에 맞춰 보여야 한다.",
    "새로운 고대 국가가 발전하는 계기가 되었으며 문화와 제도를 정비하였다. 다음 행의 그림과 서로 겹치면 안 된다."
  ];
  descriptions.forEach((description, index) => {
    const rowNumber = index + 2;
    sheet.getRow(rowNumber).height = 81;
    sheet.getCell(rowNumber, 8).value = description;
    sheet.getCell(rowNumber, 8).alignment = { wrapText:true, vertical:"middle" };
    sheet.getCell(rowNumber, 9).value = ["purple", "green", "amber"][index];
    const imageId = workbook.addImage({
      buffer:fs.readFileSync(path.join(IMAGE_DIR, IMAGE_FILES[index])),
      extension:"png"
    });
    sheet.addImage(imageId, { tl:{ col:9, row:rowNumber - 1 }, ext:{ width:159, height:108 } });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("삽입 그림 시트는 원본 행·열 크기와 줄바꿈을 복원해 그림이 겹치지 않는다", async ({ page }) => {
  test.skip(!imagesReady, "사진 자료(연대표-테스트자료/연대표이미지)가 없어 건너뜁니다.");
  await page.setViewportSize({ width:1500, height:900 });
  await page.goto("/");
  await page.waitForTimeout(800);
  const onboarding = page.getByRole("button", { name:/시작하기|Get started/i });
  if (await onboarding.isVisible()) await onboarding.click();
  await page.locator("#fileInput").setInputFiles({
    name:"그림-레이아웃.xlsx",
    mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer:await imageLayoutWorkbook()
  });

  await expect(page.locator(".xlsx-floating-picture")).toHaveCount(3);
  await expect.poll(() => page.locator(".xlsx-floating-picture").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);

  const metrics = await page.locator(".xlsx-sheet").evaluate(sheetElement => {
    const table = sheetElement.querySelector("table");
    const rows = [...table.rows].filter(row => !row.classList.contains("sheet-col-row"));
    const images = [...sheetElement.querySelectorAll(".xlsx-floating-picture")].map(image => {
      const rect = image.getBoundingClientRect();
      return { top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height };
    });
    const wrapCell = sheetElement.querySelector('td[data-row="1"][data-col="7"]');
    const columns = [...table.querySelectorAll("colgroup col")].map(column => parseFloat(column.style.width) || 0);
    return {
      rowHeights:rows.slice(1, 4).map(row => row.getBoundingClientRect().height),
      imageRects:images,
      imageColumnWidth:columns[10],
      wrapWhiteSpace:wrapCell ? getComputedStyle(wrapCell).whiteSpace : "missing",
      wrapLineHeight:wrapCell ? wrapCell.getBoundingClientRect().height : 0
    };
  });

  expect(metrics.rowHeights).toEqual([108, 108, 108]);
  expect(metrics.imageColumnWidth).toBe(159);
  expect(metrics.wrapWhiteSpace).toBe("normal");
  expect(metrics.wrapLineHeight).toBe(108);
  metrics.imageRects.forEach(rect => {
    expect(rect.width).toBe(159);
    expect(rect.height).toBe(108);
  });
  for (let index = 0; index < metrics.imageRects.length - 1; index++){
    expect(metrics.imageRects[index].bottom).toBeLessThanOrEqual(metrics.imageRects[index + 1].top + 1);
  }

  await page.locator(".xlsx-sheet").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await page.screenshot({
    path:"C:/Users/ICT02-008/.codex/visualizations/2026/08/21/01a0221a-15e5-7740-874b-176e3db8908c/spreadsheet-image-layout.png"
  });
});
