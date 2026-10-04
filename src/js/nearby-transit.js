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
    function bindStationLabel(marker, entry){
      marker.unbindTooltip();
      const text = entry.name + " · " + entry.lines.join(", ");
      marker.bindTooltip(labelsShown ? entry.name : text, labelsShown
        ? { permanent:true, direction:"top", offset:[0, -8], className:"map-subway-label" }
        : { direction:"top", offset:[0, -8] });
    }
    function stationMarker(entry){
      let marker = stationMarkers.get(entry);
      if (marker) return marker;
      marker = L.marker(entry.at, { pane:"mapTransitPane", keyboard:true, title:entry.name, icon:stationIcon(entry), bubblingMouseEvents:false });
      marker.on("click", () => {
        if (typeof subwayArrivals === "function" && subwayArrivals(entry.lines[0], entry.name)) return;
        announce(t("지하철 도착 정보는 ClassDock EXE에서 인증키를 넣으면 볼 수 있어요."));
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
    function stopSubway(){ subwayLayer.clearLayers(); map.removeLayer(subwayLayer); stationMarkers.clear(); labelsShown = false; subwayHint = ""; }

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
      const tip = el("span", ""); tip.textContent = stop.name + (stop.no ? " (" + stop.no + ")" : "");
      const marker = L.circleMarker(stop.at, { pane:"mapTransitPane", radius:5, color:"#ffffff", weight:2, fillColor:"#e67e22", fillOpacity:0.95,
        bubblingMouseEvents:false, className:"map-transit-stop" }).bindTooltip(tip);
      marker.on("click", () => showArrivals(stop));
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
    subwayCheck.box.addEventListener("change", () => { choice = { ...choice, subway:subwayCheck.box.checked }; saveChoice(choice); apply(); });
    busCheck.box.addEventListener("change", () => {
      choice = { ...choice, bus:busCheck.box.checked };
      if (choice.bus) busBlocked = "";        // 다시 켜면 키·한도를 다시 확인한다
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
