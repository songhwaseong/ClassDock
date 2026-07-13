const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PDFLib = require("../vendor/pdf-lib.min.js");

function loadPdfPages(){
  const context = vm.createContext({
    console, PDFLib, setTimeout, clearTimeout,
    byId:() => null, recordPdfEdit:() => {}, toast:() => {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/js/pdf-pages.js"), "utf8"), context, { filename:"pdf-pages.js" });
  return context;
}

const name = (value) => PDFLib.PDFName.of(value);
const dictAt = (document, value) => document.context.lookup(value, PDFLib.PDFDict);

test("PDF 다운로드 결과에 한글 계층형 책갈피와 페이지 목적지를 기록한다", async () => {
  const { writePdfOutline } = loadPdfPages();
  const document = await PDFLib.PDFDocument.create();
  document.addPage(); document.addPage(); document.addPage();
  const chosen = [{ originalIndex:0 }, { originalIndex:1 }, { originalIndex:2 }];
  const outline = [
    { title:"1장 시작", originalIndex:0, items:[{ title:"1.1 내용", originalIndex:1, items:[] }] },
    { title:"2장 마무리", originalIndex:2, items:[] }
  ];

  assert.equal(writePdfOutline(document, outline, chosen), 3);
  const loaded = await PDFLib.PDFDocument.load(await document.save());
  const root = dictAt(loaded, loaded.catalog.get(name("Outlines")));
  const first = dictAt(loaded, root.get(name("First")));
  const child = dictAt(loaded, first.get(name("First")));
  const second = dictAt(loaded, first.get(name("Next")));

  assert.equal(root.get(name("Count")).asNumber(), 3);
  assert.equal(first.get(name("Title")).decodeText(), "1장 시작");
  assert.equal(child.get(name("Title")).decodeText(), "1.1 내용");
  assert.equal(second.get(name("Title")).decodeText(), "2장 마무리");
  assert.equal(first.get(name("Dest")).get(0).toString(), loaded.getPage(0).ref.toString());
  assert.equal(child.get(name("Dest")).get(0).toString(), loaded.getPage(1).ref.toString());
  assert.equal(loaded.catalog.get(name("PageMode")).toString(), "/UseOutlines");
});

test("페이지 추출 시 포함된 페이지의 책갈피만 새 PDF에 남긴다", async () => {
  const { writePdfOutline } = loadPdfPages();
  const document = await PDFLib.PDFDocument.create();
  document.addPage(); document.addPage();
  const outline = [
    { title:"남김", originalIndex:0, items:[] },
    { title:"제외", originalIndex:1, items:[] },
    { title:"마지막", originalIndex:2, items:[] }
  ];
  assert.equal(writePdfOutline(document, outline, [{ originalIndex:0 }, { originalIndex:2 }]), 2);
  const loaded = await PDFLib.PDFDocument.load(await document.save());
  const root = dictAt(loaded, loaded.catalog.get(name("Outlines")));
  const first = dictAt(loaded, root.get(name("First")));
  const second = dictAt(loaded, first.get(name("Next")));
  assert.equal(first.get(name("Title")).decodeText(), "남김");
  assert.equal(second.get(name("Title")).decodeText(), "마지막");
  assert.equal(second.get(name("Dest")).get(0).toString(), loaded.getPage(1).ref.toString());
});

test("책갈피 들여쓰기·내어쓰기·순서 이동과 페이지 삭제 보정을 수행한다", () => {
  const api = loadPdfPages();
  const outline = api.restorePdfOutlineItems([
    { title:"A", originalIndex:0, items:[] },
    { title:"B", originalIndex:1, items:[] },
    { title:"C", originalIndex:2, items:[] }
  ]);
  const doc = { kind:"pdf", pdfOutline:outline, selectedOutlineId:outline[1].id };

  assert.equal(api.indentPdfOutlineItem(doc), true);
  assert.deepEqual(Array.from(doc.pdfOutline, item => item.title), ["A", "C"]);
  assert.equal(doc.pdfOutline[0].items[0].title, "B");
  assert.equal(api.outdentPdfOutlineItem(doc), true);
  assert.deepEqual(Array.from(doc.pdfOutline, item => item.title), ["A", "B", "C"]);
  assert.equal(api.movePdfOutlineItem(doc, 1), true);
  assert.deepEqual(Array.from(doc.pdfOutline, item => item.title), ["A", "C", "B"]);

  doc.pdfOutline[0].items.push(api.restorePdfOutlineItems([{ title:"A 하위", originalIndex:2, items:[] }])[0]);
  api.removePdfOutlinePages(doc, new Set([0]));
  assert.deepEqual(Array.from(doc.pdfOutline, item => item.title), ["A 하위", "C", "B"]);
});
