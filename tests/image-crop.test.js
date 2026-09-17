const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/js/image-viewer.js"), "utf8");

function harness(){
  const canvases = [];
  const context = {
    Math, console, File, Blob,
    window: { addImagesToScratchpad: async () => {} },
    toast(){}, showLoading(){}, hideLoading(){},
    document: { createElement(tag){
      assert.equal(tag, "canvas");
      const calls = [];
      const ctx = Object.fromEntries(["save", "restore", "translate", "rotate", "scale", "beginPath", "arc", "clip", "drawImage"]
        .map(name => [name, (...args) => calls.push([name, ...args])]));
      const canvas = { width:0, height:0, calls, getContext: () => ctx,
        toBlob(fn, type){ this.blobType = type; fn(new Blob(["test"], { type })); } };
      canvases.push(canvas);
      return canvas;
    } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, canvases };
}

function state(shape){
  return { img:{ naturalWidth:100, naturalHeight:80 }, rotation:0, flipX:false, flipY:false,
    cropShape:shape, cropRect:{ x:12.7, y:10.8, w:30.9, h:30.9 }, shapes:[] };
}

test("원형 자르기는 정사각 픽셀 범위에 원형 마스크를 먼저 적용한다", () => {
  const { context } = harness();
  const input = { width:100, height:80 };
  const result = context.cropImageCanvas(input, state("circle").cropRect, "circle");
  assert.equal(result.width, 30);
  assert.equal(result.height, 30);
  assert.deepEqual(result.calls, [
    ["beginPath"], ["arc", 15, 15, 15, 0, Math.PI * 2], ["clip"],
    ["drawImage", input, 12, 10, 30, 30, 0, 0, 30, 30]
  ]);
});

test("이미지 경계에서도 원형은 정원을 유지하고 사각형은 기존 크기를 유지한다", () => {
  const { context } = harness();
  const input = { width:100, height:80 }, crop = { x:90, y:60, w:30, h:40 };
  const circle = context.cropImageCanvas(input, crop, "circle");
  assert.equal(circle.width, 10);
  assert.equal(circle.height, 10);
  const rect = context.cropImageCanvas(input, crop);
  assert.equal(rect.width, 10);
  assert.equal(rect.height, 20);
  assert.deepEqual(rect.calls, [["drawImage", input, 90, 60, 10, 20, 0, 0, 10, 20]]);
});

test("원형 선택은 적용 전 전체 이미지 렌더링을 잘라내지 않는다", () => {
  const { context } = harness();
  const full = context.renderForDisplay(state("circle"));
  assert.equal(full.width, 100);
  assert.equal(full.height, 80);
  assert.equal(full.calls.some(call => call[0] === "clip"), false);
  const cropped = context.renderEditedImage(state("circle"), state("circle").cropRect);
  assert.equal(cropped.calls.some(call => call[0] === "clip"), true);
});

test("메모 보내기는 적용 전 원형 선택도 PNG 마스크로 전달한다", () => {
  const { context, canvases } = harness();
  context.sendImageToMemo(state("circle"), { name:"photo.jpg" });
  const sent = canvases.at(-1);
  assert.equal(sent.blobType, "image/png");
  assert.equal(sent.calls.some(call => call[0] === "clip"), true);
  assert.equal(sent.width, sent.height);
});

test("OCR에도 원형 선택의 같은 마스크를 전달한다", async () => {
  const { context } = harness();
  let recognized;
  context.pdfOcrEnsureTesseract = async () => true;
  context.Tesseract = { createWorker: async () => ({
    recognize: async canvas => { recognized = canvas; return { data:{ text:"" } }; },
    terminate(){}
  }) };
  await context.extractImageText(state("circle"));
  assert.equal(recognized.calls.some(call => call[0] === "clip"), true);
  assert.equal(recognized.width, 30);
});
