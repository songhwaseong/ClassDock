/* SQL 덤프 — 고른 스키마 객체를 CREATE·INSERT 문이 든 .sql 파일 하나로 내보낸다.
   (mysqldump 가 하는 일을 앱 안에서 한다. 편집·삭제까지 되는 도구인데 되돌릴 수단이 없어서다.)

   여기는 화면만 맡는다. 파일을 만드는 일은 워커가, 저장 위치를 정하는 일은 런처가 한다 —
   경로를 프런트가 정하면 SaveRoot 아래로 묶는 정책이 뜻을 잃는다. 그래서 이 모듈은
   "이름"만 보내고 어디에 쓰였는지는 응답으로 돌려받는다.

   오래 걸리는 작업이라 시작만 하고 결과는 폴링으로 가져간다(쿼리 실행과 같은 방식).
   진행 보고는 워커가 흘려 보내는 것을 런처가 모아 둔 것이다. */

const MNDbDump = (() => {
  const POLL_MS = 300;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const button = (label, className, title) => {
    const node = el("button", className || "db-btn", label);
    node.type = "button";
    if (title) node.title = title;
    return node;
  };

  const checkbox = (checked) => {
    const node = document.createElement("input");
    node.type = "checkbox";
    node.checked = !!checked;
    return node;
  };

  const option = (labelText, checked, title) => {
    const wrap = el("label", "db-dump-option");
    const box = checkbox(checked);
    wrap.append(box, el("span", null, labelText));
    if (title) wrap.title = title;
    return { wrap, box };
  };

  const notify = (message, ms) => { if (typeof toast === "function") toast(message, ms || 3000); };

  /* 같은 이름의 파일이 이미 있는지 저장 폴더에 물어본다. 덤프는 통째로 덮어쓰므로
     말없이 지나가면 지난 백업이 사라진다. 확인할 수 없으면(엔드포인트가 없거나 실패)
     막지 않는다 — 저장 자체는 런처가 다시 판정한다. */
  const savedFileExists = async (name) => {
    try {
      const response = await fetch("/save-file-exists", {
        method:"POST", headers:{ "X-Save-Path":encodeURIComponent(name) }
      });
      return response.ok && (await response.text()).trim().toLowerCase() === "yes";
    } catch(_){ return false; }
  };

  const messageFor = (info) => (typeof MNDbClient !== "undefined" && MNDbClient.messageFor)
    ? MNDbClient.messageFor(info) : "덤프하지 못했습니다.";

  const sizeText = (bytes) => {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + "MB";
    if (value >= 1024) return Math.round(value / 1024) + "KB";
    return value + "B";
  };

  const countText = (value) => Number(value || 0).toLocaleString();

  /* 파일 이름은 사용자가 고치기 전의 기본값이다. 접속 문서 이름이 아니라 데이터베이스
     이름을 쓰는 이유는 덤프의 내용이 문서가 아니라 그 데이터베이스이기 때문이다. */
  const defaultFileName = (database) => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
      + "_" + pad(now.getHours()) + pad(now.getMinutes());
    return (String(database || "dump").replace(/[\\/:*?"<>|]/g, "_") || "dump") + "_" + stamp + ".sql";
  };

  const GROUPS = [
    { type:"table", label:"테이블" },
    { type:"view", label:"뷰" },
    { type:"procedure", label:"프로시저" },
    { type:"function", label:"함수" },
    { type:"trigger", label:"트리거" },
    { type:"event", label:"이벤트" }
  ];

  const MODES = [
    { value:"both", label:"구조 + 데이터" },
    { value:"structure", label:"구조만" },
    { value:"data", label:"데이터만" }
  ];

  /* 대상 목록. schemaObjects 는 이미 트리에 그려져 있는 것을 그대로 받는다 —
     같은 것을 서버에 다시 묻지 않는다. */
  const targetsOf = (schemaObjects) => (schemaObjects || [])
    .filter(item => item && item.name && GROUPS.some(group => group.type === item.type))
    .map(item => ({ kind:item.type, name:String(item.name) }));

  const keyOf = (target) => target.kind + ":" + target.name;

  /* 요청 값의 순서는 런처의 StartDbDump 가 읽는 순서와 한 자리도 어긋나면 안 된다.
     어긋나도 오류가 나지 않고 조용히 다른 옵션으로 덤프된다(모드 자리에 파일 이름이
     들어가는 식이다). 그래서 창에서 떼어 내 따로 만들고, 테스트가 런처와 나란히 놓고 본다. */
  const requestValues = (request) => {
    const picked = (request && request.objects) || [];
    const values = [
      String((request && request.name) || ""),
      String((request && request.mode) || "structure"),
      request && request.dropIfExists ? "1" : "0",
      request && request.createIfNotExists ? "1" : "0",
      String((request && request.insertForm) || "insert"),
      request && request.columnNames ? "1" : "0",
      String(Math.max(0, Number(request && request.rowLimit) || 0)),
      request && request.consistent ? "1" : "0",
      String((request && request.database) || ""),
      String(picked.length)
    ];
    picked.forEach((item) => { values.push(String(item.kind), String(item.name)); });
    return values;
  };

  /* ── 창 ────────────────────────────────────────────────────────────────── */

  const open = (context) => {
    const sessionId = context && context.sessionId;
    if (!sessionId) return null;
    if (document.querySelector(".db-dump-modal")) return null;

    const database = String((context && context.database) || "");
    const targets = targetsOf(context && context.schemaObjects);
    const preselect = new Set((context && context.preselect) || []);

    const modal = el("div", "modal db-table-modal db-dump-modal");
    const card = el("div", "modal-card db-table-card db-dump-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "SQL 덤프 내보내기");

    const head = el("div", "db-table-modal-head");
    const headIcon = el("span", "db-table-modal-icon");
    if (typeof uiIcon === "function") headIcon.innerHTML = uiIcon("save");
    const heading = el("div", "db-table-modal-heading");
    heading.append(el("h3", null, "SQL 덤프 내보내기"),
      el("p", "sub", (database || "현재 데이터베이스") + " · 고른 객체를 .sql 파일 하나로 저장합니다"));
    const closeButton = button("", "db-table-modal-close", "닫기");
    closeButton.setAttribute("aria-label", "닫기");
    if (typeof uiIcon === "function") closeButton.innerHTML = uiIcon("close");
    head.append(headIcon, heading, closeButton);

    const body = el("div", "db-table-modal-body db-dump-body");

    /* 대상 고르기 ------------------------------------------------------- */

    const pickHead = el("div", "db-dump-pick-head");
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "이름으로 찾기";
    search.setAttribute("aria-label", "내보낼 객체 찾기");
    const selectAll = button("모두 선택", "db-btn db-btn-quiet");
    const selectNone = button("모두 해제", "db-btn db-btn-quiet");
    pickHead.append(search, selectAll, selectNone);

    const list = el("div", "db-dump-list");
    const chosen = new Set(targets.filter(item => preselect.has(keyOf(item))).map(keyOf));
    // 미리 고른 것이 없으면 테이블을 기본으로 잡는다(가장 자주 쓰는 백업 모양이다).
    if (!chosen.size) targets.filter(item => item.kind === "table").forEach(item => chosen.add(keyOf(item)));

    const boxes = new Map();
    const renderList = () => {
      const needle = search.value.trim().toLowerCase();
      list.innerHTML = "";
      boxes.clear();
      let shown = 0;
      GROUPS.forEach((group) => {
        const items = targets.filter(item => item.kind === group.type
          && (!needle || item.name.toLowerCase().includes(needle)));
        if (!items.length) return;
        shown += items.length;
        const section = el("section", "db-dump-group");
        const groupHead = el("div", "db-dump-group-head");
        const groupBox = checkbox(items.every(item => chosen.has(keyOf(item))));
        groupBox.indeterminate = !groupBox.checked && items.some(item => chosen.has(keyOf(item)));
        const groupLabel = el("label", "db-dump-group-label");
        groupLabel.append(groupBox, el("span", null, group.label),
          el("span", "db-dump-count", String(items.length)));
        groupBox.addEventListener("change", () => {
          items.forEach(item => {
            if (groupBox.checked) chosen.add(keyOf(item));
            else chosen.delete(keyOf(item));
          });
          renderList();
          refreshSummary();
        });
        groupHead.append(groupLabel);
        section.append(groupHead);

        const entries = el("div", "db-dump-group-items");
        items.forEach((item) => {
          const row = el("label", "db-dump-item");
          const box = checkbox(chosen.has(keyOf(item)));
          box.addEventListener("change", () => {
            if (box.checked) chosen.add(keyOf(item));
            else chosen.delete(keyOf(item));
            renderList();
            refreshSummary();
          });
          row.append(box, el("span", "db-dump-item-name", item.name));
          entries.append(row);
          boxes.set(keyOf(item), box);
        });
        section.append(entries);
        list.append(section);
      });
      if (!shown) list.append(el("p", "db-empty", needle ? "찾는 이름의 객체가 없습니다." : "내보낼 객체가 없습니다."));
    };

    /* 내용과 옵션 ------------------------------------------------------- */

    const modeRow = el("div", "db-dump-modes");
    const modeInputs = MODES.map((item) => {
      const wrap = el("label", "db-dump-mode");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "db-dump-mode";
      radio.value = item.value;
      radio.checked = item.value === "both";
      wrap.append(radio, el("span", null, item.label));
      modeRow.append(wrap);
      return radio;
    });
    const modeOf = () => (modeInputs.find(item => item.checked) || modeInputs[0]).value;

    const dropOption = option("DROP 문 넣기", true,
      "같은 이름이 있으면 지우고 다시 만듭니다. 끄면 이미 있는 객체에서 복원이 멈춥니다.");
    const existsOption = option("CREATE TABLE IF NOT EXISTS", false,
      "이미 있는 테이블은 건너뜁니다(테이블에만 적용됩니다).");
    const consistentOption = option("한 시점으로 맞추기", true,
      "InnoDB 스냅샷으로 테이블 사이의 시점이 어긋나지 않게 합니다.");
    const columnOption = option("컬럼 이름 적기", true,
      "INSERT 에 컬럼 목록을 적습니다. 생성 컬럼이 있으면 꺼도 자동으로 적습니다.");

    const formSelect = document.createElement("select");
    [["insert", "INSERT"], ["ignore", "INSERT IGNORE"], ["replace", "REPLACE"]].forEach(([value, label]) => {
      const item = document.createElement("option");
      item.value = value;
      item.textContent = label;
      formSelect.append(item);
    });
    const formField = el("label", "db-field db-dump-field");
    formField.append(el("span", "db-field-label", "INSERT 형식"), formSelect);

    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "0";
    limitInput.value = "0";
    const limitField = el("label", "db-field db-dump-field");
    limitField.append(el("span", "db-field-label", "테이블당 행 수 (0 = 전체)"), limitInput);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = defaultFileName(database);
    const nameField = el("label", "db-field db-dump-field db-dump-name");
    nameField.append(el("span", "db-field-label", "파일 이름"), nameInput);

    const optionBox = el("div", "db-dump-options");
    optionBox.append(dropOption.wrap, existsOption.wrap, consistentOption.wrap, columnOption.wrap);
    const dataBox = el("div", "db-dump-data-options");
    dataBox.append(formField, limitField);

    const settings = el("div", "db-dump-settings");
    settings.append(el("h4", "db-dump-heading", "내용"), modeRow,
      el("h4", "db-dump-heading", "옵션"), optionBox, dataBox,
      el("h4", "db-dump-heading", "저장"), nameField);

    const columns = el("div", "db-dump-columns");
    const pickPane = el("div", "db-dump-pane");
    pickPane.append(el("h4", "db-dump-heading", "내보낼 객체"), pickHead, list);
    columns.append(pickPane, settings);

    /* 아래쪽 — 요약·진행·단추 ------------------------------------------- */

    const foot = el("div", "db-dump-foot");
    const summary = el("p", "db-dump-summary");
    const progress = el("p", "db-dump-progress");
    progress.hidden = true;
    const startButton = button("내보내기", "db-btn db-btn-primary");
    const cancelButton = button("중단", "db-btn db-btn-quiet");
    cancelButton.hidden = true;
    const closeFoot = button("닫기", "db-btn db-btn-quiet");
    const actions = el("div", "db-dump-actions");
    actions.append(cancelButton, closeFoot, startButton);
    const status = el("div", "db-dump-status");
    status.append(summary, progress);
    foot.append(status, actions);

    // 데이터를 담지 않는 모드에서는 데이터 옵션을 흐리게 둔다(끄지 않고 이유를 보인다).
    const refreshMode = () => {
      const withData = modeOf() !== "structure";
      dataBox.classList.toggle("disabled", !withData);
      formSelect.disabled = !withData;
      limitInput.disabled = !withData;
      consistentOption.box.disabled = !withData;
      columnOption.box.disabled = !withData;
      const withStructure = modeOf() !== "data";
      dropOption.box.disabled = !withStructure;
      existsOption.box.disabled = !withStructure;
    };

    const refreshSummary = () => {
      const count = chosen.size;
      summary.textContent = count
        ? "객체 " + countText(count) + "개 · " + (MODES.find(item => item.value === modeOf()) || {}).label
        : "내보낼 객체를 하나 이상 골라 주세요.";
      startButton.disabled = !count || running;
    };

    body.append(columns);
    card.append(head, body, foot);
    modal.append(card);
    document.body.append(modal);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);

    /* ── 실행 ────────────────────────────────────────────────────────────── */

    let running = false;
    let job = "";
    let closed = false;
    let lastPath = "";                      // 런처가 정해 준 저장 경로(응답으로 받는다)

    const close = () => {
      if (running){
        // 창을 닫아도 서버 쪽 작업은 계속 돈다. 말없이 사라지면 파일이 언제 생기는지 알 수 없다.
        notify("덤프는 계속 진행됩니다. 끝나면 알려 드립니다.", 3000);
      }
      closed = true;
      window.removeEventListener("keydown", onKey, true);
      modal.remove();
    };

    const onKey = (event) => {
      if (event.key === "Escape"){
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    closeButton.addEventListener("click", close);
    closeFoot.addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });

    const setRunning = (on) => {
      running = on;
      startButton.disabled = on || !chosen.size;
      startButton.textContent = on ? "내보내는 중…" : "내보내기";
      cancelButton.hidden = !on;
      progress.hidden = !on;
      [search, selectAll, selectNone, nameInput, formSelect, limitInput].forEach(item => { item.disabled = on; });
      modeInputs.forEach(item => { item.disabled = on; });
      [dropOption.box, existsOption.box, consistentOption.box, columnOption.box]
        .forEach(item => { item.disabled = on; });
      boxes.forEach(box => { box.disabled = on; });
      if (!on) refreshMode();
    };

    const showProgress = (info) => {
      if (!info){
        progress.textContent = "준비하는 중…";
        return;
      }
      const phase = String(info.phase || "");
      const parts = [];
      if (phase === "schema") parts.push("정의를 읽는 중…");
      else {
        if (info.total) parts.push("테이블 " + countText(info.done) + "/" + countText(info.total));
        if (info.object) parts.push(String(info.object));
        if (info.rows) parts.push(countText(info.rows) + "행");
      }
      if (info.bytes) parts.push(sizeText(info.bytes));
      progress.textContent = parts.join(" · ") || "진행 중…";
    };

    const finish = (response, savedPath) => {
      setRunning(false);
      job = "";
      const info = (response && response.info) || {};
      if (!response || !response.ok){
        const code = String(info.code || "");
        if (code === "cancelled"){
          progress.hidden = false;
          progress.textContent = "중단했습니다. 파일을 만들지 않았습니다.";
          notify("덤프를 중단했습니다. 만들다 만 파일은 남기지 않았습니다.", 3200);
          return;
        }
        progress.hidden = false;
        progress.textContent = messageFor(info);
        notify(messageFor(info), 4200);
        return;
      }
      const counts = info.counts || {};
      const objectCount = GROUPS.reduce((sum, group) => sum + (Number(counts[group.type]) || 0), 0);
      const bits = ["객체 " + countText(objectCount) + "개"];
      if (info.rows) bits.push(countText(info.rows) + "행");
      bits.push(sizeText(info.bytes));
      progress.hidden = false;
      progress.textContent = "저장했습니다 · " + bits.join(" · ");

      const skipped = info.skipped || [];
      if (skipped.length){
        // 조용히 빼지 않는다. 무엇이 빠졌는지 말해야 "받은 줄 알았던" 사고가 없다.
        progress.textContent += " · 건너뛴 객체 " + countText(skipped.length) + "개(파일 안에 목록이 있습니다)";
      }
      if ((info.cyclicViews || []).length){
        progress.textContent += " · 서로 참조하는 뷰가 있어 순서를 정하지 못했습니다";
      }
      notify("SQL 덤프를 저장했습니다 · " + (savedPath || ""), 4200);
      if (typeof context.onSaved === "function") context.onSaved(savedPath, info);
    };

    // 창을 닫아도 덤프가 돌고 있으면 폴링을 이어 간다 — 끝나면 알려 주겠다고 했기 때문이다.
    const poll = () => {
      if (closed && !running) return;
      setTimeout(async () => {
        if (!job) return;
        try {
          const response = await fetch("/db-dump-poll?job=" + encodeURIComponent(job), { cache:"no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const data = await response.json();
          if (!data.done){
            showProgress(data.progress);
            poll();
            return;
          }
          finish(data, lastPath);
        } catch(error){
          setRunning(false);
          job = "";
          progress.hidden = false;
          progress.textContent = "진행 상황을 확인하지 못했습니다.";
        }
      }, POLL_MS);
    };

    const start = async () => {
      if (running || !chosen.size) return;
      const picked = targets.filter(item => chosen.has(keyOf(item)));
      let name = nameInput.value.trim() || defaultFileName(database);
      if (!/\.sql$/i.test(name)) name += ".sql";              // 런처도 붙이지만 사용자에게 먼저 보인다
      nameInput.value = name;
      const withData = modeOf() !== "structure";
      if (withData && picked.every(item => item.kind !== "table")){
        notify("데이터를 담으려면 테이블을 하나 이상 골라 주세요.", 3600);
        return;
      }
      if (await savedFileExists(name)){
        const ok = typeof confirmDialog === "function"
          ? await confirmDialog(name + " 이 이미 있습니다.\n덮어쓸까요? 지금 파일은 사라집니다.",
            "덮어쓰기", "취소")
          : true;
        if (!ok) return;
      }
      const values = requestValues({
        name, mode:modeOf(), database, objects:picked,
        dropIfExists:dropOption.box.checked,
        createIfNotExists:existsOption.box.checked,
        insertForm:formSelect.value,
        columnNames:columnOption.box.checked,
        rowLimit:limitInput.value,
        consistent:consistentOption.box.checked
      });

      setRunning(true);
      showProgress(null);
      try {
        const response = await fetch("/db-dump?id=" + encodeURIComponent(sessionId), {
          method:"POST", body:MNDbClient.encodeStrings(values)
        });
        if (!response.ok) throw new Error((await response.text()) || ("HTTP " + response.status));
        const started = await response.json();
        job = String(started.job || "");
        lastPath = String(started.path || "");
        if (!job) throw new Error("no-job");
        poll();
      } catch(error){
        setRunning(false);
        progress.hidden = false;
        progress.textContent = "덤프를 시작하지 못했습니다. " + String((error && error.message) || "");
      }
    };

    startButton.addEventListener("click", start);
    cancelButton.addEventListener("click", async () => {
      if (!job) return;
      cancelButton.disabled = true;
      progress.textContent = "중단하는 중…";
      // 덤프도 쿼리와 같은 작업 목록에 있어 취소 경로를 함께 쓴다.
      try { await fetch("/db-query-cancel?job=" + encodeURIComponent(job), { method:"POST" }); }
      catch(_){ /* 실패는 덤프 자신의 결과로 드러난다 */ }
      cancelButton.disabled = false;
    });

    search.addEventListener("input", renderList);
    selectAll.addEventListener("click", () => {
      const needle = search.value.trim().toLowerCase();
      targets.filter(item => !needle || item.name.toLowerCase().includes(needle))
        .forEach(item => chosen.add(keyOf(item)));
      renderList();
      refreshSummary();
    });
    selectNone.addEventListener("click", () => {
      chosen.clear();
      renderList();
      refreshSummary();
    });
    modeInputs.forEach(item => item.addEventListener("change", () => { refreshMode(); refreshSummary(); }));

    renderList();
    refreshMode();
    refreshSummary();
    nameInput.focus();
    nameInput.setSelectionRange(0, Math.max(0, nameInput.value.length - 4));

    return { close, modal };
  };

  return { open, defaultFileName, targetsOf, keyOf, requestValues, GROUPS, MODES };
})();

if (typeof module !== "undefined" && module.exports) module.exports = MNDbDump;
