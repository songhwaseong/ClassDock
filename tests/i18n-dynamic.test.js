"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");

// A small in-memory DOM exercises actual bindings and mutation handling without
// starting a browser, rendering a screen, or depending on installed UI software.
function harness(language = "en") {
  let listener, observer, observing = false;
  const pending = [];
  const record = value => { if (observing && value.target.isConnected) pending.push(value); };
  class Text {
    constructor(value) { this.nodeType = 3; this._value = value; this.parentNode = null; }
    get nodeValue() { return this._value; }
    set nodeValue(value) { this._value = value; record({ type: "characterData", target: this }); }
    get isConnected() { return !!this.parentNode && this.parentNode.isConnected; }
    get textContent() { return this.nodeValue; }
  }
  function matches(el, selector) {
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not && matches(el, not[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, "").trim();
    if (selector.startsWith(".")) return el.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith("#")) return el.getAttribute("id") === selector.slice(1);
    const attr = selector.match(/^\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/);
    if (attr) return attr[2] == null ? el.hasAttribute(attr[1]) : el.getAttribute(attr[1]) === attr[2];
    return selector === "*" || el.nodeName === selector.toUpperCase();
  }
  class Element {
    constructor(tag) { this.nodeType = 1; this.nodeName = tag.toUpperCase(); this.children = []; this.attrs = new Map(); this.parentNode = null; this.className = ""; this.dataset = {}; }
    get isConnected() { return this === document.documentElement || !!this.parentNode && this.parentNode.isConnected; }
    get textContent() { return this.children.map(n => n.textContent).join(""); }
    set textContent(value) {
      this.children.forEach(n => { n.parentNode = null; }); this.children = [];
      this.append(new Text(value));
    }
    append(node) { node.parentNode = this; this.children.push(node); record({ type: "childList", target: this, addedNodes: [node] }); }
    setAttribute(key, value) { this.attrs.set(key, String(value)); record({ type: "attributes", target: this, attributeName: key }); }
    hasAttribute(key) { return this.attrs.has(key); }
    getAttribute(key) { return this.attrs.has(key) ? this.attrs.get(key) : null; }
    closest(selector) {
      for (let el = this; el; el = el.parentNode)
        if (selector.split(",").some(part => matches(el, part.trim()))) return el;
      return null;
    }
    querySelectorAll(selector) {
      const all = [];
      for (const child of this.children) if (child.nodeType === 1) {
        if (matches(child, selector)) all.push(child);
        all.push(...child.querySelectorAll(selector));
      }
      return all;
    }
    addEventListener() {}
  }
  const document = {
    readyState: "loading", title: "ClassDock",
    addEventListener(type, callback) { if (type === "DOMContentLoaded") listener = callback; },
    getElementById() { return null; },
    createTreeWalker(root, mask, filter) {
      const texts = [];
      const walk = node => { for (const child of node.children || []) { if (child.nodeType === 3) texts.push(child); else walk(child); } };
      walk(root); let index = 0;
      return { nextNode() { while (index < texts.length) { const n = texts[index++]; if (filter.acceptNode(n) === 1) return n; } return null; } };
    }
  };
  document.documentElement = new Element("html"); document.body = new Element("body");
  document.documentElement.append(document.body);
  const window = { dispatchEvent() {} };
  vm.runInNewContext(source, {
    document, window, navigator: { language }, localStorage: { getItem: () => language, setItem() {} },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() { observing = true; } }
  });
  const element = (tag, value, parent = document.body) => { const el = new Element(tag); if (value != null) el.textContent = value; if (parent) parent.append(el); return el; };
  const flush = () => {
    let loops = 0;
    while (pending.length) {
      assert.ok(++loops < 12, "translation mutations must converge");
      observer(pending.splice(0));
    }
  };
  return { api: window.MNI18N, document, element, ready: () => listener(), flush };
}

test("known missing labels and variable messages translate without changing document names", () => {
  const { api } = harness();
  assert.equal(api.t("편집 도구"), "Editing tools");
  assert.equal(api.t("문서 ▾"), "Document ▾");
  assert.equal(api.t("  로그 복사  "), "  Copy logs  ");
  assert.equal(api.t("3개 문단 고침"), "3 paragraphs edited");
  assert.equal(api.t("서명 지우개"), "서명 지우개", "count templates must not match words ending in 개");
  assert.equal(api.t("2분"), "2분", "note duration translations must stay scoped to music controls");
  assert.equal(api.tf("{name} 로 내보냈어요.", { name: "내 한글 문서.pdf" }), "Exported as 내 한글 문서.pdf.");
});

test("late menus, nested labels and reused tooltips survive EN/KO/EN switching", () => {
  const h = harness(); h.ready();
  const button = h.element("button", "편집 도구");
  button.setAttribute("title", "DOCX 편집 도움말"); h.flush();
  assert.equal(button.textContent, "Editing tools");
  assert.equal(button.getAttribute("title"), "DOCX editing help");
  h.api.setLang("ko"); h.flush(); assert.equal(button.textContent, "편집 도구");
  h.api.setLang("en"); h.flush(); assert.equal(button.textContent, "Editing tools");
  button.textContent = "서식 복사"; button.setAttribute("title", "서식 지우기"); h.flush();
  assert.equal(button.textContent, "Copy formatting");
  assert.equal(button.getAttribute("title"), "Clear formatting");
  h.api.setLang("ko"); h.flush();
  assert.equal(button.textContent, "서식 복사", "must not resurrect an old state");
  assert.equal(button.getAttribute("title"), "서식 지우기");
});

test("direct character edits and unknown states do not restore stale translations", () => {
  const h = harness(); const el = h.element("button", "서식 복사"); h.ready();
  el.children[0].nodeValue = "서식 지우기"; h.flush();
  assert.equal(el.textContent, "Clear formatting");
  el.children[0].nodeValue = "사용자 고유 제목"; h.flush();
  h.api.setLang("ko"); h.flush(); h.api.setLang("en"); h.flush();
  assert.equal(el.textContent, "사용자 고유 제목");
});

test("document text, editable contents, cell values and ignored controls are preserved", () => {
  const h = harness();
  const editable = h.element("div", null); editable.setAttribute("contenteditable", "true");
  const userButton = h.element("button", "서식 복사", editable);
  const ignored = h.element("div", null); ignored.setAttribute("data-i18n-ignore", "");
  const ignoredButton = h.element("button", "편집 도구", ignored);
  const cell = h.element("td", "표");
  const code = h.element("pre", "편집 도구");
  const textarea = h.element("textarea", "편집 도구"); textarea.setAttribute("placeholder", "찾을 내용");
  h.ready(); h.flush();
  assert.equal(userButton.textContent, "서식 복사");
  assert.equal(ignoredButton.textContent, "편집 도구");
  assert.equal(cell.textContent, "표"); assert.equal(code.textContent, "편집 도구");
  assert.equal(textarea.textContent, "편집 도구"); assert.equal(textarea.getAttribute("placeholder"), "Find");
  const added = h.element("button", "서식 지우기", editable); h.flush(); assert.equal(added.textContent, "서식 지우기");
});

test("music note durations are contextual and menus translate before attachment", () => {
  const h = harness(); h.ready();
  const menu = h.element("div", null, null); menu.className = "music-context-menu";
  const item = h.element("button", "2분", menu); h.api.translateTree(menu);
  assert.equal(item.textContent, "Half");
  h.document.body.append(menu); h.flush();
  h.api.setLang("ko"); h.flush(); assert.equal(item.textContent, "2분");
  h.api.setLang("en"); h.flush(); assert.equal(item.textContent, "Half");
});
