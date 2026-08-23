"use strict";

/* 환율 창 (Ctrl+K → 환율)
 *
 * MNExchangeRate(순수 모듈)에 화면만 붙인다. 환율 해석 규칙은 여기에 한 줄도 두지 않는다 —
 * 그래야 규칙은 node --test 로, 화면은 눈으로 각각 확인할 수 있다(형식 변환 창과 같은 나눔).
 *
 * 환율은 반드시 런처를 거친다. 수출입은행 API 는 CORS 를 열어 주지 않아 브라우저에서 직접 부를 수
 * 없고, 인증키도 HTML·작업공간에 남기지 않아야 하기 때문이다. 그래서 런처로 열지 않았으면
 * (file:// · 일반 브라우저) 창은 뜨되 조회는 막고 이유를 밝힌다.
 *
 * 내보내는 세 길은 이미 검증된 경로를 그대로 쓴다.
 *   복사·CSV     : copyDocumentMenuText · saveTextDoc(text, null, name)
 *   표 편집기로  : MNTableExport.openInEditor
 *   칠판 그래프  : newWhiteboard → ensureRendered → doc.insertBoardChart  (지도의 지역 통계와 같은 길)
 */
(function(){
  if (typeof window === "undefined" || !window.document) return;
  if (typeof MNExchangeRate === "undefined") return;

  const R = MNExchangeRate;
  const KOREAEXIM_WALK_BACK = 7;     // 주말·연휴를 건너뛰며 거슬러 올라갈 최대 일수
  const SERIES_DAYS = [7, 14, 30];
  const SERIES_MAX_DAYS = 30;        // 수출입은행은 하루에 한 번씩 물어야 해서 상한을 둔다

  let rateOpen = false;

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
  const rateToast = (message, ms) => { if (typeof toast === "function") toast(message, ms || 2600); };

  /* 런처가 환율을 대신 받아 주는지 확인한다. 타일 프록시(/can-proxy-tiles)와는 다른 능력이라
     프로브를 따로 둔다 — 옛 런처에는 이 엔드포인트가 없어 404 가 오고, 그러면 조회를 막는다. */
  let _rateProxyProbe = null;
  async function ratesAvailable(){
    if (location.protocol !== "http:" && location.protocol !== "https:") return false;
    if (_rateProxyProbe === null){
      _rateProxyProbe = (async () => {
        try {
          const response = await fetch("/can-proxy-rates", { cache:"no-store" });
          return response.ok && (await response.text()).trim().toLowerCase() === "yes";
        } catch(_){ return false; }
      })();
    }
    return await _rateProxyProbe;
  }

  /* 인증키 문자열은 런처 밖으로 나오지 않는다 — 설정 화면이 공개한 보유 여부만 읽는다
     (지도 검색 키와 같은 규칙). 시작 직후에는 아직 물어보는 중일 수 있어 그 조회를 기다린다. */
  async function hasExchangeRateKey(){
    try { if (window.__classDockExchangeRateKeyReady) await window.__classDockExchangeRateKeyReady; } catch(_){}
    const status = window.__classDockExchangeRateKeyStatus;
    return !!(status && typeof status === "object" && status.hasKey === true);
  }

  async function fetchRate(params){
    const url = "/exchange-rate?" + Object.keys(params)
      .map(key => key + "=" + encodeURIComponent(params[key])).join("&");
    let response;
    try { response = await fetch(url, { cache:"no-store" }); }
    catch(_){ return { ok:false, code:"rate-failed" }; }
    if (!response.ok) return { ok:false, code:(await response.text()).trim() || "rate-failed" };
    // 런처가 받아오지 못해 저장해 둔 값을 대신 내줄 때만 붙는 표시다.
    const cached = response.headers.get("X-ClassDock-Rate-Cached") === "1";
    try { return { ok:true, json:await response.json(), cached }; }
    catch(_){ return { ok:false, code:"rate-failed" }; }
  }

  /* 고시가 없는 날(주말·공휴일·오전 고시 전)은 빈 배열이 온다. 그날부터 거슬러 올라가며
     처음 만나는 고시일을 쓴다. 한 번 빈 날로 확인된 날짜는 이 창이 열려 있는 동안 다시 묻지
     않는다 — 수출입은행 API 는 하루 1,000회 한도가 있어 같은 헛걸음을 반복하면 안 된다. */
  const emptyDays = new Set();

  async function loadKoreaexim(day){
    let lastCode = "rate-no-data";
    for (let back = 0; back < KOREAEXIM_WALK_BACK; back++){
      const target = back === 0 ? day : R.shiftDate(day, -back);
      if (!target || emptyDays.has(target)) continue;
      const got = await fetchRate({ source:"koreaexim", date:R.compactDate(target) });
      if (!got.ok){
        if (got.code === "rate-no-data"){ emptyDays.add(target); lastCode = got.code; continue; }
        return { ok:false, code:got.code };
      }
      const parsed = R.normalizeKoreaexim(got.json, target);
      if (!parsed.ok){
        // 키·한도 문제는 며칠을 거슬러 올라가도 그대로다 — 더 묻지 않고 바로 알린다.
        if (parsed.code !== "rate-no-data") return parsed;
        emptyDays.add(target); lastCode = parsed.code; continue;
      }
      parsed.cached = got.cached;
      parsed.requested = day;
      return parsed;
    }
    return { ok:false, code:lastCode };
  }

  async function loadEcb(day){
    // Frankfurter 는 휴일이면 직전 영업일 값을 알아서 돌려주고 응답에 그 날짜를 담는다.
    const got = await fetchRate({ source:"ecb", date:day });
    if (!got.ok) return { ok:false, code:got.code };
    const parsed = R.normalizeEcb(got.json, day);
    if (parsed.ok){ parsed.cached = got.cached; parsed.requested = day; }
    return parsed;
  }

  const loadRates = (source, day) => (source === "koreaexim" ? loadKoreaexim(day) : loadEcb(day));

  /* ── 추이 ──
     ECB 는 기간 조회가 한 번에 되지만, 수출입은행은 하루씩만 물을 수 있어 날짜마다 한 번씩
     받아 온다. 그래서 상한(30일)을 두고 진행 상황을 알린다. */
  async function loadEcbSeries(code, start, end){
    const got = await fetchRate({ source:"ecb-series", start, end, symbols:"KRW," + code });
    if (!got.ok) return { ok:false, code:got.code };
    return R.normalizeEcbSeries(got.json, code);
  }
  async function loadKoreaeximSeries(code, start, end, onProgress){
    const points = [];
    const days = [];
    for (let day = start; day && day <= end; day = R.shiftDate(day, 1)) days.push(day);
    for (let index = 0; index < days.length; index++){
      const day = days[index];
      if (onProgress) onProgress(index + 1, days.length);
      if (emptyDays.has(day)) continue;
      const got = await fetchRate({ source:"koreaexim", date:R.compactDate(day) });
      if (!got.ok){
        if (got.code === "rate-no-data"){ emptyDays.add(day); continue; }
        return { ok:false, code:got.code };
      }
      const parsed = R.normalizeKoreaexim(got.json, day);
      if (!parsed.ok){
        if (parsed.code !== "rate-no-data") return parsed;   // 키·한도 문제면 남은 날은 물어도 소용없다
        emptyDays.add(day); continue;
      }
      const rate = R.findRate(parsed, code);
      if (rate && rate.perOne !== null) points.push({ date:day, value:rate.perOne });
    }
    if (!points.length) return { ok:false, code:"rate-no-data" };
    return { ok:true, source:"koreaexim", code, points };
  }

  /* 새 칠판을 하나 열고 그릴 준비가 될 때까지 기다린다. 빈 스냅샷을 "지금" 시각으로 넘겨,
     같은 이름으로 쓰던 옛 판서가 되살아나지 않게 한다(지도의 createMapBoard 와 같은 규약). */
  async function createRateBoard(name){
    if (typeof newWhiteboard !== "function") return null;
    const boardDoc = newWhiteboard({
      name,
      state: {
        version: 1,
        savedAt: Date.now(),
        bg: typeof defaultBoardBg === "function" ? defaultBoardBg() : "#ffffff",
        items: []
      }
    });
    if (typeof setActiveDoc === "function") setActiveDoc(boardDoc.id);
    // 렌더가 끝나야 insertBoardChart 가 붙는다(훅은 renderWhiteboard 안에서 매단다).
    if (typeof ensureRendered === "function") await ensureRendered(boardDoc);
    return boardDoc;
  }

  function rowsToCsv(rows){
    // 인용 규칙은 형식 변환 모듈이 이미 검증했다 — 여기서 다시 만들지 않는다.
    if (typeof MNDataConvert !== "undefined"){
      return MNDataConvert.serialize({ table:MNDataConvert.fromRows(rows, true) }, "csv", { bom:true }).text;
    }
    const quote = (cell) => '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"';
    return "﻿" + rows.map(row => row.map(quote).join(",")).join("\r\n");
  }

  /* options.board 가 있으면 "이 보드에 넣기" 모드다 — 칠판의 💱 가 자기 보드에 넣는 두 함수를
     들려 보낸다. 새 칠판을 만드는 쪽(팔레트)과 입구를 나누는 까닭: 보드 위에 서 있는 사람이
     💱 를 눌렀는데 다른 칠판이 열리면 엉뚱하다(지도의 openMapPicker 와 같은 짝 구조). */
  function openExchangeRate(options){
    if (rateOpen) return;
    rateOpen = true;
    const board = (options && options.board && typeof options.board.insertChart === "function")
      ? options.board : null;

    const modal = el("div", "modal exchange-rate-modal");
    const card = el("div", "modal-card exchange-rate-card");
    card.append(
      el("h3", null, "환율"),
      el("p", "exchange-rate-sub", "고시환율을 받아 표로 보고, 금액을 바꿔 보고, 며칠간의 추이를 칠판 그래프로 보냅니다. 받아 온 값은 이 컴퓨터에 저장해 두어 인터넷이 끊겨도 마지막 값을 계속 볼 수 있어요.")
    );

    // ── 위: 출처·기준일 ──
    const head = el("div", "exchange-rate-head");
    const sourceSelect = el("select", "exchange-rate-select");
    option(sourceSelect, "koreaexim", R.SOURCES.koreaexim.label);
    option(sourceSelect, "ecb", R.SOURCES.ecb.label);
    const dateInput = el("input", "exchange-rate-date");
    dateInput.type = "date";
    dateInput.value = R.dateKey();
    dateInput.max = R.dateKey();          // 앞날 환율은 없다 — 달력에서 아예 고르지 못하게 막는다
    const reloadBtn = el("button", "btn", "다시 받기");
    reloadBtn.type = "button";
    head.append(el("span", "exchange-rate-cap", "출처"), sourceSelect,
      el("span", "exchange-rate-cap", "기준일"), dateInput, reloadBtn);

    const status = el("div", "exchange-rate-status");
    status.setAttribute("aria-live", "polite");
    const sourceNote = el("p", "exchange-rate-note");

    /* ── 계산기 ──
       고른 통화(select)를 왼쪽·오른쪽 어느 칸에 두느냐로 방향을 나타낸다. 화살표만 뒤집으면
       "100 USD 를 원으로" 와 "100 원을 USD 로" 가 똑같이 보여 어느 쪽인지 읽히지 않는다. */
    const calc = el("div", "exchange-rate-calc");
    const amountInput = el("input", "exchange-rate-amount");
    amountInput.type = "text";
    amountInput.inputMode = "decimal";
    amountInput.value = "1";
    const calcSelect = el("select", "exchange-rate-select");
    calcSelect.setAttribute("aria-label", "통화");
    const fromSlot = el("span", "exchange-rate-slot");
    const swapBtn = el("button", "exchange-rate-swap", "⇄");
    swapBtn.type = "button";
    swapBtn.title = "방향 바꾸기";
    const calcOut = el("output", "exchange-rate-out");
    const toSlot = el("span", "exchange-rate-slot");
    calc.append(amountInput, fromSlot, swapBtn, calcOut, toSlot);

    // ── 표 ──
    const filterInput = el("input", "exchange-rate-filter");
    filterInput.type = "search";
    filterInput.placeholder = "통화 이름이나 코드로 거르기 (달러, USD …)";
    filterInput.setAttribute("aria-label", "통화 거르기");
    const tableWrap = el("div", "exchange-rate-table-wrap");

    // ── 추이 ──
    const series = el("div", "exchange-rate-series");
    const seriesSelect = el("select", "exchange-rate-select");
    seriesSelect.setAttribute("aria-label", "추이를 볼 통화");
    const spanSelect = el("select", "exchange-rate-select");
    for (const days of SERIES_DAYS) option(spanSelect, String(days), "최근 " + days + "일");
    spanSelect.value = "30";
    const seriesBtn = el("button", "btn", board ? "그래프 넣기" : "칠판 그래프로");
    seriesBtn.type = "button";
    const seriesStatus = el("span", "exchange-rate-series-status");
    seriesStatus.setAttribute("aria-live", "polite");
    series.append(el("span", "exchange-rate-cap", "추이"), seriesSelect, spanSelect, seriesBtn, seriesStatus);

    // ── 버튼 ──
    const actions = el("div", "modal-actions");
    const close = el("button", "btn", "닫기");
    const copyBtn = el("button", "btn", "복사");
    const csvBtn = el("button", "btn", "CSV로 저장");
    const sheetBtn = el("button", "btn", "표 편집기로");
    // 보드에 넣기 모드에서만 나오는 버튼 — 지금 보이는 표를 그대로 칠판 표로 떨어뜨린다.
    const boardTableBtn = board ? el("button", "btn primary", "표 넣기") : null;
    for (const button of [close, copyBtn, csvBtn, sheetBtn, boardTableBtn]) if (button) button.type = "button";
    actions.append(close, el("span", "spacer"), copyBtn, csvBtn, sheetBtn);
    if (boardTableBtn) actions.appendChild(boardTableBtn);

    card.append(head, sourceNote, status, calc, filterInput, tableWrap, series, actions);
    modal.appendChild(card);

    // ── 상태 ──
    let result = null;          // 마지막으로 성공한 조회 결과(정규화된 모양)
    let visible = [];           // 거르기를 지나 지금 표에 떠 있는 줄
    /* 내보내는 길(복사·CSV·표 편집기·칠판)은 모두 **보이는 대로** 나간다. 거르기 칸이 표 바로
       위에 있어 무엇이 빠졌는지 눈에 보이고, 29종을 통째로 칠판에 올리면 글자가 뭉개져 못 읽는다.
       "달러"만 남겨 놓고 넣으면 달러만 들어가는 편이 규칙 하나로 설명되고 놀랄 일이 없다. */
    const shownResult = () => Object.assign({}, result, { rates:(visible.length ? visible : (result ? result.rates : [])) });
    let toKrw = true;           // 계산 방향 — true 면 외화 → 원
    let available = false;      // 런처가 환율을 받아 줄 수 있는가
    let loadToken = 0;          // 늦게 도착한 응답이 새 결과를 덮어쓰지 않게 하는 표

    const setStatus = (text, kind) => {
      status.textContent = text;
      status.classList.toggle("bad", kind === "bad");
      status.classList.toggle("ok", kind === "ok");
    };
    const setBusy = (busy) => {
      reloadBtn.disabled = busy || !available;
      sourceSelect.disabled = busy || !available;
      dateInput.disabled = busy || !available;
      seriesBtn.disabled = busy || !available || !result;
      for (const button of [copyBtn, csvBtn, sheetBtn, boardTableBtn]) if (button) button.disabled = busy || !result;
    };

    function renderNote(){
      const source = R.SOURCES[sourceSelect.value];
      sourceNote.textContent = source ? source.note : "";
    }

    function renderTable(){
      tableWrap.textContent = "";
      if (!result){ tableWrap.appendChild(el("div", "exchange-rate-empty", "환율을 아직 받지 못했어요.")); return; }
      const source = R.SOURCES[result.source];
      const transfer = !!source.hasTransfer;
      const needle = filterInput.value.trim().toLowerCase();
      const rows = result.rates.filter(rate => !needle
        || rate.code.toLowerCase().includes(needle) || rate.name.toLowerCase().includes(needle));
      visible = rows;
      if (!rows.length){ tableWrap.appendChild(el("div", "exchange-rate-empty", "그 이름의 통화가 없어요.")); return; }

      const table = el("table", "exchange-rate-table");
      const thead = el("thead");
      const headRow = el("tr");
      // ECB 값을 "매매기준율" 이라 부르면 은행 고시환율로 오해한다 — 출처가 부르는 이름을 그대로 쓴다.
      const heads = ["통화", "단위", source.baseLabel];
      if (transfer) heads.push("송금 보낼 때", "송금 받을 때");
      headRow.appendChild(el("th", null, heads[0]));
      for (const text of heads.slice(1)) headRow.appendChild(el("th", "exchange-rate-num", text));
      thead.appendChild(headRow);
      const tbody = el("tbody");
      for (const rate of rows){
        const tr = el("tr");
        tr.tabIndex = 0;
        // 줄을 누르면 그 통화가 계산기·추이에 함께 걸린다 — 표에서 눈으로 찾은 통화를 바로 계산한다.
        const pick = () => { calcSelect.value = rate.code; seriesSelect.value = rate.code; renderCalc(); };
        tr.addEventListener("click", pick);
        tr.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " "){ event.preventDefault(); pick(); }
        });
        const nameCell = el("td", "exchange-rate-name");
        nameCell.append(el("span", null, rate.name), el("code", null, rate.code));
        tr.append(nameCell,
          el("td", "exchange-rate-num", String(rate.unit)),
          el("td", "exchange-rate-num strong", R.formatMoney(rate.base, 2)));
        if (transfer){
          tr.append(el("td", "exchange-rate-num", R.formatMoney(rate.send, 2)),
            el("td", "exchange-rate-num", R.formatMoney(rate.recv, 2)));
        }
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      tableWrap.appendChild(table);
    }

    function renderCurrencyChoices(){
      const previous = calcSelect.value;
      const previousSeries = seriesSelect.value;
      calcSelect.textContent = "";
      seriesSelect.textContent = "";
      for (const rate of ((result && result.rates) || [])){
        option(calcSelect, rate.code, rate.code + " · " + rate.name);
        option(seriesSelect, rate.code, rate.code + " · " + rate.name);
      }
      const fallback = result && result.rates.length ? result.rates[0].code : "";
      calcSelect.value = R.findRate(result, previous) ? previous : fallback;
      seriesSelect.value = R.findRate(result, previousSeries) ? previousSeries : fallback;
    }

    function renderCalc(){
      const rate = R.findRate(result, calcSelect.value);
      if (!rate){ calcOut.textContent = ""; amountInput.disabled = true; calcSelect.disabled = true; swapBtn.disabled = true; return; }
      amountInput.disabled = false; calcSelect.disabled = false; swapBtn.disabled = false;
      const value = R.convert(amountInput.value, rate, toKrw);
      calcOut.textContent = value === null ? "?"
        : (toKrw ? R.formatMoney(value, 2) : R.formatMoney(value));
      // 고시 단위가 100인 통화(엔·루피아)는 1단위 값도 함께 밝혀 둔다.
      calcOut.title = rate.unit === 1
        ? "1 " + rate.code + " = " + R.formatMoney(rate.perOne, 2) + " 원"
        : rate.unit + " " + rate.code + " = " + R.formatMoney(rate.base, 2) + " 원 (1 " + rate.code
          + " = " + R.formatMoney(rate.perOne) + " 원)";
    }
    // 고른 통화 칸을 왼쪽·오른쪽으로 옮겨 방향을 눈에 보이게 한다.
    function renderCalcDirection(){
      fromSlot.textContent = ""; toSlot.textContent = "";
      (toKrw ? fromSlot : toSlot).appendChild(calcSelect);
      (toKrw ? toSlot : fromSlot).appendChild(el("span", "exchange-rate-unit", "원"));
      amountInput.setAttribute("aria-label", toKrw ? "바꿀 외화 금액" : "바꿀 원화 금액");
      swapBtn.setAttribute("aria-label", toKrw ? "원화에서 외화로 바꾸기" : "외화에서 원화로 바꾸기");
      renderCalc();
    }

    async function load(){
      if (!available) return;
      const token = ++loadToken;
      setBusy(true);
      setStatus("환율을 받아오는 중…", "");
      const day = R.isDateKey(dateInput.value) ? dateInput.value : R.dateKey();
      const source = sourceSelect.value;
      const loaded = await loadRates(source, day);
      if (token !== loadToken) return;                  // 그 사이 다른 조회가 시작됐다
      if (!loaded.ok){
        result = null;
        renderCurrencyChoices(); renderTable(); renderCalc();
        setBusy(false);
        setStatus(R.errorText(loaded.code), "bad");
        return;
      }
      result = loaded;
      renderCurrencyChoices(); renderTable(); renderCalc();
      setBusy(false);
      const loadedSource = R.SOURCES[result.source];
      let text = result.date + " 기준 · " + loadedSource.label + " · 통화 " + result.rates.length + "종";
      // 고른 날과 실제 기준일이 다르면 왜 다른지 밝혀야 한다(주말·공휴일·오전 고시 전).
      if (result.date !== day) text += " — 고른 " + day + " 은(는) " + loadedSource.missingNote;
      if (result.cached) text += " · 인터넷에 닿지 못해 저장해 둔 값입니다";
      setStatus(text, result.cached ? "" : "ok");
    }

    async function sendSeriesToBoard(){
      if (!result) return;
      const code = seriesSelect.value;
      const rate = R.findRate(result, code);
      if (!rate) return;
      const days = Math.min(SERIES_MAX_DAYS, Number(spanSelect.value) || 30);
      const end = result.date;
      const start = R.shiftDate(end, -(days - 1));
      seriesBtn.disabled = true;
      seriesStatus.textContent = "추이를 받아오는 중…";
      let loaded;
      try {
        loaded = result.source === "ecb"
          ? await loadEcbSeries(code, start, end)
          : await loadKoreaeximSeries(code, start, end, (done, total) => {
              // 수출입은행은 하루에 한 번씩 물어야 해서 진행 상황을 보여 준다.
              seriesStatus.textContent = "추이를 받아오는 중… (" + done + "/" + total + "일)";
            });
      } catch(error){
        console.warn("exchange rate series failed:", error);
        loaded = { ok:false, code:"rate-failed" };
      }
      if (!loaded.ok){
        seriesStatus.textContent = R.errorText(loaded.code);
        seriesBtn.disabled = !result;
        return;
      }
      const spec = {
        type:"line",
        title:"1 " + code + " → 원 (" + R.SOURCES[loaded.source].label + " · " + start + "~" + end + ")",
        series:[code],
        rows:loaded.points.map(point => ({ label:point.date.slice(5), values:[point.value] }))
      };
      let placed = false;
      if (board){
        // 이미 열려 있는 보드다 — 새 칠판을 만들지 않고 그 자리에 넣는다.
        placed = board.insertChart(spec) === true;
      } else {
        seriesStatus.textContent = "칠판을 여는 중…";
        const boardDoc = await createRateBoard(code + " 환율 추이 " + start + "~" + end);
        placed = !!(boardDoc && typeof boardDoc.insertBoardChart === "function" && boardDoc.insertBoardChart(spec));
      }
      seriesBtn.disabled = !result;
      if (placed){
        seriesStatus.textContent = "";
        shut();
        rateToast(board ? "환율 추이 그래프를 칠판에 넣었어요."
          : "환율 추이를 칠판 그래프로 옮겼어요 — 그 위에 바로 판서할 수 있어요.", 3200);
      } else {
        seriesStatus.textContent = "칠판에 그래프를 넣지 못했어요.";
      }
    }

    // ── 배선 ──
    const shut = () => {
      window.removeEventListener("keydown", onKey, true);
      loadToken++;                                   // 닫은 뒤 도착한 응답이 화면을 건드리지 않게
      modal.remove();
      rateOpen = false;
    };
    const onKey = (event) => {
      if (event.key === "Escape"){ event.stopPropagation(); shut(); }
    };
    window.addEventListener("keydown", onKey, true);
    modal.addEventListener("click", (event) => { if (event.target === modal) shut(); });
    close.addEventListener("click", shut);

    sourceSelect.addEventListener("change", () => { renderNote(); load(); });
    dateInput.addEventListener("change", load);
    reloadBtn.addEventListener("click", () => {
      // '다시 받기' 는 이 창이 기억해 둔 "그날은 비어 있더라" 도 함께 잊어야 한다.
      // 오전 고시 전에 열어 둔 창이 11시가 지나도 계속 어제 값만 보여 주면 안 된다.
      emptyDays.clear();
      load();
    });
    filterInput.addEventListener("input", renderTable);
    amountInput.addEventListener("input", renderCalc);
    calcSelect.addEventListener("change", renderCalc);
    swapBtn.addEventListener("click", () => { toKrw = !toKrw; renderCalcDirection(); });
    seriesBtn.addEventListener("click", sendSeriesToBoard);

    copyBtn.addEventListener("click", async () => {
      if (!result) return;
      const text = R.toRows(shownResult()).map(row => row.join("\t")).join("\n");
      const ok = (typeof copyDocumentMenuText === "function")
        ? await copyDocumentMenuText(text, "환율 표를 복사했어요.")
        : false;
      rateToast(ok ? "환율 표를 복사했어요." : "복사하지 못했어요.");
    });

    csvBtn.addEventListener("click", async () => {
      if (!result) return;
      const name = "환율-" + result.source + "-" + result.date + ".csv";
      // doc 을 넘기지 않는다(=null) — 열려 있는 문서의 저장 상태를 건드리지 않는다.
      const ok = (typeof saveTextDoc === "function") && (await saveTextDoc(rowsToCsv(R.toRows(shownResult())), null, name)) === true;
      rateToast(ok ? name + " 으로 내보냈어요." : "저장하지 못했어요.");
    });

    if (boardTableBtn) boardTableBtn.addEventListener("click", () => {
      if (!result || typeof board.insertTable !== "function") return;
      const shown = shownResult();
      if (!shown.rates.length){ rateToast("넣을 통화가 없어요."); return; }
      const title = R.SOURCES[result.source].label + " · " + result.date;
      const placed = board.insertTable(R.toRows(shown), { title }) === true;
      if (placed){
        shut();
        rateToast("환율 표 " + shown.rates.length + "종을 칠판에 넣었어요.", 3000);
      } else rateToast("칠판에 표를 넣지 못했어요.");
    });

    sheetBtn.addEventListener("click", async () => {
      if (!result || typeof MNTableExport === "undefined") return;
      const ok = await MNTableExport.openInEditor(
        { rows:R.toRows(shownResult()), header:true },
        { baseName:"환율-" + result.date }
      );
      if (ok) shut();
    });

    // ── 열기 ──
    renderNote();
    renderCalcDirection();
    renderTable();
    setBusy(true);
    document.body.appendChild(modal);
    if (window.MNI18N && typeof window.MNI18N.translateTree === "function") window.MNI18N.translateTree(modal);
    requestAnimationFrame(() => { try { amountInput.focus(); amountInput.select(); } catch(_){} });

    (async () => {
      available = await ratesAvailable();
      if (!available){
        setBusy(false);
        setStatus(R.errorText("rate-unavailable"), "bad");
        return;
      }
      // 인증키가 없으면 키 없이 되는 ECB 로 연다 — 창을 열자마자 "키를 넣으세요" 만 보이면
      // 쓸 수 있는 길이 있다는 것을 모른 채 닫게 된다.
      if (!(await hasExchangeRateKey())) sourceSelect.value = "ecb";
      renderNote();
      await load();
    })();
  }

  window.openExchangeRate = openExchangeRate;
  // 칠판이 💱 버튼을 내놓을지 정할 때 쓴다 — 능력이 없으면 버튼 자체를 감춘다(whiteboard.js).
  window.exchangeRatesAvailable = ratesAvailable;
})();
