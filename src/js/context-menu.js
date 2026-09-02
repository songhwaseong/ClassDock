"use strict";

/* 여러 층으로 펼쳐지는 우클릭 메뉴 — 항목이 스무 개를 넘으면 한 줄로 쌓을 수 없다.
 *
 * 화면마다 메뉴를 따로 만들면 "▸ 로 열고, 220ms 뒤에 닫고, Escape 는 한 층만 닫고,
 * 오른쪽 공간이 없으면 왼쪽으로 뒤집는다" 같은 잔손질이 그때마다 다시 필요하다.
 * 실제로 이 앱에는 같은 코드가 docx 편집기와 악보 편집기에 한 벌씩 들어 있다.
 * 여기로 모아 두면 세 번째 복사본이 생기지 않는다.
 *
 * 겉모습은 부르는 쪽 CSS 를 그대로 쓴다. base:"text-context" 를 주면
 * .text-context-menu / -sub / -parent / -sep 를 붙이므로, 이미 있는 메뉴를
 * 이 모듈로 옮겨도 보이는 모습은 한 픽셀도 바뀌지 않는다.
 *
 * 항목 = { label, title, action, disabled, children, active, separator }
 *   · children 이 있으면 부모 항목이 되고 action 은 무시한다(층을 여는 일이 곧 동작이다).
 *   · 터치·펜에는 pointerenter 가 오지 않으므로 부모는 click 으로도 열린다.
 */
const MNContextMenu = (() => {
  const SUB_CLOSE_MS = 220;      // 옆 항목으로 지나갈 때 서브메뉴가 깜빡이지 않게 두는 유예
  const MARGIN = 6;

  let layers = [];               // [0] 이 1단, 그 위로 서브메뉴가 쌓인다
  let subCloseTimer = 0;
  let outsideHandler = null, keydownHandler = null, resizeHandler = null;
  let closedCallback = null;

  const cancelSubClose = () => { clearTimeout(subCloseTimer); subCloseTimer = 0; };

  // depth 층부터 위쪽을 전부 걷어낸다. 부모 버튼의 열림 표시도 함께 지운다.
  const closeFrom = (depth) => {
    while (layers.length > depth){
      const layer = layers.pop();
      if (layer.__parentButton) layer.__parentButton.classList.remove("is-open");
      layer.remove();
    }
  };

  const close = () => {
    cancelSubClose();
    closeFrom(0);
    if (outsideHandler){ document.removeEventListener("pointerdown", outsideHandler, true); outsideHandler = null; }
    if (keydownHandler){ document.removeEventListener("keydown", keydownHandler, true); keydownHandler = null; }
    if (resizeHandler){ window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
    const done = closedCallback;
    closedCallback = null;
    if (typeof done === "function") done();
  };

  const isOpen = () => layers.length > 0;

  /* 서브메뉴는 부모 항목 오른쪽에 붙인다. 오른쪽이 모자라면 왼쪽으로 뒤집고,
     아래로 넘치면 화면 안으로 끌어올린다. 화면 밖으로 나간 층은 누를 수가 없다. */
  const placeSub = (menu, button) => {
    const anchor = button.getBoundingClientRect();
    const width = menu.offsetWidth, height = menu.offsetHeight;
    let left = anchor.right - 4;
    if (left + width > window.innerWidth - MARGIN) left = anchor.left - width + 4;
    menu.style.left = Math.max(MARGIN, left) + "px";
    menu.style.top = Math.max(MARGIN, Math.min(window.innerHeight - height - MARGIN, anchor.top - 5)) + "px";
  };

  const renderLayer = (items, depth, base) => {
    const menu = document.createElement("div");
    menu.className = depth ? (base + "-menu " + base + "-sub") : (base + "-menu");
    menu.setAttribute("role", "menu");
    menu.addEventListener("pointerenter", cancelSubClose);
    for (const item of (items || [])){
      if (!item) continue;
      if (item.separator){
        const separator = document.createElement("div");
        separator.className = base + "-sep";
        separator.setAttribute("role", "separator");
        menu.appendChild(separator);
        continue;
      }
      const children = Array.isArray(item.children) ? item.children.filter(Boolean) : [];
      if (!children.length && typeof item.action !== "function") continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(item.label == null ? "" : item.label);
      button.disabled = typeof item.disabled === "function" ? !!item.disabled() : !!item.disabled;
      if (item.title) button.title = String(item.title);
      if (item.active === undefined) button.setAttribute("role", "menuitem");
      else {
        button.setAttribute("role", "menuitemcheckbox");
        button.setAttribute("aria-checked", item.active ? "true" : "false");
        button.classList.toggle("is-active", !!item.active);
      }
      if (children.length){
        button.classList.add(base + "-parent");
        button.setAttribute("aria-haspopup", "true");
        const openChildren = () => {
          if (button.disabled) return;
          const opened = layers[depth + 1];
          if (opened && opened.__parentButton === button) return;   // 이미 이 항목의 층이 열려 있다
          closeFrom(depth + 1);
          const sub = renderLayer(children, depth + 1, base);
          sub.__parentButton = button;
          document.body.appendChild(sub);
          layers.push(sub);
          button.classList.add("is-open");
          placeSub(sub, button);
        };
        button.addEventListener("pointerenter", () => { cancelSubClose(); openChildren(); });
        button.addEventListener("click", openChildren);      // 터치·펜·키보드(Enter)용
      } else {
        // 다른 항목으로 넘어가면 열려 있던 서브메뉴를 닫는다. 대각선으로 지나가다
        // 바로 닫히면 성가시므로 잠깐 기다렸다가 닫는다.
        button.addEventListener("pointerenter", () => {
          if (layers.length <= depth + 1) return;
          cancelSubClose();
          subCloseTimer = setTimeout(() => closeFrom(depth + 1), SUB_CLOSE_MS);
        });
        // 눌러도 원래 있던 포커스·선택을 뺏지 않는다(편집기 선택이 풀리면 동작이 빗나간다).
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          if (button.disabled) return;
          close();
          item.action();
        });
      }
      menu.appendChild(button);
    }
    return menu;
  };

  /* x, y 자리에 메뉴를 연다. 이미 열려 있던 메뉴는 닫는다.
     options: { base, onClose, autoFocus } — 돌려주는 값은 이 메뉴를 닫는 함수다. */
  const open = (x, y, items, options) => {
    options = options || {};
    close();
    const base = String(options.base || "text-context");
    const menu = renderLayer(items, 0, base);
    document.body.appendChild(menu);
    layers.push(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(MARGIN, Math.min(window.innerWidth - rect.width - MARGIN, Number(x) || 0)) + "px";
    menu.style.top = Math.max(MARGIN, Math.min(window.innerHeight - rect.height - MARGIN, Number(y) || 0)) + "px";
    closedCallback = typeof options.onClose === "function" ? options.onClose : null;

    outsideHandler = (event) => {
      if (!layers.some((layer) => layer.contains(event.target))) close();
    };
    keydownHandler = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (layers.length > 1) closeFrom(layers.length - 1);   // 서브메뉴가 열려 있으면 그 층만
      else close();
    };
    resizeHandler = close;
    // 지금 처리 중인 pointerdown 이 곧바로 '바깥 클릭'으로 잡히지 않게 다음 차례로 미룬다.
    setTimeout(() => {
      if (!layers.length) return;
      document.addEventListener("pointerdown", outsideHandler, true);
      document.addEventListener("keydown", keydownHandler, true);
      window.addEventListener("resize", resizeHandler);
    }, 0);
    if (options.autoFocus){
      const first = menu.querySelector("button:not(:disabled)");
      if (first) first.focus({ preventScroll:true });
    }
    return close;
  };

  return { open, close, isOpen };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNContextMenu;
