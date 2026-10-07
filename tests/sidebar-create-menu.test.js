"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const menuApi = require("../src/js/sidebar-create-menu.js");

// DOM events and focus only: no browser, screen capture or layout engine.
function harness(){
  class Target {
    constructor(){ this.listeners = new Map(); }
    addEventListener(type, callback, capture=false){
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ callback, capture });
    }
    dispatch(type, properties={}){
      const event = { type, target:this, defaultPrevented:false, stopped:false,
        preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; }, ...properties };
      const route = [this];
      if (properties.bubbles !== false) for (let parent=this.parentNode; parent; parent=parent.parentNode) route.push(parent);
      const invoke = (target, capture) => {
        for (const listener of target.listeners.get(type) || []) if (listener.capture === capture) listener.callback(event);
        if (!capture && typeof target["on" + type] === "function") target["on" + type](event);
      };
      for (const target of [...route].reverse()){ invoke(target, true); if (event.stopped) return event; }
      for (const target of route){ invoke(target, false); if (event.stopped) break; }
      return event;
    }
  }
  class Element extends Target {
    constructor(tag){
      super(); this.tagName = tag; this.children = []; this.parentNode = null; this.className = "";
      this.attrs = new Map(); this.dataset = {}; this.style = { setProperty(name, value){ this[name] = value; } };
      this.hidden = false; this.value = ""; this._text = ""; this.tabIndex = -1;
      this.classList = {
        contains:(name) => this.className.split(/\s+/).includes(name),
        toggle:(name, enabled) => {
          const values = new Set(this.className.split(/\s+/).filter(Boolean));
          if (enabled == null) enabled = !values.has(name);
          if (enabled) values.add(name); else values.delete(name);
          this.className = [...values].join(" ");
        },
        add:(...names) => names.forEach(name => this.classList.toggle(name, true)),
        remove:(...names) => names.forEach(name => this.classList.toggle(name, false))
      };
    }
    append(...nodes){
      for (const node of nodes){
        if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
        node.parentNode = this; this.children.push(node);
      }
    }
    replaceChildren(...nodes){ this.children.forEach(node => { node.parentNode = null; }); this.children = []; this._text = ""; this.append(...nodes); }
    get textContent(){ return this._text + this.children.map(node => node.textContent).join(""); }
    set textContent(value){ this.replaceChildren(); this._text = String(value); }
    setAttribute(name, value){ this.attrs.set(name, String(value)); }
    getAttribute(name){ return this.attrs.get(name) ?? null; }
    hasAttribute(name){ return this.attrs.has(name); }
    removeAttribute(name){ this.attrs.delete(name); if (name === "style") this.style = { setProperty(key, value){ this[key] = value; } }; }
    querySelectorAll(selector){
      const matches = node => selector.startsWith(".") ? node.classList.contains(selector.slice(1))
        : selector.startsWith("#") ? node.id === selector.slice(1) : node.tagName === selector;
      return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]);
    }
    querySelector(selector){ return this.querySelectorAll(selector)[0] || null; }
    contains(node){ for (; node; node=node.parentNode) if (node === this) return true; return false; }
    click(){ this.dispatch("click"); }
    focus(){ document.activeElement = this; this.dispatch("focus", { bubbles:false }); this.dispatch("focusin"); }
    scrollIntoView(options){ this.scrolled = options; }
    getBoundingClientRect(){ return this.rect || { left:60, top:740, bottom:770 }; }
    get offsetWidth(){ return this.hidden ? 0 : 760; }
    get offsetHeight(){ return this.hidden ? 0 : Math.min(720, parseFloat(this.style.maxHeight) || 720); }
  }
  const document = new Target(), window = new Target();
  document.body = new Element("body"); document.body.parentNode = document; document.children = [document.body];
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.body.querySelector("#" + id);
  window.innerWidth = 1200; window.innerHeight = 800;
  window.t = value => value;
  window.tf = (template, vars) => template.replace("{n}", vars.n);
  const home = new Element("div"), button = new Element("button"), menu = new Element("div");
  document.body.append(home); home.append(button, menu); menu.hidden = true;
  const actions = new Map(), calls = [], viewer = new Element("input"), globalSearch = new Element("button");
  globalSearch.id = "commandPaletteOpen"; globalSearch.onclick = () => viewer.focus(); document.body.append(globalSearch, viewer);
  for (const item of menuApi.items){
    const action = new Element("button"); action.id = item.id; action.className = "sb-menu-item";
    const symbol = new Element("svg"); action.append(symbol); menu.append(action); actions.set(item.id, action);
    action.onclick = () => { calls.push({ id:item.id, closed:menu.hidden, symbol }); viewer.focus(); };
  }
  actions.get("sbNewPy").setAttribute("data-shortcut-title", "새 파이썬 코드");
  const controller = menuApi.init(button, menu, { document, window });
  const visible = () => menu.querySelectorAll(".sb-create-item").filter(action => !action.hidden).map(action => action.id);
  const search = document.getElementById("sbCreateSearch");
  const query = value => { search.value = value; search.dispatch("input"); };
  const key = (target, value, properties={}) => target.dispatch("keydown", { key:value, ...properties });
  return { document, window, home, button, menu, actions, calls, viewer, controller, visible, search, query, key };
}

test("the catalog retains every real sidebar action and its handler", () => {
  const html = fs.readFileSync(path.join(__dirname, "../classdock.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/js/app.js"), "utf8");
  const markup = html.match(/id="sbNewMenu"[\s\S]*?<\/div>/)[0];
  const ids = [...markup.matchAll(/class="sb-menu-item" id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 26);
  assert.deepEqual(menuApi.items.map(item => item.id).sort(), ids.sort());
  for (const id of ids) assert.ok(app.includes('byId("' + id + '").onclick'), id + " keeps its existing action");
  assert.deepEqual(menuApi.categories.slice(1).map(category => menuApi.items.filter(item => item.category === category.id).length), [6, 5, 6, 5, 4]);
  assert.equal(menuApi.items.find(item => item.id === "sbNewBoard").extension, undefined);
});

test("search handles aliases, extensions, normalized text and cross-category queries", () => {
  const find = (query, category="all", translate) => menuApi.filterItems(menuApi.items, query, category, translate).map(item => item.id);
  assert.deepEqual(find(".EXAMDONE", "code"), ["sbExamGrade"]);
  assert.deepEqual(find("엑셀"), ["sbNewSheet"]);
  assert.deepEqual(find("flashcard"), ["sbNewStudy"]);
  assert.deepEqual(find("ＰＹＴＨＯＮ .ｐｙ"), ["sbNewPy"]);
  assert.deepEqual(find("코드 자바스크립트"), ["sbNewJs"]);
  assert.deepEqual(find("written exam", "all", text => text === "시험지 만들기" ? "Written exam" : text), ["sbNewExam"]);
  assert.equal(find("   ", "review").length, 4);
  assert.deepEqual(find("no such feature"), []);
});

test("placement stays above or below the trigger and inside the logical viewport", () => {
  assert.deepEqual(menuApi.placement({ left:60, top:740, bottom:770 }, { width:760, height:720 }, { width:1200, height:800 }), { left:60, top:13, maxHeight:725 });
  assert.deepEqual(menuApi.placement({ left:1000, top:20, bottom:50 }, { width:760, height:720 }, { width:1200, height:800 }), { left:432, top:57, maxHeight:735 });
  const small = menuApi.placement({ left:2, top:360, bottom:390 }, { width:344, height:720 }, { width:360, height:400 });
  assert.equal(small.left, 8); assert.equal(small.top, 8); assert.equal(small.maxHeight, 345);
});

test("all 26 reused buttons close before running their original callback without stealing focus", () => {
  const h = harness();
  for (const item of menuApi.items){
    h.controller.open(); const action = h.document.getElementById(item.id);
    assert.equal(action, h.actions.get(item.id)); action.click();
    const call = h.calls.at(-1); assert.equal(call.id, item.id); assert.equal(call.closed, true);
    assert.equal(action.querySelector("svg"), call.symbol); assert.equal(h.document.activeElement, h.viewer);
    assert.equal(h.menu.parentNode, h.home);
  }
  assert.equal(h.calls.length, 26);
});

test("category selection, global search, clearing and reopening have consistent state", () => {
  const h = harness(); h.button.click();
  assert.equal(h.menu.dataset.view, "all"); assert.equal(h.visible().length, 26);
  assert.equal(h.document.activeElement, h.search); assert.equal(h.menu.parentNode, h.document.body);
  assert.equal(h.button.getAttribute("aria-expanded"), "true");
  h.document.getElementById("sbCreateCategory-document").click();
  assert.equal(h.menu.dataset.view, "category"); assert.equal(h.visible().length, 5);
  h.query(".java"); assert.deepEqual(h.visible(), ["sbNewJava"]); assert.equal(h.menu.dataset.view, "search");
  assert.equal(h.document.getElementById("sbCreateCategory-all").getAttribute("aria-selected"), "true");
  h.menu.querySelector(".sb-create-clear").click(); assert.equal(h.visible().length, 5);
  h.query("없는 기능 999"); assert.deepEqual(h.visible(), []); assert.equal(h.menu.querySelector(".sb-create-empty").hidden, false);
  h.key(h.search, "Enter"); assert.equal(h.calls.length, 0);
  h.key(h.search, "Escape"); assert.equal(h.document.activeElement, h.button); assert.equal(h.menu.hidden, true);
  h.controller.open(); assert.equal(h.visible().length, 26); assert.equal(h.search.value, "");
});

test("keyboard moves through visible tools, executes once and respects IME composition", () => {
  const h = harness(); h.controller.open();
  assert.equal(h.key(h.search, "Home").defaultPrevented, false);
  h.key(h.search, "ArrowDown"); assert.equal(h.document.activeElement.id, h.visible()[0]);
  h.key(h.document.activeElement, "End"); assert.equal(h.document.activeElement.id, h.visible().at(-1));
  assert.equal(h.menu.querySelectorAll(".sb-create-item").filter(action => action.tabIndex === 0).length, 1);
  h.key(h.document.activeElement, " "); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].id, "sbPensionPicker");
  h.controller.open(); h.query(".examdone");
  h.key(h.search, "Enter", { isComposing:true }); h.key(h.search, "Enter", { keyCode:229 }); assert.equal(h.calls.length, 1);
  h.key(h.search, "Enter"); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].id, "sbExamGrade");
  h.controller.open(); const firstTab = h.document.getElementById("sbCreateCategory-all");
  h.key(firstTab, "ArrowDown"); assert.equal(h.document.activeElement.id, "sbCreateCategory-code"); assert.equal(h.visible().length, 6);
  h.key(h.document.activeElement, "End"); assert.equal(h.visible().length, 4);
});

test("outside interactions close the menu and the footer opens the existing global search", () => {
  const h = harness(); h.controller.open(); h.viewer.click(); assert.equal(h.menu.hidden, true);
  h.controller.open(); h.viewer.focus(); assert.equal(h.menu.hidden, true);
  h.controller.open(); h.menu.querySelector(".sb-create-full-search").click();
  assert.equal(h.menu.hidden, true); assert.equal(h.document.activeElement, h.viewer);
  h.controller.open(); h.menu.querySelector(".sb-create-close").click(); assert.equal(h.document.activeElement, h.button);
});

test("resize uses normalized coordinates and language changes refresh result counts", () => {
  const h = harness(); h.controller.open(); assert.equal(h.menu.style.left, "60px"); assert.equal(h.menu.style.top, "13px");
  h.window.innerWidth = 1000; h.window.dispatch("resize"); assert.equal(h.menu.style.left, "60px");
  h.window.tf = (template, vars) => template.includes("검색") ? vars.n + " search results" : vars.n + " tools";
  h.window.dispatch("mni18nchange"); assert.equal(h.menu.querySelector(".sb-create-total").textContent, "26 tools");
  h.query(".examdone"); assert.equal(h.menu.querySelector(".sb-create-count").textContent, "1 search results");
});
