"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/js/map-viewer.js"), "utf8");

// 실제 창과 삭제 처리기를 작은 DOM 계약 대역에서 실행한다. 브라우저·화면 캡처는 사용하지 않는다.
function harness({ nearby = true, empty = false, fullscreen = false } = {}){
  const document = { activeElement:null };
  class Element {
    constructor(tag){ this.tagName = tag; this.children = []; this.events = {}; this.attrs = {}; this.className = ""; this.parent = null; this.text = ""; }
    append(...nodes){ for (const node of nodes){ this.children.push(node); node.parent = this; } }
    appendChild(node){ this.append(node); return node; }
    setAttribute(name, value){ this.attrs[name] = String(value); }
    addEventListener(type, fn){ (this.events[type] ||= []).push(fn); }
    fire(type, detail = {}){
      let result;
      for (const fn of this.events[type] || []) result = fn({ target:this, ...detail });
      return result;
    }
    click(){ return this.fire("click"); }
    focus(){ document.activeElement = this; }
    remove(){ this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    get isConnected(){ return this === document.body || !!this.parent && this.parent.isConnected; }
    set textContent(value){ this.text = String(value); this.children = []; }
    get textContent(){ return this.text + this.children.map(node => node.textContent).join(""); }
    querySelectorAll(selector){
      const result = [];
      for (const node of this.children){
        if (selector.startsWith(".") ? node.className.split(/\s+/).includes(selector.slice(1)) : node.tagName === selector) result.push(node);
        result.push(...node.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector){ return this.querySelectorAll(selector)[0] || null; }
  }
  document.createElement = tag => new Element(tag);
  document.body = new Element("body");
  if (fullscreen){ document.fullscreenElement = new Element("div"); document.body.append(document.fullscreenElement); }
  const keys = new Set(), notices = [], statuses = [];
  const context = vm.createContext({
    document, window:{ addEventListener:(type, fn) => keys.add(fn), removeEventListener:(type, fn) => keys.delete(fn) },
    console, setTimeout, clearTimeout, location:{ protocol:"file:" }, navigator:{ onLine:true }
  });
  vm.runInContext(source, context);
  const api = vm.runInContext("({mapDocEmpty,mapNormalizeMarker,mapNormalizeShape})", context);
  const model = api.mapDocEmpty("정리할 지도");
  if (!empty){
    model.markers = ["direct-a", "direct-b", "near-a", "near-b", "near-c"].map(id => api.mapNormalizeMarker({
      id, lat:37.5, lng:127, source:nearby && id.startsWith("near") ? "nearby" : ""
    }));
    model.shapes = ["direct-shape", "near-shape"].map(id => api.mapNormalizeShape({
      id, type:"area", points:[[37,127], [37.1,127], [37.1,127.1]], source:nearby && id.startsWith("near") ? "nearby" : ""
    }));
  }
  const clear = new Element("button"); document.body.append(clear); clear.focus();
  const doc = { cleanupFns:[] };
  Object.assign(context, {
    model, doc, clearItemsBtn:clear,
    removeMarker(marker){ model.markers = model.markers.filter(item => item.id !== marker.id); },
    removeShape(shape){ model.shapes = model.shapes.filter(item => item.id !== shape.id); },
    setStatus:text => statuses.push(text), toast:text => notices.push(text)
  });
  const start = source.indexOf("  /* ── 한꺼번에 지우기 ──");
  const end = source.indexOf("  /* ── 주변 시설 ──", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  const host = document.fullscreenElement || document.body;
  const modal = () => host.querySelector(".map-clear-modal");
  const query = selector => modal().querySelector(selector);
  const key = (name, detail = {}) => {
    const event = { key:name, prevented:false, stopped:false, preventDefault(){ this.prevented = true; }, stopImmediatePropagation(){ this.stopped = true; }, ...detail };
    for (const fn of [...keys]) fn(event);
    return event;
  };
  return { context, document, model, clear, doc, keys, notices, statuses, host, modal, query, key };
}

test("목록형 지우기 창은 두 범위의 설명·실제 개수와 접근성 이름을 보여 준다", async () => {
  const h = harness(), pending = h.clear.click();
  assert.equal(h.query(".map-clear-title").textContent, "무엇을 지울까요?");
  assert.equal(h.query(".map-clear-summary").textContent, "표시 5개 · 거리선·면적 2개");
  const choices = h.modal().querySelectorAll(".map-clear-choice");
  assert.equal(choices.length, 2);
  assert.equal(choices[0].querySelector(".map-clear-label").textContent, "주변 시설만 지우기");
  assert.equal(choices[0].querySelector(".map-clear-description").textContent, "직접 만든 표시와 도형은 유지해요");
  assert.equal(choices[0].querySelector(".map-clear-count").textContent, "4개");
  assert.equal(choices[1].querySelector(".map-clear-count").textContent, "7개");
  assert.equal(h.document.activeElement, choices[0], "좁은 삭제 범위에 처음 초점을 둔다");
  const card = h.query(".map-clear-card");
  assert.equal(card.attrs.role, "dialog");
  assert.equal(card.attrs["aria-modal"], "true");
  assert.equal(card.attrs["aria-labelledby"], h.query(".map-clear-title").id);
  assert.equal(card.attrs["aria-describedby"], h.query(".map-clear-summary").id);
  assert.match(choices[0].querySelector(".map-clear-icon").innerHTML, /<svg/);
  h.query(".map-clear-cancel").click(); await pending;
  assert.equal(h.model.markers.length, 5);
});

test("주변 시설 줄을 누르면 주변 표시·반경 원만 지우고 직접 만든 항목은 유지한다", async () => {
  const h = harness(), pending = h.clear.click();
  h.query(".map-clear-nearby").click(); await pending;
  assert.deepEqual(h.model.markers.map(item => item.id), ["direct-a", "direct-b"]);
  assert.deepEqual(h.model.shapes.map(item => item.id), ["direct-shape"]);
  assert.deepEqual(h.notices, ["4개를 지웠습니다"]);
  assert.equal(h.modal(), null);
  assert.equal(h.keys.size, 0);
  assert.equal(h.doc.cleanupFns.length, 0);
  assert.equal(h.document.activeElement, h.clear);
});

test("모두 지우기 줄은 모든 표시·도형을 지우고 주변 시설이 없으면 그 줄만 나온다", async () => {
  for (const nearby of [true, false]){
    const h = harness({ nearby }), pending = h.clear.click();
    assert.equal(h.modal().querySelectorAll(".map-clear-choice").length, nearby ? 2 : 1);
    if (!nearby) assert.equal(h.document.activeElement, h.query(".map-clear-all"));
    h.query(".map-clear-all").click(); await pending;
    assert.equal(h.model.markers.length, 0); assert.equal(h.model.shapes.length, 0);
    assert.deepEqual(h.notices, ["7개를 지웠습니다"]);
  }
});

test("취소·Esc·창 바깥 클릭은 자료를 유지하고 창·키 수신기를 정리한다", async () => {
  for (const cancel of [h => h.query(".map-clear-cancel").click(), h => h.key("Escape"), h => h.modal().fire("mousedown")]){
    const h = harness(), pending = h.clear.click();
    h.query(".map-clear-choice").fire("mousedown");
    assert.ok(h.modal(), "창 안의 클릭은 취소하지 않는다");
    cancel(h); await pending;
    assert.equal(h.model.markers.length, 5); assert.equal(h.model.shapes.length, 2);
    assert.equal(h.modal(), null); assert.equal(h.keys.size, 0);
    assert.equal(h.doc.cleanupFns.length, 0); assert.deepEqual(h.notices, []);
    assert.equal(h.document.activeElement, h.clear);
  }
});

test("Tab 초점을 창 안에 가두고 Enter는 초점이 있는 줄 또는 취소만 실행한다", async () => {
  const h = harness(), pending = h.clear.click();
  const first = h.query(".map-clear-nearby"), cancel = h.query(".map-clear-cancel");
  assert.equal(h.key("Tab", { shiftKey:true }).prevented, true);
  assert.equal(h.document.activeElement, cancel);
  assert.equal(h.key("Tab").prevented, true); assert.equal(h.document.activeElement, first);
  assert.equal(h.key("z", { ctrlKey:true }).stopped, true, "지도 뒤의 되돌리기 단축키로 자료를 바꾸지 않는다");
  assert.equal(h.key("Enter", { repeat:true }).prevented, true); assert.ok(h.modal());
  cancel.focus(); h.key("Enter"); await pending;
  assert.equal(h.model.markers.length, 5);
  const allPending = h.clear.click(); h.query(".map-clear-all").focus(); h.key("Enter"); await allPending;
  assert.equal(h.model.markers.length, 0); assert.equal(h.model.shapes.length, 0);
});

test("처음 Enter는 주변 시설만 지우고 전체화면 내부에서도 같은 삭제 창을 연다", async () => {
  const h = harness({ fullscreen:true }), pending = h.clear.click();
  assert.equal(h.modal().parent, h.document.fullscreenElement);
  h.key("Enter"); await pending;
  assert.equal(h.model.markers.length, 2); assert.equal(h.model.shapes.length, 1);
});

test("중복으로 창을 열지 않고 지도 탭을 닫으면 삭제 없이 취소하며 다시 열 수 있다", async () => {
  const h = harness(), pending = h.clear.click();
  await h.clear.click();
  assert.equal(h.host.querySelectorAll(".map-clear-modal").length, 1);
  h.doc.cleanupFns.splice(0).forEach(fn => fn()); await pending;
  assert.equal(h.model.markers.length, 5); assert.equal(h.modal(), null); assert.equal(h.keys.size, 0);
  const next = h.clear.click(); assert.ok(h.modal()); h.key("Escape"); await next;
  assert.equal(h.doc.cleanupFns.length, 0);
});

test("빈 지도는 지우기 창을 열지 않고 기존 안내만 보여 준다", async () => {
  const h = harness({ empty:true }); await h.clear.click();
  assert.equal(h.modal(), null); assert.equal(h.keys.size, 0);
  assert.deepEqual(h.statuses, ["지울 표시나 도형이 없어요."]);
});
