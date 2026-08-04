"use strict";

/* 형식 변환 창 (설계: docs/형식변환-설계.md Phase 2)
   MNDataConvert(순수 모듈)에 화면만 붙인다. 변환 규칙은 여기에 한 줄도 두지 않는다 —
   그래야 규칙은 node --test 로, 화면은 눈으로 각각 확인할 수 있다.

   결과를 내보내는 세 길은 table-export.js 가 이미 검증한 경로를 그대로 쓴다.
     복사   : copyDocumentMenuText
     저장   : saveTextDoc(text, null, name)   ← doc 을 넘기지 않아 원본 저장 상태를 건드리지 않는다
     새 탭  : handleFiles([File], { isScratch:true })
   원본 파일에 되쓰는 길은 만들지 않는다(설계 0장 비목표). 손실이 있는 변환을 덮어쓰면 되돌릴 수 없다. */
(function(){
  if (typeof window === "undefined" || !window.document) return;
  if (typeof MNDataConvert === "undefined") return;

  const FORMAT_ORDER = ["json", "jsonl", "yaml", "xml", "csv", "tsv", "md", "html"];
  const EXT_OF = { json:"json", jsonl:"jsonl", yaml:"yaml", xml:"xml", csv:"csv", tsv:"tsv", md:"md", html:"html" };
  const MIME_OF = {
    json:"application/json", jsonl:"application/x-ndjson", yaml:"text/yaml", xml:"application/xml",
    csv:"text/csv;charset=utf-8", tsv:"text/tab-separated-values;charset=utf-8",
    md:"text/markdown", html:"text/html"
  };
  const PREVIEW_ROWS = 200;                     // 미리보기는 눈으로 확인하는 용도 — 그 이상은 세로로만 길어진다
  const DEBOUNCE_MS = 200;

  let convertOpen = false;

  const dcToast = (message, ms, opts) => { if (typeof toast === "function") toast(message, ms || 2400, opts || {}); };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function option(select, value, label){
    const node = document.createElement("option");
    node.value = value; node.textContent = label;
    select.appendChild(node);
    return node;
  }

  /* 활성 문서의 내용을 입력에 미리 채운다(팔레트에서 바로 열었을 때).
     표 문서는 글자가 아니라 시트라서, 스프레드시트 뷰어가 걸어 둔 doc.sheetRows() 로 받아
     CSV 로 적어 넣는다. 사용자가 화면에서 보던 값이 그대로 입력이 된다. */
  function currentDocSeed(){
    let doc = null;
    try { doc = state; } catch(_){ return null; }
    if (!doc) return null;
    const name = String(doc.name || doc.relPath || "");
    if (typeof doc.sheetRows === "function"){
      let rows = null;
      try { rows = doc.sheetRows(); } catch(_){ rows = null; }
      if (rows && rows.length){
        const text = MNDataConvert.serialize({ table:MNDataConvert.fromRows(rows, false) }, "csv", { bom:false }).text;
        if (text.trim()) return { text, name, from:"csv", doc };
      }
    }
    let text = "";
    try {
      if (doc.codeEditor && typeof doc.codeEditor.getValue === "function") text = String(doc.codeEditor.getValue() || "");
      else if (typeof doc.savedText === "string") text = doc.savedText;
    } catch(_){ return null; }
    if (!text.trim()) return null;
    return { text, name, doc };
  }

  const stripExtension = (name) => String(name || "").replace(/\.[^.\\/]+$/, "");

  function sanitizeName(value){
    return String(value == null ? "" : value)
      .replace(/[\\/:*?"<>|\r\n]/g, "").trim().replace(/[. ]+$/g, "").slice(0, 80) || "변환";
  }

  function siblingWorkspacePath(doc, name){
    const source = String((doc && (doc.workspacePath || doc.relPath)) || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = source.lastIndexOf("/");
    return slash >= 0 ? source.slice(0, slash + 1) + name : name;
  }

  async function fallbackCopy(text){
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch(_){ }
    try {
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return !!ok;
    } catch(_){ return false; }
  }

  function openDataConvert(seed){
    if (convertOpen) return;
    convertOpen = true;

    const start = seed && seed.text ? seed : (currentDocSeed() || { text:"", name:"" });
    const sourceDoc = start.doc || null;

    const modal = el("div", "modal data-convert-modal");
    const card = el("div", "modal-card data-convert-card");
    card.append(
      el("h3", null, "형식 변환"),
      el("p", "data-convert-sub", "JSON·CSV·표·마크다운 사이를 서로 바꿔요. 변환 전에 무엇이 손실되는지 먼저 알려드려요. 원본 파일은 바뀌지 않고, 결과는 복사·새 파일로만 나갑니다.")
    );

    // ── 위: 어느 형식에서 어느 형식으로 ──
    const head = el("div", "data-convert-head");
    const fromSelect = el("select", "data-convert-format");
    const toSelect = el("select", "data-convert-format");
    for (const key of FORMAT_ORDER){
      option(fromSelect, key, MNDataConvert.FORMATS[key].label);
      option(toSelect, key, MNDataConvert.FORMATS[key].label);
    }
    const autoTag = el("span", "data-convert-auto", "자동 인식");
    head.append(el("span", "data-convert-head-cap", "입력"), fromSelect, autoTag, el("span", "data-convert-arrow", "→"), el("span", "data-convert-head-cap", "출력"), toSelect);

    // ── 가운데: 입력 / 미리보기 ──
    const panes = el("div", "data-convert-panes");

    const inputPane = el("div", "data-convert-pane");
    inputPane.appendChild(el("div", "data-convert-pane-cap", "입력"));
    const input = el("textarea", "data-convert-input");
    input.spellcheck = false;
    input.placeholder = "여기에 붙여넣거나, 텍스트 문서를 연 채로 이 창을 열면 자동으로 채워져요.";
    input.value = start.text || "";
    inputPane.appendChild(input);

    const outputPane = el("div", "data-convert-pane");
    const outputCap = el("div", "data-convert-pane-cap");
    outputCap.appendChild(el("span", null, "미리보기"));
    const viewToggle = el("div", "data-convert-view");
    const gridBtn = el("button", "data-convert-view-btn on", "표");
    const rawBtn = el("button", "data-convert-view-btn", "원문");
    gridBtn.type = "button"; rawBtn.type = "button";
    viewToggle.append(gridBtn, rawBtn);
    outputCap.appendChild(viewToggle);
    const output = el("div", "data-convert-output");
    outputPane.append(outputCap, output);

    panes.append(inputPane, outputPane);

    // ── 손실 배너 ──
    const banner = el("div", "data-convert-loss");
    const bannerHead = el("button", "data-convert-loss-head");
    bannerHead.type = "button";
    const bannerText = el("span", "data-convert-loss-text");
    const bannerCaret = el("span", "data-convert-loss-caret", "▸");
    bannerHead.append(bannerText, bannerCaret);
    const bannerList = el("div", "data-convert-loss-list");
    bannerList.hidden = true;
    banner.append(bannerHead, bannerList);

    // ── 옵션 ──
    const opts = el("div", "data-convert-opts");
    function mkSelect(labelText, values, titleText){
      const wrap = el("label", "data-convert-opt");
      if (titleText) wrap.title = titleText;
      wrap.appendChild(el("span", null, labelText));
      const select = document.createElement("select");
      for (const [value, label] of values) option(select, value, label);
      wrap.appendChild(select);
      opts.appendChild(wrap);
      return { wrap, select };
    }
    function mkCheck(labelText, checked, titleText){
      const wrap = el("label", "data-convert-opt data-convert-check");
      if (titleText) wrap.title = titleText;
      const box = document.createElement("input");
      box.type = "checkbox"; box.checked = !!checked;
      wrap.append(box, el("span", null, labelText));
      opts.appendChild(wrap);
      return { wrap, box };
    }
    const flattenOpt = mkSelect("평탄화", [
      ["path", "경로 (되돌릴 수 있음)"],
      ["join", "합치기"],
      ["explode", "행 복제"]
    ], "중첩 구조와 배열을 표로 펴는 방식이에요. '경로'만 원래대로 되돌릴 수 있어요.");
    const inferOpt = mkCheck("타입 추론", true, "3 을 숫자로, true 를 불리언으로 읽어요. 끄면 모두 문자열이 돼요. 앞자리 0(00123)은 켜 두어도 문자열로 남아요.");
    const emptyOpt = mkSelect("빈 칸", [
      ["omit", "키 없음"],
      ["string", "빈 문자열"],
      ["null", "null"]
    ], "표의 빈 칸을 되돌릴 때 무엇으로 볼지 정해요.");
    const delimiterOpt = mkSelect("구분자", [
      [",", "쉼표 ,"],
      [";", "세미콜론 ;"],
      ["\t", "탭"]
    ], "CSV 의 칸 구분 문자예요.");
    const headerOpt = mkCheck("첫 줄은 헤더", true, "표 입력의 첫 줄을 컬럼 이름으로 읽어요.");
    const bomOpt = mkCheck("엑셀용 BOM", true, "엑셀에서 한글이 깨지지 않도록 파일 앞에 표시를 붙여요.");
    function mkText(labelText, placeholder, titleText){
      const wrap = el("label", "data-convert-opt");
      if (titleText) wrap.title = titleText;
      wrap.appendChild(el("span", null, labelText));
      const field = document.createElement("input");
      field.type = "text"; field.placeholder = placeholder; field.autocomplete = "off"; field.spellcheck = false;
      wrap.appendChild(field);
      opts.appendChild(wrap);
      return { wrap, field };
    }
    // XML 은 바깥 묶음과 항목의 요소 이름이 필요하다. XML 에서 읽어 온 경우엔 원래 이름을 그대로 이어 쓴다.
    const xmlRootOpt = mkText("바깥 요소", "rows", "목록 전체를 감싸는 XML 요소 이름이에요.");
    const xmlItemOpt = mkText("항목 요소", "row", "목록의 각 항목을 감싸는 XML 요소 이름이에요.");

    // ── 버튼 ──
    const actions = el("div", "modal-actions");
    const close = el("button", "btn", "닫기");
    const copyBtn = el("button", "btn", "복사");
    const sheetBtn = el("button", "btn", "표 편집기로");
    sheetBtn.title = "변환 결과의 복사본을 새 탭의 표 편집기(xlsx)로 열어요.";
    const saveBtn = el("button", "btn", "파일로 저장");
    const openBtn = el("button", "btn primary", "새 탭으로 열기");
    for (const button of [close, copyBtn, sheetBtn, saveBtn, openBtn]) button.type = "button";
    actions.append(close, el("span", "spacer"), copyBtn, sheetBtn, saveBtn, openBtn);

    card.append(head, panes, banner, opts, actions);
    modal.appendChild(card);

    // ── 상태 ──
    let result = null;                 // 마지막 성공한 변환 { text, loss, … }
    let rawView = false;
    let timer = 0;
    let manualFrom = false;            // 사용자가 입력 형식을 직접 고르면 자동 인식을 멈춘다
    let yamlLoading = false;
    let yamlFailed = false;

    const needsLazyLibrary = (options) =>
      [options.from, options.to].some(format => MNDataConvert.FORMATS[format] && MNDataConvert.FORMATS[format].needs === "yaml");

    function ensureYaml(){
      if (yamlLoading || yamlFailed) return;
      yamlLoading = true;
      (async () => {
        try {
          if (typeof MNLazy !== "undefined" && typeof MNLazy.tryNeed === "function") await MNLazy.tryNeed("yaml");
        } catch(_){ }
        yamlLoading = false;
        if (!MNDataConvert.yamlReady()) yamlFailed = true;
        if (modal.isConnected) run();
      })();
    }

    const currentOptions = () => ({
      from: fromSelect.value,
      to: toSelect.value,
      name: start.name,
      flatten: flattenOpt.select.value,
      inferTypes: inferOpt.box.checked,
      emptyAs: emptyOpt.select.value,
      delimiter: delimiterOpt.select.value,
      header: headerOpt.box.checked,
      bom: bomOpt.box.checked,
      xmlRoot: xmlRootOpt.field.value.trim(),
      xmlItem: xmlItemOpt.field.value.trim()
    });

    // 지금 조합에서 뜻이 없는 옵션은 감춘다 — 늘 다 보이면 무엇이 영향을 주는지 알기 어렵다.
    function syncOptionVisibility(){
      const fromShape = MNDataConvert.FORMATS[fromSelect.value].shape;
      const toShape = MNDataConvert.FORMATS[toSelect.value].shape;
      flattenOpt.wrap.hidden = toShape !== "table";
      emptyOpt.wrap.hidden = fromShape !== "table";
      inferOpt.wrap.hidden = fromShape !== "table";
      headerOpt.wrap.hidden = fromShape !== "table";
      delimiterOpt.wrap.hidden = !(fromSelect.value === "csv" || toSelect.value === "csv");
      bomOpt.wrap.hidden = toSelect.value !== "csv";
      xmlRootOpt.wrap.hidden = toSelect.value !== "xml";
      xmlItemOpt.wrap.hidden = toSelect.value !== "xml";
      viewToggle.hidden = toShape !== "table";
      if (toShape !== "table") rawView = true;
    }

    function setActionsEnabled(enabled){
      for (const button of [copyBtn, saveBtn, openBtn]) button.disabled = !enabled;
      // 표 편집기는 격자로 담을 수 있는 결과일 때만 뜻이 있다.
      sheetBtn.hidden = MNDataConvert.FORMATS[toSelect.value].shape !== "table"
        || typeof MNTableExport === "undefined";
      sheetBtn.disabled = !enabled;
    }

    function renderError(message){
      output.innerHTML = "";
      const box = el("div", "data-convert-error");
      box.append(el("b", null, "읽지 못했어요"), el("span", null, message));
      output.appendChild(box);
      banner.className = "data-convert-loss error";
      bannerText.textContent = "변환할 수 없어요.";
      bannerCaret.hidden = true;
      bannerList.hidden = true;
      setActionsEnabled(false);
    }

    function renderGrid(text, format, options){
      let table = null;
      try { table = MNDataConvert.parse(text, format, options).table; } catch(_){ table = null; }
      if (!table) return null;
      const wrap = el("div", "data-convert-grid-wrap");
      const grid = el("table", "data-convert-grid");
      if (table.header && table.columns.length){
        const head = document.createElement("thead");
        const row = document.createElement("tr");
        for (const column of table.columns) row.appendChild(el("th", null, column));
        head.appendChild(row);
        grid.appendChild(head);
      }
      const body = document.createElement("tbody");
      table.rows.slice(0, PREVIEW_ROWS).forEach(cells => {
        const row = document.createElement("tr");
        cells.forEach(cell => {
          const td = el("td", null, cell && cell.v !== undefined && cell.v !== null ? cell.raw : "");
          if (!cell || cell.v === undefined || cell.v === null) td.className = "empty";
          row.appendChild(td);
        });
        body.appendChild(row);
      });
      grid.appendChild(body);
      wrap.appendChild(grid);
      if (table.rows.length > PREVIEW_ROWS){
        wrap.appendChild(el("div", "data-convert-grid-more", table.rows.length + "행 중 앞 " + PREVIEW_ROWS + "행만 보여드려요. 저장하면 전체가 나갑니다."));
      }
      return wrap;
    }

    function renderLoss(loss){
      bannerList.innerHTML = "";
      bannerCaret.hidden = false;
      if (!loss.length){
        banner.className = "data-convert-loss ok";
        bannerText.textContent = "손실 없이 변환됩니다.";
        bannerCaret.hidden = true;
        bannerList.hidden = true;
        return;
      }
      banner.className = "data-convert-loss warn";
      bannerText.textContent = "⚠ " + loss.length + "가지가 손실됩니다";
      for (const item of loss){
        const row = el("div", "data-convert-loss-item");
        const top = el("div", "data-convert-loss-top");
        top.appendChild(el("code", null, item.code));
        if (item.path) top.appendChild(el("span", "data-convert-loss-path", item.path));
        if (item.count > 1) top.appendChild(el("span", "data-convert-loss-count", "×" + item.count));
        row.appendChild(top);
        if (item.before || item.after){
          const change = el("div", "data-convert-loss-change");
          change.append(el("span", "before", item.before || "(빈 값)"), el("span", "arrow", "→"), el("span", "after", item.after || "(빈 값)"));
          row.appendChild(change);
        }
        if (item.hint) row.appendChild(el("div", "data-convert-loss-hint", item.hint));
        bannerList.appendChild(row);
      }
    }

    function run(){
      const text = input.value;
      if (!text.trim()){
        result = null;
        output.innerHTML = "";
        output.appendChild(el("div", "data-convert-empty", "입력이 비어 있어요."));
        banner.className = "data-convert-loss";
        bannerText.textContent = "";
        bannerCaret.hidden = true;
        bannerList.hidden = true;
        setActionsEnabled(false);
        return;
      }
      if (!manualFrom){
        const detected = MNDataConvert.detectFormat(text, start.name);
        if (detected !== fromSelect.value){ fromSelect.value = detected; syncOptionVisibility(); }
      }
      const options = currentOptions();
      // YAML 은 라이브러리를 그때 싣는다(MNLazy). 다 실릴 때까지는 안내만 보여 주고 기다린다.
      if (needsLazyLibrary(options) && !MNDataConvert.yamlReady()){
        if (yamlFailed){ renderError("YAML 라이브러리를 불러오지 못했어요."); return; }
        output.innerHTML = "";
        output.appendChild(el("div", "data-convert-empty", "YAML 라이브러리를 불러오는 중이에요…"));
        setActionsEnabled(false);
        ensureYaml();
        return;
      }
      try {
        result = MNDataConvert.convert(text, options);
      } catch(error){
        result = null;
        renderError(String((error && error.message) || error));
        return;
      }
      setActionsEnabled(true);
      renderLoss(result.loss);
      output.innerHTML = "";
      const shape = MNDataConvert.FORMATS[options.to].shape;
      const grid = (!rawView && shape === "table") ? renderGrid(result.text, options.to, options) : null;
      if (grid) output.appendChild(grid);
      else output.appendChild(el("pre", "data-convert-raw", result.text));
      gridBtn.classList.toggle("on", !rawView);
      rawBtn.classList.toggle("on", rawView);
    }

    // 입력과 마지막 성공 결과가 어긋난 채 내보내지 않도록, 디바운스 대기 중에는 결과를 즉시 무효화한다.
    const schedule = () => {
      clearTimeout(timer);
      result = null;
      setActionsEnabled(false);
      timer = setTimeout(run, DEBOUNCE_MS);
    };

    const suggestedName = () => sanitizeName(stripExtension(start.name) || "변환") + "." + EXT_OF[toSelect.value];

    // ── 배선 ──
    const shut = () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      modal.remove();
      convertOpen = false;
    };
    const onKey = (event) => {
      if (event.key === "Escape"){ event.stopPropagation(); shut(); }
    };
    window.addEventListener("keydown", onKey, true);
    modal.addEventListener("click", (event) => { if (event.target === modal) shut(); });
    close.addEventListener("click", shut);

    input.addEventListener("input", schedule);
    fromSelect.addEventListener("change", () => { manualFrom = true; autoTag.hidden = true; syncOptionVisibility(); run(); });
    toSelect.addEventListener("change", () => { rawView = false; syncOptionVisibility(); run(); });
    for (const control of [flattenOpt.select, emptyOpt.select, delimiterOpt.select])
      control.addEventListener("change", run);
    for (const control of [inferOpt.box, headerOpt.box, bomOpt.box])
      control.addEventListener("change", run);
    for (const control of [xmlRootOpt.field, xmlItemOpt.field])
      control.addEventListener("input", schedule);
    gridBtn.addEventListener("click", () => { rawView = false; run(); });
    rawBtn.addEventListener("click", () => { rawView = true; run(); });
    bannerHead.addEventListener("click", () => {
      bannerList.hidden = !bannerList.hidden;
      bannerCaret.textContent = bannerList.hidden ? "▸" : "▾";
    });

    copyBtn.addEventListener("click", async () => {
      if (!result) return;
      const ok = (typeof copyDocumentMenuText === "function")
        ? await copyDocumentMenuText(result.text, "변환 결과를 복사했어요.")
        : await fallbackCopy(result.text);
      dcToast(ok ? "변환 결과를 복사했어요." : "복사하지 못했어요.");
    });

    sheetBtn.addEventListener("click", async () => {
      if (!result || typeof MNTableExport === "undefined") return;
      const options = currentOptions();
      let table = null;
      try { table = MNDataConvert.parse(result.text, options.to, options).table; } catch(_){ table = null; }
      if (!table){ dcToast("표로 옮기지 못했어요."); return; }
      // MNTableExport 의 표 블록 모양({rows, header})으로 넘긴다 — 거기서 검증된 xlsx 탭 경로를 그대로 쓴다.
      const ok = await MNTableExport.openInEditor(
        { rows:MNDataConvert.toRows(table), header:table.header },
        { baseName:stripExtension(suggestedName()), doc:sourceDoc }
      );
      if (ok) shut();
    });

    saveBtn.addEventListener("click", async () => {
      if (!result) return;
      const name = suggestedName();
      // doc 을 넘기지 않는다(=null) — 원본 문서의 저장 상태는 이 저장에 영향받지 않는다.
      let ok = false;
      if (typeof saveTextDoc === "function") ok = (await saveTextDoc(result.text, null, name)) === true;
      dcToast(ok ? name + " 으로 내보냈어요." : "저장하지 못했어요.");
    });

    openBtn.addEventListener("click", async () => {
      if (!result) return;
      if (typeof handleFiles !== "function"){ dcToast("새 탭으로 열 수 없어요."); return; }
      const name = suggestedName();
      const to = toSelect.value;
      try {
        await handleFiles([new File([result.text], name, { type:MIME_OF[to] || "text/plain" })], {
          isScratch:true,                                   // 아직 디스크에 없는 새 파일 → 첫 저장 때 이름·위치를 받는다
          workspacePath:siblingWorkspacePath(sourceDoc, name),
          parentId:(sourceDoc && sourceDoc.parentId) || null,
          fsDirHandle:(sourceDoc && sourceDoc.fsDirHandle) || null
        });
      } catch(error){
        console.error(error);
        dcToast("새 탭으로 열지 못했어요.");
        return;
      }
      shut();
      dcToast(name + " 탭을 열었어요.");
    });

    // ── 열기 ──
    // 부른 쪽이 형식을 알고 넘겼으면(표 블록·시트 등) 그 말을 믿고 자동 인식을 끈다.
    const detected = start.from || (start.text ? MNDataConvert.detectFormat(start.text, start.name) : "json");
    fromSelect.value = MNDataConvert.FORMATS[detected] ? detected : "json";
    toSelect.value = MNDataConvert.FORMATS[fromSelect.value].shape === "table" ? "json" : "csv";
    if (start.from){ manualFrom = true; }
    if (start.header === false) headerOpt.box.checked = false;
    autoTag.hidden = !start.text || manualFrom;
    syncOptionVisibility();

    document.body.appendChild(modal);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);
    run();
    requestAnimationFrame(() => { try { (start.text ? toSelect : input).focus(); } catch(_){} });
  }

  window.openDataConvert = openDataConvert;
})();
