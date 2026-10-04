"use strict";
/* 주변 교통 자동 표시 — 체크해 두면 지도를 옮길 때마다 화면 둘레의 지하철역·버스 정류장을 저절로 찍는다.
   지도 문서(.map)에는 아무것도 남기지 않는다. 켜 둔 상태만 브라우저에 기억한다(실시간 층과 같은 까닭).

   지하철: subway-stations.js(SUBWAY_LINES)의 수도권 역 좌표를 그대로 쓴다 — API 호출이 없다.
     같은 이름 역은 노선을 모아 점 하나로 합친다(환승역). 단, 이름이 같아도 600m 넘게 떨어지면 다른 역이다
     (5호선 양평 ↔ 경의중앙선 양평). 누르면 지도 화면의 역 도착 창(subwayShowArrivals)을 연다.
   버스: 화면을 덮는 격자 칸마다 칸 가운데를 묻는다(MNJejuBusApi.nearbyAt — 서울이면 서울 API 도 함께).
     칸은 조회 반경 500m 원 안에 꼭 들어가는 크기(약 670m × 690m)라 칸끼리 빈틈이 없다.
     하루 조회 한도가 있어 ① 확대 16 이상에서만 ② 옮기기를 멈추고 잠시 뒤에 ③ 가운데에서 가까운 칸부터
     두 개씩, 한 화면에 16칸까지 ④ 한 번 물은 칸은 10분 동안 다시 묻지 않는다.
     칸 가운데 좌표로 물으므로 런처 하루 캐시도 그대로 맞는다.
     누르면 떠 있는 '정류장 도착' 창이 열리고, 노선을 누르면 버스 창에서 그 노선을 검색한다. */
const MNNearbyTransit = (() => {
  const SUBWAY_MIN_ZOOM = 13, SUBWAY_LABEL_ZOOM = 16, BUS_MIN_ZOOM = 16;
  const SAME_STATION_METRES = 600;
  // 약 670m × 690m(위도 37°) — 칸 귀퉁이까지 가운데에서 480m 남짓이라 반경 500m 조회 원 안에 든다.
  const CELL_LAT = 0.006, CELL_LNG = 0.0078;
  const CELL_MAX_AGE = 10 * 60 * 1000, BUS_DELAY = 700, BUS_MAX_STOPS = 800;
  const BUS_MAX_CELLS = 16, BUS_PARALLEL = 2;
  // 마우스 올림 미리보기: 이만큼 머물러야 도착 정보를 묻고, 받은 것은 이만큼 다시 쓴다. 미리보기는 노선 몇 줄까지.
  // 점에서 벗어나도 카드를 이만큼 남겨 카드로 옮겨 가 누를 수 있게 한다.
  const PREVIEW_DELAY = 400, PREVIEW_MAX_AGE = 30 * 1000, PREVIEW_ROWS = 3, PREVIEW_GRACE = 300;
  const STORAGE_KEY = "mapNearbyTransit";

  function metres(a, b){
    const rad = Math.PI / 180, x = (b[1] - a[1]) * rad * Math.cos((a[0] + b[0]) / 2 * rad), y = (b[0] - a[0]) * rad;
    return Math.sqrt(x * x + y * y) * 6371000;
  }
  // 노선별 역 표 → 합친 역 목록 [{ name, at, lines:[노선…] }]. 노선 차례는 표 차례(1호선부터)를 따른다.
  function subwayStations(lines){
    const list = [];
    for (const [line, spec] of Object.entries(lines || {})){
      for (const [name, at] of Object.entries(spec && spec.s || {})){
        if (!Array.isArray(at) || at.length < 2 || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
        const same = list.find(entry => entry.name === name && metres(entry.at, at) < SAME_STATION_METRES);
        if (same){ if (!same.lines.includes(line)) same.lines.push(line); }
        else list.push({ name, at:[at[0], at[1]], lines:[line] });
      }
    }
    return list;
  }
  // 버스 조회 칸. 칸 가운데를 소수 넷째 자리로 맞춰 런처 캐시 열쇠(같은 자리수)와 어긋나지 않게 한다.
  function busCell(lat, lng){
    const i = Math.floor(lat / CELL_LAT), j = Math.floor(lng / CELL_LNG);
    return cellAt(i, j);
  }
  function cellAt(i, j){
    return { key:i + ":" + j, at:[Number(((i + 0.5) * CELL_LAT).toFixed(4)), Number(((j + 0.5) * CELL_LNG).toFixed(4))] };
  }
  // 화면(남·서·북·동)을 덮는 칸들 — 가운데에서 가까운 차례로, 너무 넓으면 가까운 max 칸만.
  function busCells(south, west, north, east, center, max = BUS_MAX_CELLS){
    const list = [];
    for (let i = Math.floor(south / CELL_LAT); i <= Math.floor(north / CELL_LAT); i++)
      for (let j = Math.floor(west / CELL_LNG); j <= Math.floor(east / CELL_LNG); j++) list.push(cellAt(i, j));
    return list.map(cell => ({ cell, d:metres(center, cell.at) })).sort((a, b) => a.d - b.d).slice(0, max).map(item => item.cell);
  }
  // "용문마을회관[동]" → 이름과 방향 칩. 대괄호가 끝에 짧게 붙은 것만 뗀다.
  function splitSide(name){
    const text = String(name || ""), match = /^(.*\S)\s*\[([^\]]{1,8})\]$/.exec(text);
    return match ? { name:match[1], side:match[2] } : { name:text, side:"" };
  }
  // 노선 동그라미에 넣을 짧은 이름 — "1호선" → "1", "경의중앙선" → "경의".
  const SHORT_LINES = { "신분당선":"신분당", "우이신설선":"우이", "GTX-A":"GTX" };
  function shortLine(line){
    const text = String(line || "");
    return SHORT_LINES[text] || (/^\d+호선$/.test(text) ? text.replace("호선", "") : text.replace(/선$/, "").slice(0, 2));
  }
  function inkOn(hex){
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    if (!match) return "#fff";
    const [r, g, b] = match.slice(1).map(part => { const c = parseInt(part, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? "#111" : "#fff";
  }
  function loadChoice(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return { subway:!!(saved && saved.subway), bus:!!(saved && saved.bus) };
    } catch(_){ return { subway:false, bus:false }; }
  }
  function saveChoice(choice){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(choice)); } catch(_){}
  }

  function mount({ map, stage, toolRow, doc, t = value => value, movePanel = null, bus = null, subwayArrivals = null,
    subwayColors = {}, say = null }){
    const el = (tag, cls, label) => { const node = document.createElement(tag); if (cls) node.className = cls; if (label) node.textContent = t(label); return node; };
    const button = (label, cls = "") => { const node = el("button", cls, label); node.type = "button"; return node; };
    const announce = text => { if (typeof say === "function" && text) say(text); };
    const english = () => !!(window.MNI18N && window.MNI18N.lang === "en");

    /* ── 도구 칩과 고르는 판 ── */
    const wrap = el("div", "map-transit-picker map-toolvis-transit");
    const trigger = button("주변 교통", "map-subway-picker-btn map-transit-btn");
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(trigger, "busStop");
    trigger.title = t("켜 두면 지도를 옮길 때마다 둘레의 지하철역·버스 정류장을 보여 줘요");
    trigger.setAttribute("aria-haspopup", "true"); trigger.setAttribute("aria-expanded", "false");
    const menu = el("div", "map-transit-menu"); menu.hidden = true;
    menu.setAttribute("role", "group"); menu.setAttribute("aria-label", t("주변 교통"));
    const check = (label, note) => {
      const row = el("label", "map-transit-check"), box = document.createElement("input");
      box.type = "checkbox";
      const text = el("span", "map-transit-check-text");
      text.append(el("span", "", label), el("small", "", note));
      row.append(box, text);
      return { row, box };
    };
    const subwayCheck = check("지하철역", "수도권 · 누르면 도착 정보");
    const busCheck = check("버스 정류장", "확대 16 이상 · 화면 가장자리까지");
    const hint = el("p", "map-transit-hint"); hint.setAttribute("role", "status"); hint.setAttribute("aria-live", "polite");
    menu.append(subwayCheck.row, busCheck.row, hint);
    wrap.append(trigger, menu);
    const busChip = toolRow.querySelector ? toolRow.querySelector(".map-toolvis-jeju-bus") : null;
    if (busChip && busChip.parentNode === toolRow && busChip.nextSibling) toolRow.insertBefore(wrap, busChip.nextSibling);
    else toolRow.appendChild(wrap);

    const hasSubway = typeof SUBWAY_LINES !== "undefined";
    if (!hasSubway){ subwayCheck.box.disabled = true; subwayCheck.row.title = t("지하철역 자료가 없어요."); }
    busCheck.box.disabled = true; busCheck.row.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");

    /* ── 버스 정류장 도착 창 ── 지하철 도착 창과 같은 모양의 떠 있는 창이다(지도를 가리지 않아 다른 점을 바로 누른다). */
    const panel = el("section", "map-subway-arrival-panel map-transit-bus-panel"); panel.hidden = true;
    panel.setAttribute("aria-label", t("정류장 도착 정보"));
    const head = el("div", "map-subway-arrival-head"), title = el("strong", "");
    const refresh = button("새로고침", "map-btn"), close = button("닫기", "map-btn");
    head.append(title, refresh, close);
    const list = el("ul", "map-jeju-bus-arrival-list");
    const status = el("p", "map-subway-arrival-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    panel.append(head, list, status);
    stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    if (typeof movePanel === "function") movePanel(panel, head);

    // 사람이 찍은 표시(600)보다 아래, 오버레이(400)보다 위.
    const pane = map.createPane("mapTransitPane"); pane.style.zIndex = "450";
    const subwayLayer = L.layerGroup(), busLayer = L.layerGroup();
    const capability = new AbortController();
    let destroyed = false, choice = loadChoice(), busReady = false;

    /* ── 지하철 ── */
    let stations = null;                       // 처음 켤 때 한 번 합친다
    const stationMarkers = new Map();          // 역 → 표시
    let labelsShown = false, subwayHint = "";
    const lineColor = line => subwayColors[line] || "#64748b";
    function stationIcon(entry){
      const box = el("span", "map-transit-station");
      for (const line of entry.lines.slice(0, 4)){
        const bar = el("span", "map-transit-station-line"); bar.style.backgroundColor = lineColor(line);
        box.appendChild(bar);
      }
      const width = Math.min(entry.lines.length, 4) * 6 + 4;
      return L.divIcon({ html:box, className:"map-transit-station-marker", iconSize:[width, 14], iconAnchor:[width / 2, 7] });
    }
    // 크게 확대하면 이름만 늘 붙인다. 마우스를 올리면 그 이름은 잠시 접고 미리보기 카드를 띄운다.
    function bindStationLabel(marker, entry){
      marker.unbindTooltip();
      if (labelsShown) marker.bindTooltip(entry.name, { permanent:true, direction:"top", offset:[0, -8], className:"map-subway-label" });
    }
    function stationMarker(entry){
      let marker = stationMarkers.get(entry);
      if (marker) return marker;
      marker = L.marker(entry.at, { pane:"mapTransitPane", keyboard:true, title:entry.name, icon:stationIcon(entry), bubblingMouseEvents:false });
      const open = () => {
        if (typeof subwayArrivals === "function" && subwayArrivals(entry.lines[0], entry.name)) return;
        announce(t("지하철 도착 정보는 ClassDock EXE에서 인증키를 넣으면 볼 수 있어요."));
      };
      marker.on("click", open);
      const relabel = () => { if (labelsShown && marker.openTooltip) marker.openTooltip(); };
      const enter = () => { if (labelsShown && marker.closeTooltip) marker.closeTooltip(); showStationPreview(entry, { pick:open, onHide:relabel }); };
      const leave = () => leavePreview("subway:" + entry.name);
      marker.on("mouseover", enter); marker.on("mouseout", leave);
      // 키보드로 역에 머물러도 같은 카드를 보인다.
      marker.on("add", () => {
        const node = marker.getElement && marker.getElement();
        if (node && !node._transitFocus){ node._transitFocus = true; node.addEventListener("focus", enter); node.addEventListener("blur", leave); }
      });
      bindStationLabel(marker, entry);
      stationMarkers.set(entry, marker);
      return marker;
    }
    function drawSubway(){
      if (!choice.subway || !hasSubway || destroyed){ subwayHint = ""; return; }
      if (map.getZoom() < SUBWAY_MIN_ZOOM){
        subwayLayer.clearLayers(); map.removeLayer(subwayLayer);
        subwayHint = t("지하철역은 더 확대하면 보여요.");
        return;
      }
      if (!stations) stations = subwayStations(SUBWAY_LINES);
      subwayLayer.addTo(map);
      const wanted = map.getZoom() >= SUBWAY_LABEL_ZOOM;
      if (wanted !== labelsShown){ labelsShown = wanted; for (const [entry, marker] of stationMarkers) bindStationLabel(marker, entry); }
      const bounds = map.getBounds().pad(0.2);
      let count = 0;
      for (const entry of stations){
        const inside = bounds.contains(entry.at), marker = inside ? stationMarker(entry) : stationMarkers.get(entry);
        if (inside){ count++; if (!subwayLayer.hasLayer(marker)) subwayLayer.addLayer(marker); }
        else if (marker && subwayLayer.hasLayer(marker)) subwayLayer.removeLayer(marker);
      }
      subwayHint = count ? (english() ? count + " subway stations" : "지하철역 " + count + "곳") : t("이 둘레엔 수도권 지하철역이 없어요.");
    }
    function stopSubway(){ hidePreview(); subwayLayer.clearLayers(); map.removeLayer(subwayLayer); stationMarkers.clear(); labelsShown = false; subwayHint = ""; }

    /* ── 버스 ── */
    const busStops = new Map();                // 도시:정류장 → { stop, marker }
    const cells = new Map();                   // 칸 열쇠 → 물은 시각
    let busTimer = 0, busAbort = null, busGeneration = 0, busHint = "", busBlocked = "";
    const busFailText = (error, fallback, kind, city) => bus && typeof bus.failureText === "function"
      ? bus.failureText(error, fallback, kind, city) : t(fallback);
    const seen = () => !document.hidden && !!stage.offsetParent;
    function addStop(stop){
      const key = (stop.city || "") + ":" + stop.id;
      if (busStops.has(key)) return;
      const marker = L.circleMarker(stop.at, { pane:"mapTransitPane", radius:5, color:"#ffffff", weight:2, fillColor:"#e67e22", fillOpacity:0.95,
        bubblingMouseEvents:false, className:"map-transit-stop" });
      marker.on("click", () => showArrivals(stop));
      // 올린 점은 키워 어느 것인지 또렷하게 한다.
      const shrink = () => { if (marker.setRadius) marker.setRadius(5); };
      marker.on("mouseover", () => { if (marker.setRadius) marker.setRadius(7); showStopPreview(stop, { pick:() => showArrivals(stop), onHide:shrink }); });
      marker.on("mouseout", () => leavePreview("bus:" + key));
      busStops.set(key, { stop, marker });
      busLayer.addLayer(marker);
    }
    // 오래 돌아다니면 쌓이므로, 넘치면 지금 가운데에서 먼 것부터 치운다.
    function pruneStops(center){
      if (busStops.size <= BUS_MAX_STOPS) return;
      const far = [...busStops.entries()].sort((a, b) => metres(center, b[1].stop.at) - metres(center, a[1].stop.at));
      for (const [key, item] of far.slice(0, busStops.size - BUS_MAX_STOPS)){ busLayer.removeLayer(item.marker); busStops.delete(key); }
    }
    // 화면을 덮는 칸 중 아직 묻지 않은 것을 가까운 차례로 두 개씩 묻는다. 지도를 다시 옮기면 남은 줄은 버린다.
    async function fetchBus(){
      busTimer = 0;
      if (!choice.bus || !busReady || destroyed || busBlocked || map.getZoom() < BUS_MIN_ZOOM) return;
      if (!seen()) return;
      const center = map.getCenter(), bounds = map.getBounds();
      const sw = bounds.getSouthWest(), ne = bounds.getNorthEast(), here = [center.lat, center.lng];
      const now = Date.now();
      const queue = busCells(sw.lat, sw.lng, ne.lat, ne.lng, here)
        .filter(cell => { const asked = cells.get(cell.key); return !asked || now - asked >= CELL_MAX_AGE; });
      if (!queue.length){ updateHint(); return; }
      if (busAbort) busAbort.abort();
      const controller = new AbortController(), seq = ++busGeneration;
      busAbort = controller;
      const total = queue.length;
      let done = 0;
      const live = () => !destroyed && seq === busGeneration && !controller.signal.aborted && choice.bus && !busBlocked;
      const progress = () => { busHint = t("근처 정류장을 찾는 중…") + (total > 1 ? " " + done + "/" + total : ""); updateHint(); };
      progress();
      // 제주 정류장은 빈 도시코드로 바꿔 둔다(버스 창 도시 목록과 맞춤). 목록을 받기 전이면 TAGO 제주 코드 39.
      const known = bus && typeof bus.jejuCodes === "function" ? bus.jejuCodes() : [];
      const jejuCodes = known.length ? known : ["39"];
      let failure = null;
      const worker = async () => {
        while (queue.length && live()){
          const cell = queue.shift();
          cells.set(cell.key, Date.now());
          try {
            const found = await MNJejuBusApi.nearbyAt(cell.at, { signal:controller.signal, jejuCodes }, MNJejuBusApi.request);
            if (!live()){ cells.delete(cell.key); return; }     // 버린 결과라 다음에 다시 묻는다
            for (const stop of found) addStop(stop);
          } catch(error){
            cells.delete(cell.key);              // 실패하거나 끊긴 칸은 다음에 다시 묻는다
            if (!live()) return;
            const reason = error && error.message;
            // 키·한도 문제는 옮길 때마다 다시 물어도 소용없다. 다시 켜기 전까지 묻지 않는다.
            if (reason === "bus-key-required" || reason === "bus-key-invalid" || reason === "bus-quota"){
              busBlocked = busFailText(error, "근처 정류장을 받지 못했어요. 잠시 후 다시 찾아 주세요.", "nearby", error && error.city || "");
              failure = error;
            } else if (!failure) failure = error;
          }
          done++;
          if (live()) progress();
        }
      };
      await Promise.all(Array.from({ length:Math.min(BUS_PARALLEL, total) }, worker));
      if (seq !== busGeneration || destroyed) return;
      if (busAbort === controller) busAbort = null;
      // 키·한도 문제로 멈춘 경우는 위에서 busBlocked 를 세웠다(그 줄의 다른 칸은 live() 에서 걸려 그만둔다).
      if (choice.bus) pruneStops(here);
      if (failure){
        const text = busBlocked || busFailText(failure, "근처 정류장을 받지 못했어요. 잠시 후 다시 찾아 주세요.", "nearby", failure.city || "");
        busHint = busBlocked ? "" : text; announce(text);
      } else busHint = "";
      updateHint();
    }
    function scheduleBus(){
      if (!choice.bus || !busReady) return;
      clearTimeout(busTimer); busTimer = 0;
      if (map.getZoom() < BUS_MIN_ZOOM){
        map.removeLayer(busLayer);
        if (busAbort){ busAbort.abort(); busAbort = null; busGeneration++; }
        busHint = "";
        return;
      }
      busLayer.addTo(map);
      busTimer = setTimeout(fetchBus, BUS_DELAY);
    }
    function stopBus(){
      clearTimeout(busTimer); busTimer = 0; busGeneration++;
      if (busAbort){ busAbort.abort(); busAbort = null; }
      hidePreview();
      busLayer.clearLayers(); map.removeLayer(busLayer); busStops.clear(); cells.clear();
      busHint = ""; busBlocked = "";
      closeArrivals();
    }

    /* 정류장 도착 정보 */
    let arrivalStop = null, arrivalAbort = null, arrivalSeq = 0;
    const clock = stamp => new Date(stamp).toLocaleTimeString([], { hour12:false });
    const colorFor = type => bus && typeof bus.colorFor === "function" ? bus.colorFor(type) : "#087f8c";
    async function showArrivals(stop, force = false){
      if (!stop || !stop.id || destroyed) return;
      if (arrivalAbort) arrivalAbort.abort();
      const controller = new AbortController(), seq = ++arrivalSeq;
      arrivalAbort = controller; arrivalStop = stop;
      panel.hidden = false;
      title.textContent = stop.name + (stop.no ? " (" + stop.no + ")" : "");
      if (!force || !list.children.length) list.replaceChildren();
      status.textContent = t("도착 정보를 받는 중…"); refresh.disabled = true;
      try {
        const result = await MNJejuBusApi.request("arrivals", stop.id, { signal:controller.signal, city:stop.city || "", refresh:force });
        if (destroyed || seq !== arrivalSeq || controller.signal.aborted) return;
        const rows = result.items.map(item => {
          const row = el("li", "");
          const pick = button("", "map-btn map-jeju-bus-arrival");
          const badge = el("span", "map-jeju-bus-arrival-number"); badge.textContent = item.number; badge.style.backgroundColor = colorFor(item.type);
          const when = el("span", "map-jeju-bus-arrival-when"); when.textContent = MNJejuBusApi.arrivalText(item, t);
          const kind = el("span", "map-jeju-bus-arrival-kind"); kind.textContent = [item.type, item.vehicleType].filter(Boolean).join(" · ");
          pick.append(badge, when, kind);
          if (bus && typeof bus.pickRoute === "function"){
            pick.title = t("버스 창에서 이 노선을 검색합니다.");
            pick.addEventListener("click", () => bus.pickRoute(stop, item));
          } else pick.disabled = true;
          row.appendChild(pick);
          return row;
        });
        list.replaceChildren(...rows);
        status.textContent = (rows.length ? "" : t("지금 이 정류장으로 오는 버스 정보가 없어요.") + " · ") + t("수신") + " " + clock(result.fetchedAt);
      } catch(error){
        if (controller.signal.aborted || seq !== arrivalSeq) return;
        status.textContent = busFailText(error, "도착 정보를 받지 못했어요. 잠시 후 새로고침해 주세요.", "arrivals", stop.city || "");
      } finally {
        if (seq === arrivalSeq){ refresh.disabled = false; if (arrivalAbort === controller) arrivalAbort = null; }
      }
    }
    function closeArrivals(){
      arrivalSeq++; if (arrivalAbort){ arrivalAbort.abort(); arrivalAbort = null; }
      arrivalStop = null; panel.hidden = true; list.replaceChildren(); status.textContent = "";
    }
    refresh.addEventListener("click", () => { if (arrivalStop) showArrivals(arrivalStop, true); });
    close.addEventListener("click", closeArrivals);
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); closeArrivals(); } });

    /* ── 마우스 올림 미리보기 ──
       정류장·역에 마우스를 올리면 이름과 곧 올 버스·열차 몇 줄을 카드로 보인다. 카드는 점에 묶지 않고
       따로 띄운다(크게 확대하면 역에 이름이 늘 붙어 있어 묶은 말풍선은 뜨지 않는다).
       조회 한도가 있어 ① PREVIEW_DELAY 넘게 머문 점만 묻고(스쳐 지나간 점은 묻지 않는다) ② 받은 것은
       PREVIEW_MAX_AGE 동안 다시 쓴다(런처도 20초 캐시가 있다) ③ 키·한도 문제면 다시 켤 때까지 이름만 보인다.
       점에서 마우스가 벗어나도 PREVIEW_GRACE 동안은 남겨, 카드로 옮겨 가 누를 수 있게 한다(누르면 전체 도착 창).
       점을 떠나 있는 동안은 묻기를 미루고, 카드에 올라오면 바로 묻는다. */
    let preview = null, previewKey = "", previewTimer = 0, previewHideTimer = 0, previewAbort = null, previewSeq = 0;
    let previewStart = null, previewOnHide = null;   // 미룬 묻기 · 카드를 닫을 때 할 일(점 크기·역 이름 되돌리기)
    const previewCache = new Map();             // 열쇠 → { at, rows, total }
    const previewOff = { bus:false, subway:false };
    function tipBadge(text, color){
      const badge = el("span", "map-transit-tip-badge"); badge.textContent = text;
      badge.style.backgroundColor = color; badge.style.color = inkOn(color);
      return badge;
    }
    function previewCard(kind, name, side, no, lines){
      const card = el("div", "map-transit-tip-card is-" + kind), head = el("div", "map-transit-tip-head");
      const icon = el("span", "map-transit-tip-icon");
      if (typeof mapToolIconUrl === "function") icon.style.setProperty("--map-icon", mapToolIconUrl(kind === "bus" ? "bus" : "train"));
      const title = el("strong", "map-transit-tip-name"); title.textContent = name;
      head.append(icon, title);
      for (const line of lines.slice(0, 4)) head.appendChild(tipBadge(shortLine(line), lineColor(line)));
      if (side){ const chip = el("span", "map-transit-tip-side"); chip.textContent = side; head.appendChild(chip); }
      if (no){ const number = el("span", "map-transit-tip-no"); number.textContent = no; head.appendChild(number); }
      const rows = el("ul", "map-transit-tip-rows"), note = el("p", "map-transit-tip-note");
      card.append(head, rows, note);
      return { card, rows, note };
    }
    function fillPreview(parts, data, emptyText){
      parts.rows.replaceChildren(...data.rows.slice(0, PREVIEW_ROWS).map(row => {
        const item = el("li", row.hot ? "is-soon" : "");
        const label = el("span", "map-transit-tip-label"); label.textContent = row.label;
        const when = el("span", "map-transit-tip-when"); when.textContent = row.when;
        item.append(tipBadge(row.badge, row.color), label, when);
        return item;
      }));
      const more = data.total - Math.min(data.rows.length, PREVIEW_ROWS);
      parts.note.textContent = !data.rows.length ? emptyText
        : more > 0 ? (english() ? more + " more · click to see all" : "외 " + more + "개 · 눌러서 전체 보기") : t("눌러서 전체 보기");
      if (preview && preview.update) preview.update();     // 높이가 바뀌었으니 점 위로 다시 맞춘다
    }
    function hidePreview(key){
      if (key && key !== previewKey) return;
      previewSeq++; previewKey = ""; previewStart = null;
      clearTimeout(previewTimer); previewTimer = 0;
      clearTimeout(previewHideTimer); previewHideTimer = 0;
      if (previewAbort){ previewAbort.abort(); previewAbort = null; }
      if (preview) map.removeLayer(preview);
      const done = previewOnHide; previewOnHide = null;
      if (done) done();
    }
    // 점이나 카드에서 벗어났다 — 잠시 뒤에 닫는다(그 사이 카드나 점으로 돌아오면 그대로 둔다).
    function leavePreview(key){
      if (!key || key !== previewKey) return;
      clearTimeout(previewTimer); previewTimer = 0;        // 아직 안 물었으면 미룬다(previewStart 는 남긴다)
      clearTimeout(previewHideTimer);
      previewHideTimer = setTimeout(() => hidePreview(key), PREVIEW_GRACE);
    }
    function stayPreview(now){
      clearTimeout(previewHideTimer); previewHideTimer = 0;
      if (!previewStart || previewTimer) return;
      if (now) previewStart();
      else previewTimer = setTimeout(() => { if (previewStart) previewStart(); }, PREVIEW_DELAY);
    }
    function openPreview(key, kind, at, offsetY, parts, load, emptyText, { pick = null, onHide = null } = {}){
      if (key === previewKey && preview){ stayPreview(false); return; }   // 카드에서 점으로 돌아왔다
      hidePreview();
      if (typeof L.tooltip !== "function"){ if (onHide) onHide(); return; }
      const seq = previewSeq; previewKey = key; previewOnHide = onHide;
      preview = L.tooltip({ direction:"top", offset:[0, offsetY], className:"map-transit-tip", opacity:1, interactive:true });
      preview.setLatLng(at).setContent(parts.card);
      map.addLayer(preview);
      if (L.DomEvent.disableClickPropagation) L.DomEvent.disableClickPropagation(parts.card);
      parts.card.addEventListener("mouseenter", () => { if (seq === previewSeq) stayPreview(true); });
      parts.card.addEventListener("mouseleave", () => { if (seq === previewSeq) leavePreview(key); });
      parts.card.addEventListener("click", () => {
        if (seq !== previewSeq) return;
        hidePreview();
        if (pick) pick();
      });
      const cached = previewCache.get(key);
      if (cached && Date.now() - cached.at < PREVIEW_MAX_AGE){ fillPreview(parts, cached, emptyText); return; }
      if (previewOff[kind]){ parts.note.textContent = t("눌러서 도착 정보 보기"); return; }
      parts.note.textContent = t("도착 정보 확인 중…");
      previewStart = async () => {
        previewStart = null; clearTimeout(previewTimer); previewTimer = 0;
        if (seq !== previewSeq || destroyed) return;
        const controller = new AbortController(); previewAbort = controller;
        try {
          const data = await load(controller.signal);
          previewCache.set(key, { at:Date.now(), ...data });
          if (previewCache.size > 200) previewCache.delete(previewCache.keys().next().value);
          if (seq === previewSeq && !destroyed) fillPreview(parts, data, emptyText);
        } catch(error){
          if (controller.signal.aborted || seq !== previewSeq || destroyed) return;
          const reason = error && error.message || "";
          // 키·한도·런처 없음은 다시 물어도 같다. 다시 켜기 전까지 미리보기에서는 묻지 않는다(누르면 창이 까닭을 알려 준다).
          if (/^(bus-key-required|bus-key-invalid|bus-quota|subway-key-required|subway-key-invalid|transit-unavailable)$/.test(reason)) previewOff[kind] = true;
          parts.note.textContent = t("눌러서 도착 정보 보기");
          if (preview && preview.update) preview.update();
        } finally { if (previewAbort === controller) previewAbort = null; }
      };
      stayPreview(false);
    }
    function showStopPreview(stop, options){
      const key = (stop.city || "") + ":" + stop.id, { name, side } = splitSide(stop.name);
      const parts = previewCard("bus", name, side, stop.no || "", []);
      openPreview("bus:" + key, "bus", stop.at, -8, parts, async signal => {
        const result = await MNJejuBusApi.request("arrivals", stop.id, { signal, city:stop.city || "" });
        // 서울은 한 노선이 첫째·둘째 차로 두 줄 온다. 미리보기는 노선마다 가장 빠른 한 줄만.
        const seen = new Set(), rows = [];
        for (const item of result.items){
          if (seen.has(item.number)) continue;
          seen.add(item.number);
          rows.push({ badge:item.number, color:colorFor(item.type), label:item.type ? t(item.type) : "",
            when:MNJejuBusApi.arrivalText(item, t), hot:item.seconds != null && item.seconds < 60 });
        }
        return { rows, total:rows.length };
      }, t("지금 오는 버스가 없어요."), options);
    }
    function showStationPreview(entry, options){
      const parts = previewCard("subway", entry.name, "", "", entry.lines);
      openPreview("subway:" + entry.name, "subway", entry.at, -10, parts, async signal => {
        if (typeof MNSubwayLive === "undefined") throw new Error("transit-unavailable");
        let response;
        try {
          response = await fetch("/subway-arrival?station=" + encodeURIComponent(MNSubwayLive.apiStationName(entry.lines[0], entry.name)),
            { cache:"no-store", signal });
        } catch(error){
          if (signal.aborted) throw error;
          throw new Error("transit-unavailable");         // 런처 없이 연 HTML
        }
        if (!response.ok){
          const reason = (await response.text().catch(() => "")).trim();
          throw new Error(response.status === 404 ? "transit-unavailable" : reason || "subway-fetch-failed");
        }
        const groups = MNSubwayLive.arrivals(await response.json(), entry.lines[0]);
        // 노선·방향 묶음마다 맨 앞 열차 한 줄.
        const rows = groups.filter(group => group.rows.length).map(group => {
          const row = group.rows[0];
          return { badge:shortLine(group.line), color:lineColor(group.line),
            label:english() ? "to " + row.destination : row.destination + "행",
            when:row.message, hot:/진입|도착/.test(row.message) && !/전역/.test(row.message) };
        });
        return { rows, total:rows.length };
      }, t("지금은 이 역 도착 정보가 없어요."), options);
    }

    /* ── 켜기·끄기 ── */
    function updateHint(){
      const parts = [];
      if (choice.subway) parts.push(subwayHint);
      if (choice.bus){
        if (!busReady) parts.push(t("버스 정류장은 ClassDock EXE에서 인터넷 연결 후 볼 수 있어요."));
        else if (busBlocked) parts.push(busBlocked);
        else if (map.getZoom() < BUS_MIN_ZOOM) parts.push(t("버스 정류장은 더 확대하면 보여요."));
        else parts.push(busHint || (english() ? busStops.size + " bus stops" : "버스 정류장 " + busStops.size + "곳"));
      }
      hint.textContent = parts.filter(Boolean).join(" · ") || t("보고 싶은 것을 체크해 주세요.");
      const on = choice.subway || choice.bus;
      trigger.classList.toggle("is-on", on);
      trigger.setAttribute("aria-pressed", String(on));
    }
    let lastZoomHint = "";
    function onMove(){
      if (destroyed) return;
      drawSubway();
      scheduleBus();
      updateHint();
      // 확대 문턱을 넘나들 때만 상태줄에 알린다(옮길 때마다 상태줄을 덮지 않게).
      const zoomHint = choice.bus && busReady && map.getZoom() < BUS_MIN_ZOOM ? t("버스 정류장은 더 확대하면 보여요.")
        : choice.subway && map.getZoom() < SUBWAY_MIN_ZOOM ? t("지하철역은 더 확대하면 보여요.") : "";
      if (zoomHint && zoomHint !== lastZoomHint) announce(zoomHint);
      lastZoomHint = zoomHint;
    }
    let listening = false;
    function syncListening(){
      const want = choice.subway || (choice.bus && busReady);
      if (want && !listening){ map.on("moveend", onMove); listening = true; }
      else if (!want && listening){ map.off("moveend", onMove); listening = false; }
    }
    function apply(){
      subwayCheck.box.checked = choice.subway && hasSubway;
      busCheck.box.checked = choice.bus;
      if (!choice.subway) stopSubway();
      if (!choice.bus) stopBus();
      syncListening();
      lastZoomHint = "";
      onMove();
    }
    subwayCheck.box.addEventListener("change", () => {
      choice = { ...choice, subway:subwayCheck.box.checked };
      if (choice.subway) previewOff.subway = false;   // 다시 켜면 미리보기도 다시 묻는다
      saveChoice(choice); apply();
    });
    busCheck.box.addEventListener("change", () => {
      choice = { ...choice, bus:busCheck.box.checked };
      if (choice.bus){ busBlocked = ""; previewOff.bus = false; }   // 다시 켜면 키·한도를 다시 확인한다
      saveChoice(choice); apply();
    });

    function openMenu(open){
      menu.hidden = !open; trigger.setAttribute("aria-expanded", String(open));
      if (open) updateHint();
    }
    trigger.addEventListener("click", () => openMenu(menu.hidden));
    const outside = event => { if (!menu.hidden && !wrap.contains(event.target)) openMenu(false); };
    document.addEventListener("pointerdown", outside, true);
    wrap.addEventListener("keydown", event => { if (event.key === "Escape" && !menu.hidden){ event.stopPropagation(); openMenu(false); trigger.focus(); } });

    apply();
    fetch("/can-proxy-jeju-bus", { cache:"no-store", signal:capability.signal }).then(r => r.ok ? r.text() : "").then(value => {
      if (destroyed || value.trim() !== "yes") return;
      busReady = true; busCheck.box.disabled = false; busCheck.row.title = "";
      syncListening(); onMove();
    }).catch(() => {});

    const controller = {
      /* 장소 말풍선의 '주변 교통' — 그 자리를 가운데로 버스 정류장이 보이는 확대까지 다가가고, 쓸 수 있는
         것(지하철역 자료·EXE 버스)을 모두 켠다. 켠 상태는 체크와 같이 기억된다. */
      showAround(at){
        if (destroyed || !Array.isArray(at)) return false;
        const subway = hasSubway, busOn = busReady;
        if (!subway && !busOn){ announce(t("버스 정류장은 ClassDock EXE에서 인터넷 연결 후 볼 수 있어요.")); return false; }
        if (busOn && !choice.bus){ busBlocked = ""; previewOff.bus = false; }
        if (subway && !choice.subway) previewOff.subway = false;
        choice = { subway:choice.subway || subway, bus:choice.bus || busOn };
        saveChoice(choice); apply();
        map.setView(at, Math.max(map.getZoom(), BUS_MIN_ZOOM));
        announce(busOn ? t("이 자리 둘레의 지하철역·버스 정류장을 보여 줘요.")
          : t("이 자리 둘레의 지하철역을 보여 줘요. 버스 정류장은 ClassDock EXE에서 볼 수 있어요."));
        return true;
      },
      destroy(){
        if (destroyed) return;
        destroyed = true; capability.abort();
        stopBus(); stopSubway();
        if (listening) map.off("moveend", onMove);
        document.removeEventListener("pointerdown", outside, true);
        panel.remove(); wrap.remove(); pane.remove();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => controller.destroy());
    return controller;
  }
  return { mount, subwayStations, busCell, busCells };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNNearbyTransit;
