"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/js/command-palette.js"), "utf8");

// Exercise the actual palette DOM/events in memory, without a browser or capture.
function harness(){
  class Target {
    constructor(){ this.listeners = new Map(); }
    addEventListener(type, callback, capture=false){
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ callback, capture:capture === true });
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
  function matches(el, selector){
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not && matches(el, not[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, "");
    if (selector === ":disabled") return !!el.disabled;
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];
    for (const match of attrs) if (match[2] == null ? !el.hasAttribute(match[1]) : el.getAttribute(match[1]) !== match[2]) return false;
    selector = selector.replace(/\[[^\]]+\]/g, "");
    const id = selector.match(/#([\w-]+)/); if (id && el.id !== id[1]) return false;
    for (const name of selector.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(name[1])) return false;
    const tag = selector.match(/^[\w-]+/);
    return !tag || el.tagName === tag[0].toUpperCase();
  }
  class Element extends Target {
    constructor(tag){
      super(); this.tagName = tag.toUpperCase(); this.nodeType = tag === "fragment" ? 11 : 1;
      this.children = []; this.parentNode = null; this.attrs = new Map(); this.dataset = {}; this.className = "";
      this.style = {}; this.value = ""; this._text = ""; this.disabled = false;
      this.classList = {
        contains:name => this.className.split(/\s+/).includes(name),
        toggle:(name, force) => {
          const names = new Set(this.className.split(/\s+/).filter(Boolean));
          if (force == null) force = !names.has(name);
          if (force) names.add(name); else names.delete(name); this.className = [...names].join(" ");
        },
        add:(...names) => names.forEach(name => this.classList.toggle(name, true))
      };
    }
    get id(){ return this.getAttribute("id") || ""; } set id(value){ this.setAttribute("id", value); }
    get hidden(){ return this.hasAttribute("hidden"); } set hidden(value){ if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
    get tabIndex(){ return this.hasAttribute("tabindex") ? Number(this.getAttribute("tabindex")) : ["INPUT","BUTTON","SELECT","TEXTAREA"].includes(this.tagName) ? 0 : -1; }
    set tabIndex(value){ this.setAttribute("tabindex", value); }
    get isConnected(){ return !!this.parentNode && (this.parentNode === document || this.parentNode.isConnected); }
    append(...nodes){
      for (const node of nodes){
        if (node.nodeType === 11){ this.append(...node.children.slice()); continue; }
        if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
        node.parentNode = this; this.children.push(node);
      }
    }
    appendChild(node){ this.append(node); return node; }
    replaceChildren(...nodes){ this.children.forEach(node => { node.parentNode = null; }); this.children = []; this._text = ""; this.append(...nodes); }
    get textContent(){ return this._text + this.children.map(node => node.textContent).join(""); }
    set textContent(value){ this.replaceChildren(); this._text = String(value); }
    set innerHTML(value){ this.replaceChildren(); this._html = value; } get innerHTML(){ return this._html || ""; }
    setAttribute(name, value){ this.attrs.set(name, String(value)); }
    getAttribute(name){ return this.attrs.get(name) ?? null; }
    hasAttribute(name){ return this.attrs.has(name); }
    removeAttribute(name){ this.attrs.delete(name); if (name === "style") this.style = {}; }
    querySelectorAll(selector){
      const selectors = selector.split(",").map(value => value.trim());
      return this.children.flatMap(node => [...(selectors.some(value => matches(node, value)) ? [node] : []), ...node.querySelectorAll(selector)]);
    }
    querySelector(selector){ return this.querySelectorAll(selector)[0] || null; }
    closest(selector){ for (let node=this; node instanceof Element; node=node.parentNode) if (matches(node, selector)) return node; return null; }
    contains(node){ for (; node; node=node.parentNode) if (node === this) return true; return false; }
    click(){ if (!this.disabled) this.dispatch("click"); }
    focus(){ document.activeElement = this; }
    select(){ this.selected = true; }
    scrollIntoView(options){ this.scrolled = options; }
  }
  const document = new Target(), window = new Target(), frames = [], timers = [], calls = [], icons = [], movable = [];
  document.body = new Element("body"); document.body.parentNode = document; document.parentNode = window; window.document = document;
  document.createElement = tag => new Element(tag); document.createDocumentFragment = () => new Element("fragment");
  document.getElementById = id => document.body.querySelector("#" + id);
  document.querySelector = selector => document.body.querySelector(selector);
  const element = (tag, id, parent=document.body) => { const el = new Element(tag); if (id) el.id = id; parent.append(el); return el; };
  const opener = element("button", "commandPaletteOpen"), viewer = element("input", "viewer");
  element("button", "dzCommandPalette"); element("kbd", "commandPaletteKbd");
  element("input", "fileInput"); element("input", "folderInput"); element("span", "activeFileName");
  const overlay = () => document.body.querySelector(".cmdk-overlay");
  const record = (name, args=[]) => { calls.push({ name, args, closed:!!overlay()?.hidden }); viewer.focus(); };
  for (const match of source.matchAll(/clickId\("([^"]+)"\)/g)){
    if (!document.getElementById(match[1])) element("button", match[1]).onclick = () => record(match[1]);
  }
  for (const id of ["studyToggle","saveFolderOpen"]){
    const control = document.getElementById(id) || element("button", id); control.hidden = true;
  }
  for (const match of source.matchAll(/callFn\("([^"]+)"/g)) window[match[1]] = (...args) => record(match[1], args);
  window.pickFilesOrInput = (...args) => record("files", args);
  window.pickFolderOrInput = (...args) => record("folder", args);
  window.t = value => value; window.tf = (template, vars) => template.replace("{n}", vars.n);
  window.uiIcon = name => { icons.push(name); return '<svg data-icon="' + name + '"></svg>'; };
  window.makeCardMovable = card => { movable.push(card); card.__clampMovableModal = () => { card.clamped = true; }; };
  window.shortcutValue = action => action === "commandPalette" ? "Ctrl+Shift+K" : ({ openFiles:"Ctrl+O", newPython:"Alt+N" })[action] || "";
  window.shortcutDisplay = value => value;
  window.shortcutMatches = (event, action) => action === "commandPalette" && event.ctrlKey && event.shiftKey && !event.altKey && String(event.key).toLowerCase() === "k";
  window.syncShortcutHints = root => root.querySelectorAll("[data-shortcut-action]").forEach(el => { el.textContent = window.shortcutValue(el.getAttribute("data-shortcut-action")); });
  const context = vm.createContext({
    window, document, HTMLElement:Element, state:null, docs:[], console,
    diffComparableDocs:() => context.docs, canDeleteOriginalDoc:doc => !!doc.canDelete,
    targetPdfForCodeLink:() => context.state && context.state.codeLink,
    setTimeout:callback => timers.push(callback), requestAnimationFrame:callback => frames.push(callback)
  });
  window.batchReplaceTargetDocs = () => context.docs;
  const instrumented = source.replace(/\n\}\)\(\);\s*$/, "\n  window.__testPalette = { COMMANDS, COMMAND_UI, CATEGORIES, available };\n})();");
  vm.runInContext(instrumented, context);
  const flushFrames = () => { while (frames.length) frames.shift()(); };
  const flushTimers = () => { while (timers.length) timers.shift()(); flushFrames(); };
  const open = () => { opener.focus(); opener.click(); flushFrames(); return overlay(); };
  const input = () => document.body.querySelector(".cmdk-input");
  const query = value => { input().value = value; input().dispatch("input"); };
  const key = (target, value, properties={}) => target.dispatch("keydown", { key:value, ...properties });
  const ids = () => document.body.querySelectorAll(".cmdk-item").map(row => row.dataset.command);
  const setDocument = (kind, selectors=[], properties={}) => {
    const tools = new Map();
    for (const selector of selectors){
      const tool = new Element("button"); tool.onclick = () => record(selector);
      tools.set(selector.replace(/:not\(:disabled\)$/, ""), tool);
    }
    context.state = { kind, name:"수업자료." + kind, el:{ querySelector:selector => {
      const tool = tools.get(selector.replace(/:not\(:disabled\)$/, ""));
      return tool && selector.includes(":disabled") && tool.disabled ? null : tool || null;
    } }, ...properties };
    context.docs = [context.state];
    return tools;
  };
  return { window, document, element, opener, viewer, context, open, overlay, input, query, key, ids, setDocument, calls, icons, movable, record,
    flushFrames, flushTimers, internals:window.__testPalette };
}

test("all 93 original commands have categories, descriptions and existing SVG icons", () => {
  const h = harness(), { COMMANDS, COMMAND_UI, CATEGORIES } = h.internals;
  const iconSource = fs.readFileSync(path.join(__dirname, "../src/js/icons.js"), "utf8");
  const existingIcons = new Set([...iconSource.matchAll(/^    (\w+):/gm)].map(match => match[1]));
  assert.equal(COMMANDS.length, 93);
  assert.deepEqual(Object.keys(COMMAND_UI).sort(), Array.from(COMMANDS, cmd => cmd.id).sort());
  for (const cmd of COMMANDS){
    const [category, icon, description] = COMMAND_UI[cmd.id];
    assert.ok(CATEGORIES.some(group => group.id === category), cmd.id);
    assert.ok(existingIcons.has(icon), icon); assert.ok(description.length > 5, cmd.id);
    assert.equal(typeof cmd.run, "function");
  }
});

test("initial category browser has collapsed details and the existing movable-card integration", () => {
  const h = harness(); h.open();
  assert.equal(h.document.activeElement, h.input());
  assert.equal(h.document.getElementById("cmdkDetails").hidden, true);
  assert.equal(h.overlay().querySelector(".cmdk-detail-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(h.movable.length, 1); assert.equal(h.movable[0].classList.contains("movable-card"), true);
  assert.equal(h.overlay().querySelector(".cmdk-opening-key").textContent, "Ctrl+Shift+K");
  assert.ok(h.icons.includes("folder")); assert.equal(h.ids()[0], "openFiles");
  assert.equal(h.overlay().querySelector(".cmdk-body").dispatch("mousedown").stopped, true);
  assert.equal(h.overlay().querySelector(".cmdk-head").dispatch("mousedown").stopped, false);
  assert.ok(!h.ids().includes("pdfSign")); assert.ok(!h.ids().includes("runCode"));
});

test("PDF availability, category counts and selection drive the detail panel", () => {
  const h = harness(); h.setDocument("pdf"); h.open();
  assert.equal(h.ids()[0], "pdfSign");
  h.document.getElementById("cmdkCategory-current").click();
  assert.ok(h.ids().includes("pdfSign")); assert.ok(!h.ids().includes("newPython"));
  const tab = h.document.getElementById("cmdkCategory-current");
  assert.equal(Number(tab.querySelector(".cmdk-category-count").textContent), h.ids().length);
  h.overlay().querySelector(".cmdk-detail-toggle").click();
  assert.equal(h.document.getElementById("cmdkDetails").hidden, false);
  assert.equal(h.overlay().querySelector(".cmdk-detail-title").textContent, "PDF 서명 추가");
  assert.equal(h.overlay().querySelector(".cmdk-detail-path").textContent, "PDF 도구 › 서명");
  h.key(h.input(), "ArrowDown");
  assert.equal(h.overlay().querySelector(".cmdk-detail-title").textContent, "PDF 텍스트 넣기");
  assert.equal(h.overlay().querySelectorAll('[aria-selected="true"]').filter(el => el.getAttribute("role") === "option").length, 1);
  h.overlay().querySelector(".cmdk-detail-toggle").click();
  assert.equal(h.document.getElementById("cmdkDetails").hidden, true);
});

test("search crosses categories, normalizes text, preserves the category on clearing and handles no results", () => {
  const h = harness(); h.open(); h.document.getElementById("cmdkCategory-view").click();
  h.query("ＰＹＴＨＯＮ"); assert.ok(h.ids().includes("newPython"));
  assert.equal(h.document.getElementById("cmdkCategory-all").getAttribute("aria-selected"), "true");
  h.overlay().querySelector(".cmdk-clear").click();
  assert.equal(h.document.getElementById("cmdkCategory-view").getAttribute("aria-selected"), "true");
  assert.ok(h.ids().includes("settings")); assert.ok(!h.ids().includes("newPython"));
  h.query("없는 기능 92929"); assert.equal(h.ids().length, 0);
  assert.equal(h.overlay().querySelector(".cmdk-empty").hidden, false);
  assert.equal(h.overlay().querySelector(".cmdk-detail-run").disabled, true);
  assert.equal(h.input().hasAttribute("aria-activedescendant"), false);
  h.key(h.input(), "Enter"); h.flushTimers(); assert.equal(h.calls.length, 0);
  h.query("로또 뽑기"); assert.ok(h.ids().includes("lottoPicker"));
  h.document.getElementById("cmdkCategory-current").click();
  assert.equal(h.overlay().querySelector(".cmdk-empty").textContent, "문서를 열면 관련 기능을 볼 수 있어요");
});

test("execution closes first, fires once and leaves the new target focused", () => {
  const h = harness(); h.setDocument("pdf"); h.open(); h.query("PDF 서명 추가");
  h.overlay().querySelector(".cmdk-detail-toggle").click(); h.overlay().querySelector(".cmdk-detail-run").click();
  h.key(h.input(), "Enter"); assert.equal(h.overlay().hidden, true); assert.equal(h.calls.length, 0);
  h.flushTimers(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, "btnSign");
  assert.equal(h.calls[0].closed, true); assert.equal(h.document.activeElement, h.viewer);
  h.open(); h.query("파일 열기"); h.key(h.input(), "Enter"); h.flushTimers();
  assert.equal(h.calls.at(-1).name, "files"); assert.equal(h.calls.at(-1).args[0].id, "fileInput");
});

test("all 93 commands retain one execution of their original function or toolbar target", () => {
  const commands = harness().internals.COMMANDS;
  const selectors = [...new Set([...source.matchAll(/hasBtn\("([^"]+)"\)/g)].map(match => match[1]).concat(".run-go"))];
  for (const command of commands){
    const h = harness();
    h.setDocument(command.id === "print" ? "py" : "pdf", selectors, {
      id:"doc-1", codeEditor:{}, pdfOutline:[{}], codeLink:true, canDelete:true,
      openGotoLine:() => h.record("goto")
    });
    h.context.docs.push({ id:"doc-2" });
    for (const id of ["studyToggle","saveFolderOpen"]) h.document.getElementById(id).hidden = false;
    h.open();
    const row = h.overlay().querySelectorAll(".cmdk-item").find(el => el.dataset.command === command.id);
    assert.ok(row, command.id + " remains available under its original conditions");
    row.click(); h.flushTimers();
    assert.equal(h.calls.length, 1, command.id + " runs once");
    assert.equal(h.calls[0].closed, true, command.id + " runs after the palette closes");
    assert.equal(h.document.activeElement, h.viewer, command.id + " retains target focus");
  }
});

test("IME composition cannot execute or close the palette and Escape from any control restores focus", () => {
  const h = harness(); h.open();
  h.key(h.input(), "Enter", { isComposing:true }); h.key(h.input(), "Enter", { keyCode:229 });
  h.key(h.input(), "Escape", { isComposing:true }); h.flushTimers();
  assert.equal(h.calls.length, 0); assert.equal(h.overlay().hidden, false);
  const tab = h.document.getElementById("cmdkCategory-all"); h.key(tab, "ArrowDown");
  assert.equal(h.document.activeElement.id, "cmdkCategory-current");
  h.key(h.document.activeElement, "Escape"); h.flushFrames();
  assert.equal(h.overlay().hidden, true); assert.equal(h.document.activeElement, h.opener);
});

test("focus trap excludes collapsed details and inactive tabs, and outside clicks close", () => {
  const h = harness(); h.open();
  const toggle = h.overlay().querySelector(".cmdk-detail-toggle"), last = h.document.getElementById("cmdkCategory-all");
  toggle.focus(); h.key(toggle, "Tab", { shiftKey:true }); assert.equal(h.document.activeElement, last);
  last.focus(); h.key(last, "Tab"); assert.equal(h.document.activeElement, toggle);
  toggle.click(); const run = h.overlay().querySelector(".cmdk-detail-run"); run.focus();
  h.key(run, "Tab"); assert.equal(h.document.activeElement, toggle);
  h.overlay().dispatch("mousedown"); h.flushFrames(); assert.equal(h.overlay().hidden, true);
});

test("Python, notebook, sheet and board toolbar commands retain their document conditions and target buttons", () => {
  const fixtures = [
    ["py", [".run-go",".run-trace",".run-analyze",".run-grade",".run-py-pkg",".run-nbconvert-group button"], ["runCode","pyTrace","pyAnalyze","pyGrade","pyPkg","pyToNotebook"], "runCode", ".run-go"],
    ["notebook", [".nbv-runall",".nbv-restartrun",".nbv-toc-open",".nbv-export-pdf"], ["nbRunAll","nbRestart","nbToc","nbExportPdf"], "nbRunAll", ".nbv-runall"],
    ["xlsx", [".xlsx-editmode-btn",".xlsx-tool-menu-find > summary"], ["sheetEdit","sheetFind"], "sheetEdit", ".xlsx-editmode-btn"],
    ["board", [".wb-edu-toggle",".wb-focus-toggle",".wb-rec",".wb-clear"], ["boardEducation","boardFocus","boardRec","boardClear"], "boardEducation", ".wb-edu-toggle"]
  ];
  for (const [kind, selectors, expected, action, target] of fixtures){
    const h = harness(); h.setDocument(kind, selectors); h.open(); h.document.getElementById("cmdkCategory-current").click();
    for (const id of expected) assert.ok(h.ids().includes(id), kind + ": " + id);
    assert.ok(!h.ids().includes("pdfSign"));
    const row = h.overlay().querySelectorAll(".cmdk-item").find(el => el.dataset.command === action);
    row.click(); h.flushTimers(); assert.equal(h.calls[0].name, target);
  }
});

test("a command that becomes unavailable before execution is not run", () => {
  const h = harness(); h.setDocument("pdf"); h.open(); h.query("PDF 서명 추가");
  h.context.state = null; h.key(h.input(), "Enter"); h.flushTimers();
  assert.equal(h.calls.length, 0); assert.equal(h.overlay().hidden, false); assert.equal(h.ids().length, 0);
});

test("a pending command is rechecked if document state changes after the palette closes", () => {
  const h = harness(); h.setDocument("pdf"); h.open(); h.query("PDF 서명 추가");
  h.key(h.input(), "Enter"); h.context.state = null; h.flushTimers();
  assert.equal(h.calls.length, 0); assert.equal(h.overlay().hidden, true);
});

test("live translation updates search results and preserves the selected command", () => {
  const h = harness(); h.setDocument("pdf"); h.open(); h.document.getElementById("cmdkCategory-current").click();
  h.key(h.input(), "ArrowDown");
  h.window.t = value => ({ "PDF 텍스트 넣기":"Insert PDF text", "PDF 서명 추가":"Add PDF signature", "검색 결과":"Search results" })[value] || value;
  h.window.tf = (template, vars) => vars.n + " features";
  h.window.dispatch("mni18nchange");
  assert.equal(h.overlay().querySelector(".cmdk-detail-title").textContent, "Insert PDF text");
  assert.ok(h.overlay().querySelector(".cmdk-count").textContent.endsWith("features"));
  h.query("signature"); assert.ok(h.ids().includes("pdfSign"));
});

test("other modals prevent opening, and keyboard toggling uses the configured shortcut", () => {
  const h = harness(), modal = h.element("div"); modal.className = "modal";
  h.open(); assert.equal(h.overlay(), null);
  modal.hidden = true; h.key(h.opener, "k", { ctrlKey:true }); h.flushFrames(); assert.equal(h.overlay(), null);
  h.key(h.opener, "k", { ctrlKey:true, shiftKey:true }); h.flushFrames(); assert.equal(h.overlay().hidden, false);
  h.key(h.input(), "k", { ctrlKey:true, shiftKey:true }); h.flushFrames(); assert.equal(h.overlay().hidden, true);
});
