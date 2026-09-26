"use strict";

/* 시험용 아주 작은 DOM — 브라우저 없이 화면을 붙이고 단추를 눌러 볼 만큼만 흉내 낸다.
   (AGENTS.md: 브라우저 자동화는 사용자가 요청할 때만 — 그래서 화면 코드가 '붙기만 해도 안 깨지는지'는 이것으로 본다.)
   되는 것: 요소 만들기·붙이기·지우기, innerHTML/insertAdjacentHTML(간단한 HTML·SVG 파서), querySelector(태그·#id·.class·[속성]·[속성=값]·:last-child·:first-child, 자손·> 결합),
   classList·dataset·style, 이벤트(거품 오름), click(), 가짜 시계(setTimeout·requestAnimationFrame·performance.now).
   안 되는 것: 배치 계산(크기는 요소마다 고정값), CSS 적용. */
const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "area", "col", "source", "wbr"]);
const REFLECT = ["id", "title", "type", "href", "src", "alt", "placeholder", "accept", "role", "name"];
const decode = text => String(text).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp:"&", lt:"<", gt:">", quot:'"', "#39":"'", nbsp:"\u00a0" })[e]);
const encode = text => String(text).replace(/[&<>"]/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[ch]);

class MiniEvent {
  constructor(type, init = {}){ this.type = type; this.bubbles = !!init.bubbles; this.defaultPrevented = false; this._stop = false; Object.assign(this, init); }
  preventDefault(){ this.defaultPrevented = true; }
  stopPropagation(){ this._stop = true; }
  stopImmediatePropagation(){ this._stop = true; }
}
class MiniNode {
  constructor(doc){ this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._listeners = {}; }
  get parentElement(){ return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected(){ let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  remove(){ if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn){ (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn){ const list = this._listeners[type]; if (list){ const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } }
  dispatchEvent(event){
    if (!event.target) event.target = this;
    for (let node = this; node; node = event.bubbles ? node.parentNode : null){
      event.currentTarget = node;
      (node._listeners[event.type] || []).slice().forEach(fn => fn.call(node, event));
      const own = node["on" + event.type]; if (typeof own === "function") own.call(node, event);
      if (event._stop) break;
    }
    return !event.defaultPrevented;
  }
}
class MiniText extends MiniNode {
  constructor(doc, data){ super(doc); this.nodeType = 3; this.data = String(data); }
  get textContent(){ return this.data; } set textContent(v){ this.data = String(v); }
}
class MiniClassList {
  constructor(el){ this.el = el; }
  _get(){ return (this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  _set(list){ this.el.setAttribute("class", list.join(" ")); }
  add(...names){ const list = this._get(); names.forEach(n => { if (!list.includes(n)) list.push(n); }); this._set(list); }
  remove(...names){ this._set(this._get().filter(n => !names.includes(n))); }
  toggle(name, force){ const on = force === undefined ? !this.contains(name) : !!force; if (on) this.add(name); else this.remove(name); return on; }
  contains(name){ return this._get().includes(name); }
}
class MiniElement extends MiniNode {
  constructor(doc, tag){
    super(doc); this.nodeType = 1; this.localName = String(tag).toLowerCase(); this.tagName = this.localName.toUpperCase(); this._attrs = new Map();
    this.classList = new MiniClassList(this); this.value = ""; this.disabled = false; this.checked = false; this.files = [];
    const style = {}; Object.defineProperties(style, { setProperty:{ value:(k, v) => { style[k] = String(v); } }, removeProperty:{ value:k => { delete style[k]; } }, getPropertyValue:{ value:k => style[k] || "" } }); this.style = style;
    this.dataset = new Proxy({}, { get:(_, k) => this.getAttribute("data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase())) ?? undefined,
      set:(_, k, v) => { this.setAttribute("data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase()), v); return true; } });
  }
  get children(){ return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild(){ return this.childNodes[0] || null; } get lastChild(){ return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild(){ return this.children[0] || null; }
  get className(){ return this.getAttribute("class") || ""; } set className(v){ this.setAttribute("class", v); }
  get hidden(){ return this._attrs.has("hidden"); } set hidden(v){ if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  getAttribute(k){ return this._attrs.has(k) ? this._attrs.get(k) : null; }
  setAttribute(k, v){ this._attrs.set(k, String(v)); }
  removeAttribute(k){ this._attrs.delete(k); }
  hasAttribute(k){ return this._attrs.has(k); }
  appendChild(node){
    if (node.localName === "#fragment"){ node.childNodes.slice().forEach(child => this.appendChild(child)); return node; }
    node.remove(); node.parentNode = this; this.childNodes.push(node); return node;
  }
  insertBefore(node, ref){ if (!ref) return this.appendChild(node); if (node.localName === "#fragment"){ node.childNodes.slice().forEach(child => this.insertBefore(child, ref)); return node; } node.remove(); node.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, node); return node; }
  removeChild(node){ const i = this.childNodes.indexOf(node); if (i >= 0){ this.childNodes.splice(i, 1); node.parentNode = null; } return node; }
  append(...nodes){ nodes.forEach(n => this.appendChild(typeof n === "string" ? new MiniText(this.ownerDocument, n) : n)); }
  prepend(...nodes){ const first = this.firstChild; nodes.forEach(n => this.insertBefore(typeof n === "string" ? new MiniText(this.ownerDocument, n) : n, first)); }
  replaceChildren(...nodes){ this.childNodes.slice().forEach(n => n.remove()); this.append(...nodes); }
  contains(node){ for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent(){ return this.childNodes.map(n => n.textContent).join(""); }
  set textContent(v){ this.childNodes.slice().forEach(n => n.remove()); if (v !== "" && v != null) this.appendChild(new MiniText(this.ownerDocument, v)); }
  get innerHTML(){ return this.childNodes.map(serialize).join(""); }
  set innerHTML(html){ this.childNodes.slice().forEach(n => n.remove()); parseInto(this, String(html)); }
  insertAdjacentHTML(pos, html){
    const holder = new MiniElement(this.ownerDocument, "#fragment"); parseInto(holder, String(html));
    if (pos === "beforeend") this.appendChild(holder); else if (pos === "afterbegin") this.insertBefore(holder, this.firstChild);
    else if (pos === "beforebegin" && this.parentNode) this.parentNode.insertBefore(holder, this);
    else if (pos === "afterend" && this.parentNode){ const sib = this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1]; this.parentNode.insertBefore(holder, sib || null); }
  }
  querySelectorAll(sel){ const out = [], groups = splitGroups(sel); walk(this, el => { if (groups.some(g => matchChain(el, g, this))) out.push(el); }); return out; }
  querySelector(sel){ return this.querySelectorAll(sel)[0] || null; }
  getElementsByTagName(tag){ return this.querySelectorAll(tag); }
  matches(sel){ return splitGroups(sel).some(g => matchChain(this, g, null)); }
  closest(sel){ for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  click(){ if (this.disabled) return; this.dispatchEvent(new MiniEvent("click", { bubbles:true })); }
  focus(){ this.ownerDocument.activeElement = this; } blur(){ if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select(){} scrollIntoView(){}
  get clientWidth(){ return this._w ?? 900; } get clientHeight(){ return this._h ?? 640; }
  get offsetWidth(){ return this.clientWidth; } get offsetHeight(){ return this.clientHeight; }
  getBoundingClientRect(){ const w = this.clientWidth, h = this.clientHeight; return { left:0, top:0, x:0, y:0, width:w, height:h, right:w, bottom:h }; }
  animate(){ return { finished:Promise.resolve(), cancel(){}, onfinish:null }; }
  // 캔버스 — 무엇을 불러도 같은 흉내 객체를 돌려준다(createLinearGradient().addColorStop() 처럼 이어 불러도 되게).
  getContext(){ const store = {}; const stub = new Proxy(function(){}, { get:(_, k) => (k in store ? store[k] : stub), set:(_, k, v) => { store[k] = v; return true; }, apply:() => stub }); return stub; }
}
REFLECT.forEach(k => Object.defineProperty(MiniElement.prototype, k, { get(){ return this.getAttribute(k) || ""; }, set(v){ this.setAttribute(k, v); } }));
function serialize(n){
  if (n.nodeType === 3) return encode(n.data);
  const attrs = [...n._attrs].map(([k, v]) => ` ${k}="${encode(v)}"`).join("");
  return VOID.has(n.localName) ? `<${n.localName}${attrs}>` : `<${n.localName}${attrs}>${n.innerHTML}</${n.localName}>`;
}
function parseInto(parent, html){
  const doc = parent.ownerDocument, stack = [parent], re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|[^<]+|</g;
  let m;
  while ((m = re.exec(html))){
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<!--")) continue;
    if (m[1]){ for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === m[1].toLowerCase()){ stack.length = i; break; } continue; }
    if (m[2]){
      const el = new MiniElement(doc, m[2]), are = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g; let a;
      while ((a = are.exec(m[3] || ""))) el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ""));
      top.appendChild(el); if (!m[4] && !VOID.has(el.localName)) stack.push(el); continue;
    }
    top.appendChild(new MiniText(doc, decode(m[0])));
  }
}
function walk(root, fn){ root.childNodes.forEach(n => { if (n.nodeType === 1){ fn(n); walk(n, fn); } }); }
function splitGroups(sel){ const out = []; let depth = 0, cur = ""; for (const ch of String(sel)){ if (ch === "[" || ch === "(") depth++; if (ch === "]" || ch === ")") depth--; if (ch === "," && !depth){ out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(parseChain); }
function parseChain(text){
  const parts = []; let cur = "", depth = 0, comb = " "; const src = text.trim();
  for (let i = 0; i <= src.length; i++){
    const ch = src[i];
    if (ch === "[" || ch === "(") depth++; if (ch === "]" || ch === ")") depth--;
    if ((ch === undefined || ((ch === " " || ch === ">") && !depth))){ if (cur.trim()){ parts.push({ comb, simple:parseCompound(cur.trim()) }); comb = " "; } cur = ""; if (ch === ">") comb = ">"; continue; }
    cur += ch;
  }
  return parts;
}
function parseCompound(text){
  const out = { tag:null, ids:[], classes:[], attrs:[], pseudos:[] }, re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:([\w-]+)/g; let m;
  while ((m = re.exec(text))){ if (m[1]) out.tag = m[1].toLowerCase(); else if (m[2]) out.ids.push(m[2]); else if (m[3]) out.classes.push(m[3]); else if (m[4]) out.attrs.push([m[4], m[5] ?? m[6] ?? m[7]]); else if (m[8]) out.pseudos.push(m[8]); }
  return out;
}
function matchSimple(el, s){
  if (el.nodeType !== 1) return false;
  if (s.tag && s.tag !== "*" && el.localName !== s.tag) return false;
  if (s.ids.some(id => el.getAttribute("id") !== id)) return false;
  if (s.classes.some(c => !el.classList.contains(c))) return false;
  if (s.attrs.some(([k, v]) => !el.hasAttribute(k) || (v !== undefined && el.getAttribute(k) !== v))) return false;
  for (const p of s.pseudos){
    const sibs = el.parentNode ? el.parentNode.children : [el];
    if (p === "last-child" && sibs[sibs.length - 1] !== el) return false;
    if (p === "first-child" && sibs[0] !== el) return false;
    if (p === "disabled" && !el.disabled) return false;
  }
  return true;
}
function matchChain(el, chain, scope){
  const at = (node, idx) => {
    if (!matchSimple(node, chain[idx].simple)) return false; if (idx === 0) return true;
    if (chain[idx].comb === ">") return !!node.parentNode && node.parentNode !== scope && at(node.parentNode, idx - 1);
    for (let p = node.parentNode; p && p.nodeType === 1 && p !== scope; p = p.parentNode) if (at(p, idx - 1)) return true;
    return false;
  };
  return chain.length ? at(el, chain.length - 1) : false;
}

/* 가짜 창 — vm 문맥에 넣을 전역들. clock.advance(ms) 로 시계를 돌리면 그 사이 타이머·프레임이 차례로 돈다. */
function createWindow(){
  const doc = { activeElement:null, fullscreenElement:null, _listeners:{} };
  doc.createElement = tag => new MiniElement(doc, tag);
  doc.createElementNS = (_, tag) => new MiniElement(doc, tag);
  doc.createTextNode = text => new MiniText(doc, text);
  doc.createDocumentFragment = () => new MiniElement(doc, "#fragment");
  doc.documentElement = new MiniElement(doc, "html"); doc.body = new MiniElement(doc, "body"); doc.documentElement.appendChild(doc.body); doc.activeElement = doc.body;
  doc.querySelector = sel => doc.documentElement.querySelector(sel); doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.getElementById = id => doc.documentElement.querySelector("#" + id);
  doc.addEventListener = MiniNode.prototype.addEventListener; doc.removeEventListener = MiniNode.prototype.removeEventListener;
  const clock = { now:0, timers:[], seq:0, frames:[] };
  const setTimeout = (fn, ms) => { const id = ++clock.seq; clock.timers.push({ id, at:clock.now + Math.max(0, Number(ms) || 0), fn }); return id; };
  const clearTimeout = id => { clock.timers = clock.timers.filter(t => t.id !== id); };
  const requestAnimationFrame = fn => { const id = ++clock.seq; clock.frames.push({ id, fn }); return id; };
  const cancelAnimationFrame = id => { clock.frames = clock.frames.filter(f => f.id !== id); };
  clock.advance = ms => {
    const end = clock.now + ms;
    while (clock.now < end){
      clock.now = Math.min(end, clock.now + 16);
      for (;;){ const due = clock.timers.filter(t => t.at <= clock.now).sort((a, b) => a.at - b.at || a.id - b.id)[0]; if (!due) break; clock.timers = clock.timers.filter(t => t !== due); due.fn(); }
      const frames = clock.frames; clock.frames = []; frames.forEach(f => f.fn(clock.now));
    }
  };
  const win = { document:doc, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, clock,
    performance:{ now:() => clock.now }, matchMedia:() => ({ matches:false, addEventListener(){}, removeEventListener(){} }),
    ResizeObserver:class { constructor(fn){ this.fn = fn; } observe(){} unobserve(){} disconnect(){} },
    CSS:{ escape:v => String(v).replace(/["\\]/g, "\\$&") }, Event:MiniEvent, getComputedStyle:() => ({ getPropertyValue:() => "" }), devicePixelRatio:1,
    localStorage:{ getItem:() => null, setItem(){}, removeItem(){} }, _listeners:{} };
  win.addEventListener = MiniNode.prototype.addEventListener; win.removeEventListener = MiniNode.prototype.removeEventListener;
  win.dispatchEvent = event => { (win._listeners[event.type] || []).slice().forEach(fn => fn(event)); return !event.defaultPrevented; };
  win.window = win;
  return win;
}

module.exports = { createWindow, MiniEvent };
