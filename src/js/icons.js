"use strict";

// 앱 전체에서 운영체제 이모지 대신 쓰는 단색 SVG 아이콘이다.
(function(){
  const paths = {
    code: '<path d="M9 5 4 10l5 5M15 5l5 5-5 5M13 3l-2 14"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v5h5"/>',
    folder: '<path d="M3 6h7l2 2h9v10H3z"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
    table: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M9 5v14"/>',
    view: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
    column: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M10 3.5v17M6 9h12M6 15h12"/>',
    key: '<circle cx="8" cy="9" r="4"/><path d="m11 12 8 8M15 16l2-2M17 18l2-2"/>',
    index: '<path d="M6 5h13M6 12h13M6 19h13"/><circle cx="3" cy="5" r=".7" fill="currentColor"/><circle cx="3" cy="12" r=".7" fill="currentColor"/><circle cx="3" cy="19" r=".7" fill="currentColor"/>',
    foreignKey: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6M12 9l3 3-3 3"/>',
    procedure: '<path d="M6 5h12M6 19h12M8 5c-3 3-3 11 0 14M16 5c3 3 3 11 0 14"/><path d="M11 9h2M11 13h2"/>',
    trigger: '<path d="m13 2-8 12h6l-1 8 9-13h-6z"/>',
    event: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><circle cx="12" cy="15" r="2.5"/><path d="M12 13.5V15l1 1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>',
    chevronDown: '<path d="m5 9 7 7 7-7"/>',
    chevronUp: '<path d="m5 15 7-7 7 7"/>',
    save: '<path d="M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M10.5 7.5v6M7.5 10.5h6"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M7.5 10.5h6"/>',
    select: '<path d="m5 3 12 9-6 1.5L8 20z"/><path d="m12 14 4 6"/>',
    pen: '<path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 7.5l3 3"/>',
    highlighter: '<path d="m5 15 8-8 4 4-8 8H5zM12 8l4 4M4 21h16"/>',
    eraser: '<path d="m7 18-3-3a2 2 0 0 1 0-3l6-6a2 2 0 0 1 3 0l7 7a2 2 0 0 1 0 3l-2 2H7zM7 18h13"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/>',
    chart: '<path d="M4 20V5M4 20h17M8 16v-4M13 16V8M18 16v-7"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    task: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    undo: '<path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/>',
    redo: '<path d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowBoth: '<path d="M4 12h16M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
    move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
    mosaic: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
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
    ,refresh: '<path d="M21.5 4.5v5.2h-5.2"/><path d="M19.6 14.5a8 8 0 1 1-1.9-8.3l3.8 3.5"/>'
  };
  window.uiIcon = function(name){
    const content = paths[name] || paths.code;
    return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + content + '</svg>';
  };
  window.setUiIcon = function(element, name, label){
    element.innerHTML = window.uiIcon(name);
    if (label) element.setAttribute("aria-label", label);
    return element;
  };
  window.setUiIconLabel = function(element, name, label){
    element.innerHTML = window.uiIcon(name, label);
    if (label) element.append(document.createTextNode(" " + label));
    if (label) element.setAttribute("aria-label", label);
    return element;
  };

  // 버튼·안내 문구에 남아 있는 단색 기호는 같은 SVG 체계로 바꾸고, 색상 이모지는
  // 사용자 문서/코드 영역을 제외한 앱 UI에서 제거한다. 동적으로 추가되는 UI도 처리한다.
  const symbolIcons = new Map([
    ["✓", "check"], ["✔", "check"], ["✕", "close"], ["✖", "close"],
    ["✏", "pen"], ["✎", "pen"], ["✂", "code"], ["▶", "play"],
    // 방향 기호는 방향이 보여야 한다 — ←/↔ 를 →(arrow)로 함께 묶으면 좌우 버튼이 똑같이 보인다.
    ["→", "arrow"], ["←", "arrowLeft"], ["↔", "arrowBoth"], ["↗", "arrow"], ["↩", "arrow"], ["⟲", "arrow"], ["↻", "refresh"],
    ["⚠", "warning"], ["⚙", "settings"], ["⛶", "arrow"], ["▭", "board"], ["▦", "board"],
    ["●", "record"], ["■", "stop"]
  ]);
  symbolIcons.set("\u{1F5B1}", "select");
  symbolIcons.set("\u{1F58D}", "highlighter");
  symbolIcons.set("\u{1F9FD}", "eraser");
  const iconMatch = /[\u{1F000}-\u{1FAFF}]|[✏✎✂✓✔✕✖▶←→↔↗↩⟲↻⚠⚙⛶▭▦●■]\uFE0F?|\uFE0F/gu;
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
    const cleaned = value.replace(/[\u{1F000}-\u{1FAFF}]|[✏✎✂✓✔✕✖▶←→↔↗↩⟲↻⚠⚙⛶▭▦●■]\uFE0F?|\uFE0F/gu, "").replace(/\s{2,}/g, " ").trim();
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
