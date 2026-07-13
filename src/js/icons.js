"use strict";

// 앱 전체에서 운영체제 이모지 대신 쓰는 단색 SVG 아이콘이다.
(function(){
  const paths = {
    code: '<path d="M9 5 4 10l5 5M15 5l5 5-5 5M13 3l-2 14"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v5h5"/>',
    folder: '<path d="M3 6h7l2 2h9v10H3z"/>',
    save: '<path d="M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    pen: '<path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 7.5l3 3"/>',
    eraser: '<path d="m7 18-3-3a2 2 0 0 1 0-3l6-6a2 2 0 0 1 3 0l7 7a2 2 0 0 1 0 3l-2 2H7zM7 18h13"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/>',
    chart: '<path d="M4 20V5M4 20h17M8 16v-4M13 16V8M18 16v-7"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    task: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    warning: '<path d="m12 3 9 17H3zM12 9v4M12 17h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.3 2.3-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.3-2.3.1-.1A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.5-1H5v-3h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.3-2.3.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
    board: '<rect x="4" y="4" width="16" height="13" rx="1"/><path d="M8 21h8M12 17v4M7 9h10M7 13h6"/>',
    notebook: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 3v18M11 8h5M11 12h5"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    math: '<path d="M5 7h14M5 17h14M12 4v6M9 14l6 6M15 14l-6 6"/>',
    text: '<path d="M4 5h16M12 5v14M8 19h8"/>',
    list: '<path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    function: '<path d="M6 5h12M12 5c-4 3-4 11 0 14M8 12h8"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    puzzle: '<path d="M9 4h3a2 2 0 1 1 4 2v2h2v4h-2a2 2 0 1 0 0 4h2v4H8v-2a2 2 0 1 0-4 0v2H2v-8h2a2 2 0 1 0 0-4H2V4h3a2 2 0 1 1 4 0z"/>',
    graph: '<path d="M4 20V5M4 20h17M7 16l4-5 3 3 5-7"/><circle cx="7" cy="16" r="1" fill="currentColor"/><circle cx="11" cy="11" r="1" fill="currentColor"/><circle cx="14" cy="14" r="1" fill="currentColor"/><circle cx="19" cy="7" r="1" fill="currentColor"/>'
    ,record: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>'
    ,stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>'
  };
  window.uiIcon = function(name, label){
    const content = paths[name] || paths.code;
    return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + content + '</svg>';
  };
  window.setUiIcon = function(element, name, label){
    element.innerHTML = window.uiIcon(name, label);
    if (label) element.setAttribute("aria-label", label);
    return element;
  };

  // 버튼·안내 문구에 남아 있는 단색 기호는 같은 SVG 체계로 바꾸고, 색상 이모지는
  // 사용자 문서/코드 영역을 제외한 앱 UI에서 제거한다. 동적으로 추가되는 UI도 처리한다.
  const symbolIcons = new Map([
    ["✓", "check"], ["✔", "check"], ["✕", "close"], ["✖", "close"],
    ["✏", "pen"], ["✎", "pen"], ["✂", "code"], ["▶", "play"],
    ["→", "arrow"], ["←", "arrow"], ["↔", "arrow"], ["↗", "arrow"], ["↩", "arrow"], ["⟲", "arrow"],
    ["⚠", "warning"], ["⚙", "settings"], ["⛶", "arrow"], ["▭", "board"], ["▦", "board"],
    ["●", "record"], ["■", "stop"]
  ]);
  const iconMatch = /[\u{1F000}-\u{1FAFF}]|[✏✎✂✓✔✕✖▶←→↔↗↩⟲⚠⚙⛶▭▦●■]\uFE0F?|\uFE0F/gu;
  const skipUiCleanup = (node) => {
    const el = node.parentElement;
    return !el || !!el.closest("svg,script,style,pre,code,textarea,input,[contenteditable],.run-output,.page,.pdf-text-layer,.text-view");
  };
  const normalizeUiText = (node) => {
    if (node.nodeType !== Node.TEXT_NODE || skipUiCleanup(node)) return;
    const source = node.nodeValue;
    if (!iconMatch.test(source)) return;
    iconMatch.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    source.replace(iconMatch, (match, index) => {
      if (index > cursor) fragment.append(document.createTextNode(source.slice(cursor, index)));
      const name = symbolIcons.get(match.replace("️", ""));
      if (name) {
        const wrap = document.createElement("span");
        wrap.className = "ui-symbol";
        wrap.setAttribute("aria-hidden", "true");
        wrap.innerHTML = window.uiIcon(name);
        fragment.append(wrap);
      }
      cursor = index + match.length;
      return match;
    });
    if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
    node.replaceWith(fragment);
  };
  const normalizeUiAttribute = (element, name) => {
    if (!element || !element.getAttribute || element.closest("pre,code,textarea,input,[contenteditable],.run-output,.page,.pdf-text-layer,.text-view")) return;
    const value = element.getAttribute(name);
    if (!value) return;
    const cleaned = value.replace(/[\u{1F000}-\u{1FAFF}]|[✏✎✂✓✔✕✖▶←→↔↗↩⟲⚠⚙⛶▭▦●■]\uFE0F?|\uFE0F/gu, "").replace(/\s{2,}/g, " ").trim();
    if (cleaned !== value) element.setAttribute(name, cleaned);
  };
  const cleanUiTree = (root) => {
    if (!root || root.nodeType === Node.TEXT_NODE) { normalizeUiText(root); return; }
    if (root.nodeType === Node.ELEMENT_NODE) ["title", "aria-label", "placeholder"].forEach((name) => normalizeUiAttribute(root, name));
    if (root.querySelectorAll) root.querySelectorAll("[title],[aria-label],[placeholder]").forEach((element) => {
      ["title", "aria-label", "placeholder"].forEach((name) => normalizeUiAttribute(element, name));
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(normalizeUiText);
  };
  const activateUiCleanup = () => {
    cleanUiTree(document.body);
    new MutationObserver((records) => records.forEach((record) => {
      record.addedNodes.forEach(cleanUiTree);
      if (record.type === "characterData") normalizeUiText(record.target);
      if (record.type === "attributes") normalizeUiAttribute(record.target, record.attributeName);
    })).observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["title", "aria-label", "placeholder"] });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", activateUiCleanup, { once:true });
  else activateUiCleanup();
})();
