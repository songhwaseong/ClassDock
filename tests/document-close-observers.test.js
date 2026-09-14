"use strict";

// 문서를 닫으면 그 문서에 붙인 크기·구조 관찰자(손바닥 도구·학습 화면 PDF 맞춤)를 끊어야 한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const documents = fs.readFileSync(path.join(__dirname, "../src/js/documents.js"), "utf8");

function sliceFunction(source, signature){
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature + " not found");
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 2);
}

function fakeObserverClass(log){
  return class {
    constructor(callback){ this.callback = callback; this.connected = false; log.push(this); }
    observe(){ this.connected = true; }
    disconnect(){ this.connected = false; }
  };
}

test("손바닥 도구와 학습 화면 관찰자는 문서를 닫을 때 모두 끊긴다", () => {
  const observers = [];
  const Observer = fakeObserverClass(observers);
  const context = vm.createContext({
    ResizeObserver:Observer, MutationObserver:Observer,
    setTimeout(){}, requestAnimationFrame(){ return 1; }, cancelAnimationFrame(){},
    byId(){ return null; }, fitStudyPanePdf(){}
  });
  vm.runInContext([
    sliceFunction(documents, "function updatePannableState(container){"),
    sliceFunction(documents, "function disconnectDocObservers(doc){"),
    sliceFunction(documents, "function attachPanBehavior(container){"),
    sliceFunction(documents, "function observeStudyPaneFit(doc){")
  ].join("\n"), context);

  const el = { scrollWidth:0, clientWidth:0, scrollHeight:0, clientHeight:0, isConnected:true,
    classList:{ toggle(){} }, addEventListener(){}, getBoundingClientRect(){ return { width:1, height:1 }; } };
  const doc = { kind:"pdf", el };
  context.attachPanBehavior(el);
  context.observeStudyPaneFit(doc);
  assert.equal(observers.length, 3);
  assert.ok(observers.every(observer => observer.connected), "관찰자가 붙어 있어야 한다");

  context.disconnectDocObservers(doc);
  assert.ok(observers.every(observer => !observer.connected), "닫은 문서의 관찰자가 남아 있다");
  assert.equal(el.__panRO, null);
  assert.equal(el.__panMO, null);
  assert.equal(doc._studyRO, null);
  // 두 번 닫혀도(또는 관찰자를 붙인 적 없는 문서여도) 오류가 나지 않는다.
  context.disconnectDocObservers(doc);
  context.disconnectDocObservers({ el:{} });
  context.disconnectDocObservers(null);
});

test("closeDoc 은 요소를 떼어 내기 전에 관찰자를 끊는다", () => {
  const close = sliceFunction(documents, "function closeDoc(id, options={}){");
  const disconnectAt = close.indexOf('if (typeof disconnectDocObservers === "function") disconnectDocObservers(d);');
  assert.ok(disconnectAt > 0, "closeDoc 에서 관찰자를 끊지 않는다");
  assert.ok(disconnectAt < close.indexOf("d.el.remove();"));
});
