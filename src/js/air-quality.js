"use strict";
/* 에어코리아 측정소의 관측값을 지도에 겹친다. 좌표(dmX=위도, dmY=경도)와 관측은
   서로 다른 API이므로 측정소 코드 또는 이름·시도로 맞춘다. 모호한 이름은 잘못된 곳에 찍지 않는다.
   측정소 목록은 이레, 관측은 10분 캐시한다. 실시간 층은 .map 문서에 저장하지 않는다. */
const MNAirQuality = (() => {
  const CACHE_KEY = "mn.airQuality.stations.v1", STATION_TTL = 7 * 86400000, READING_TTL = 600000;
  const METRICS = {
    pm25:{ label:"초미세먼지(PM2.5)", short:"PM2.5", unit:"㎍/㎥", limits:[15, 35, 75], grade:"pm25Grade1h" },
    pm10:{ label:"미세먼지(PM10)", short:"PM10", unit:"㎍/㎥", limits:[30, 80, 150], grade:"pm10Grade1h" },
    o3:{ label:"오존(O₃)", short:"O₃", unit:"ppm", limits:[.03, .09, .15], grade:"o3Grade" }
  };
  const GRADES = ["관측값 없음", "좋음", "보통", "나쁨", "매우나쁨"];
  const COLORS = ["#7b8794", "#1684c7", "#26964a", "#db8500", "#db3545"];
  const text = value => value == null ? "" : String(value).trim();
  const number = value => /^\d+(?:\.\d+)?$/.test(text(value)) ? Number(value) : null;
  const validTime = value => {
    const s = text(value);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return "";
    const day = Date.parse(s.slice(0, 10) + "T00:00:00Z"), hour = Number(s.slice(11, 13)), minute = Number(s.slice(14));
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== s.slice(0, 10)
      || hour > 24 || minute > 59 || hour === 24 && minute !== 0) return "";
    const at = Date.parse(s.replace(" ", "T") + ":00+09:00");
    return Number.isFinite(at) ? s : "";
  };
  function rows(body){
    const root = body && (body.response || body), code = text(root && root.header && root.header.resultCode);
    if (code === "03") return { items:[], total:0 };
    if (code !== "00" || !root.body) throw new Error("air-invalid-data");
    const raw = root.body.items, list = Array.isArray(raw) ? raw : raw && (Array.isArray(raw.item) ? raw.item : raw.item ? [raw.item] : []);
    return { items:(list || []).filter(r => r && typeof r === "object"), total:Number(root.body.totalCount) || 0 };
  }
  function province(value){
    const s = text(value).replace(/\s/g, "");
    for (const [names, name] of [
      [["서울"], "서울"], [["부산"], "부산"], [["대구"], "대구"], [["인천"], "인천"], [["광주"], "광주"],
      [["대전"], "대전"], [["울산"], "울산"], [["세종"], "세종"], [["경기"], "경기"], [["강원"], "강원"],
      [["충북", "충청북"], "충북"], [["충남", "충청남"], "충남"], [["전북", "전라북"], "전북"],
      [["전남", "전라남"], "전남"], [["경북", "경상북"], "경북"], [["경남", "경상남"], "경남"], [["제주"], "제주"]
    ]) if (names.some(n => s.startsWith(n))) return name;
    return s;
  }
  function station(row){
    const lat = number(row.dmX), lng = number(row.dmY);
    if (!text(row.stationName) || lat == null || lng == null || lat < 32.5 || lat > 39 || lng < 124 || lng > 132.5) return null;
    return { name:text(row.stationName), code:text(row.stationCode), lat, lng,
      address:text(row.addr), sido:province(row.sidoName || row.addr), network:text(row.mangName) };
  }
  function measurement(row, metric){
    const spec = METRICS[metric], flag = text(row[metric + "Flag"]), value = number(row[metric + "Value"]);
    if (!spec || flag || value == null) return { value:null, grade:0, flag };
    const supplied = number(row[spec.grade]);
    const grade = supplied >= 1 && supplied <= 4 && Number.isInteger(supplied) ? supplied
      : spec.limits.findIndex(limit => value <= limit) + 1 || 4;
    return { value, grade, flag:"" };
  }
  // 농도를 그대로 읽을 수는 있지만 오래되거나 시각이 잘못된 값에 현재 등급 색을 주지 않는다.
  function observation(s, metric, now = Date.now()){
    const value = s[metric], at = validTime(s.at), stamp = at ? Date.parse(at.replace(" ", "T") + ":00+09:00") : NaN;
    if (value.value == null) return { ...value, grade:0, reason:value.flag || "관측값 없음" };
    if (!Number.isFinite(stamp) || stamp > now + 300000) return { ...value, grade:0, reason:"측정시각 확인 필요" };
    if (now - stamp > 7200000) return { ...value, grade:0, reason:"오래된 관측" };
    return { ...value, reason:"" };
  }
  function join(stations, readings){
    const codes = new Map(), names = new Map(), result = new Map();
    for (const s of stations){
      if (s.code){ if (!codes.has(s.code)) codes.set(s.code, []); codes.get(s.code).push(s); }
      if (!names.has(s.name)) names.set(s.name, []); names.get(s.name).push(s);
    }
    let unmatched = 0;
    for (const row of readings){
      const coded = text(row.stationCode) && codes.get(text(row.stationCode));
      let candidates = coded || names.get(text(row.stationName)) || [];
      const sido = province(row.sidoName);
      if (!coded && sido) candidates = candidates.filter(s => s.sido === sido);
      if (candidates.length !== 1){ unmatched++; continue; }
      const s = candidates[0], id = s.code || s.name + ":" + s.sido + ":" + s.lat + ":" + s.lng;
      const at = validTime(row.dataTime), old = result.get(id);
      if (old && old.at >= at) continue;
      result.set(id, { ...s, at, pm25:measurement(row, "pm25"), pm10:measurement(row, "pm10"), o3:measurement(row, "o3") });
    }
    // 측정소 목록에만 있는 곳도 결측으로 남긴다. 점검 중인 측정소를 좋은 대기질로 보이지 않게 한다.
    for (const s of stations){
      const id = s.code || s.name + ":" + s.sido + ":" + s.lat + ":" + s.lng;
      if (!result.has(id)) result.set(id, { ...s, at:"", pm25:measurement({}, "pm25"), pm10:measurement({}, "pm10"), o3:measurement({}, "o3") });
    }
    return { stations:[...result.values()], unmatched };
  }
  async function pages(kind, { signal, refresh = false } = {}){
    const list = []; let fetchedAt = Date.now();
    for (let page = 1; page <= 9; page++){
      try {
        if (signal) signal.throwIfAborted();
        const response = await fetch("/air-quality-" + kind + "?page=" + page + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
        if (!response.ok){
          const reason = text(await response.text());
          throw new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "air-fetch-failed");
        }
        const result = rows(await response.json());
        if (signal) signal.throwIfAborted();
        const stamp = Date.parse(response.headers && response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
        if (Number.isFinite(stamp)) fetchedAt = Math.min(fetchedAt, stamp);
        list.push(...result.items);
        if (!result.items.length || (result.total ? list.length >= result.total : result.items.length < 1000)) return { items:list, fetchedAt };
      } catch(error){ error.kind = kind; throw error; }
    }
    throw new Error("air-too-many-pages");
  }
  function readStations(now = Date.now()){
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!cache || !Array.isArray(cache.stations) || !cache.stations.length || !Number.isFinite(cache.at)
        || cache.at > now || now - cache.at >= STATION_TTL) return null;
      const clean = cache.stations.map(s => station({ stationName:s.name, stationCode:s.code, dmX:s.lat, dmY:s.lng, addr:s.address, sidoName:s.sido, mangName:s.network })).filter(Boolean);
      return clean.length ? clean : null;
    } catch(_){ return null; }
  }
  async function loadStations(options){
    const cached = readStations();
    if (cached) return cached;
    const list = (await pages("stations", options)).items.map(station).filter(Boolean);
    if (!list.length) throw Object.assign(new Error("air-no-stations"), { kind:"stations" });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at:Date.now(), stations:list })); } catch(_){}
    return list;
  }
  let readingCache = null;
  async function load(options = {}){
    const catalog = await loadStations({ signal:options.signal });
    const cached = readingCache && Date.now() >= readingCache.fetchedAt && Date.now() - readingCache.fetchedAt < READING_TTL;
    if (cached && !options.refresh) return { ...join(catalog, readingCache.rows), fetchedAt:readingCache.fetchedAt };
    const readings = await pages("readings", options);
    if (!readings.items.length) throw Object.assign(new Error("air-no-readings"), { kind:"readings" });
    const fetchedAt = readings.fetchedAt;
    readingCache = { rows:readings.items, fetchedAt };
    return { ...join(catalog, readings.items), fetchedAt };
  }
  function failureText(error){
    if (error.message === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (error.message === "bus-key-invalid") return error.kind === "stations"
      ? "에어코리아 측정소정보 활용신청과 승인 상태를 확인해 주세요. 승인 직후에는 반영까지 시간이 걸릴 수 있어요."
      : "에어코리아 대기오염정보 활용신청과 승인 상태를 확인해 주세요. 승인 직후에는 반영까지 시간이 걸릴 수 있어요.";
    if (error.message === "bus-quota") return "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    if (error.message === "air-no-stations") return "위치가 있는 측정소 목록을 받지 못했어요.";
    if (error.message === "air-no-readings") return "현재 관측 자료가 없어요. 잠시 후 다시 시도해 주세요.";
    return "대기질 자료를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  function mount({ map, stage, toolRow, doc, t = value => value, movePanel = null }){
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const toggle = button("미세먼지", "map-toolvis-air-quality");
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "airQuality");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-pressed", "false"); toolRow.appendChild(toggle);
    const panel = el("section", "map-weather-panel map-air-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("미세먼지"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "미세먼지"), close);
    const tools = el("div", "map-weather-tools"), select = el("select", "map-air-metric"); select.setAttribute("aria-label", t("대기질 항목"));
    for (const [id, spec] of Object.entries(METRICS)){ const option = el("option", "", spec.label); option.value = id; select.append(option); }
    select.value = "pm25";
    const refresh = button("자료 갱신", "map-air-refresh"), clear = button("지도에서 지우기", "map-air-clear"); tools.append(select, refresh, clear);
    const legend = el("div", "map-air-legend"), summary = el("p", "map-air-summary"), list = el("ol", "map-air-list");
    const status = el("p", "map-weather-status map-air-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "점은 측정소의 1시간 관측값입니다. 주변 모든 장소의 대기질을 뜻하지 않으며, 실시간 자료는 최종 확정 전 값입니다.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 한국환경공단 에어코리아");
    source.href = "https://www.airkorea.or.kr/"; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, tools, legend, summary, list, status, note, foot); stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapAirQualityPane"); pane.style.zIndex = "620"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapAirQualityPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController();
    let shown = false, destroyed = false, stations = [], fetchedAt = 0, unmatched = 0, abort = null, generation = 0, listTimer = 0;
    const markerOf = new Map(), metric = () => METRICS[select.value] ? select.value : "pm25";
    const english = () => !!(window.MNI18N && window.MNI18N.lang === "en"), word = (ko, en) => english() ? en : ko;
    const gradeText = grade => english() ? ["No observation", "Good", "Moderate", "Unhealthy", "Very unhealthy"][grade] : GRADES[grade];
    const statusText = (s, id = metric()) => { const value = observation(s, id); return value.reason ? t(value.reason) : gradeText(value.grade); };
    const valueText = (s, id = metric()) => s[id].value == null ? t(s[id].flag || "관측값 없음") : s[id].value + " " + METRICS[id].unit;
    const latestTime = () => stations.reduce((latest, s) => s.at > latest ? s.at : latest, "");
    function tooltipOf(s){
      const id = metric(), spec = METRICS[id], value = observation(s, id);
      const box = el("div", "map-air-tip map-air-tip-" + id + " map-air-tip-grade-" + value.grade);
      // 이 카드의 번역은 모듈이 맡는다. 측정소 이름과 대기질 '보통'을 다른 UI 용어로 번역하지 않는다.
      box.setAttribute("data-i18n-ignore", ""); box.setAttribute("lang", word("ko", "en"));
      const header = el("div", "map-air-tip-header"), name = el("strong", "map-air-tip-name"); name.textContent = s.name;
      header.append(name, el("span", "map-air-tip-metric", spec.short));
      const reading = el("div", "map-air-tip-reading"), status = el("strong", "map-air-tip-status"), amount = el("div", "map-air-tip-amount");
      status.textContent = value.reason ? t(value.reason) : gradeText(value.grade);
      amount.append(el("strong", "map-air-tip-value", value.value == null ? "—" : String(value.value)));
      if (value.value != null) amount.append(el("span", "map-air-tip-unit", spec.unit));
      reading.append(status, amount);
      const scale = el("div", "map-air-tip-scale"); scale.setAttribute("role", "group"); scale.setAttribute("aria-label", t("대기질 등급"));
      for (let grade = 1; grade <= 4; grade++){
        const cell = el("div", "map-air-tip-cell"), bar = el("span", "map-air-tip-bar"), label = el("span", "map-air-tip-label");
        bar.style.background = COLORS[grade]; bar.setAttribute("aria-hidden", "true"); label.textContent = gradeText(grade);
        if (grade === value.grade){
          cell.setAttribute("aria-current", "true");
          bar.append(el("i", "map-air-tip-position"));
        }
        cell.append(bar, label); scale.append(cell);
      }
      box.append(header, reading, scale);
      if (value.grade === 0 && value.value != null && s.at){
        const time = el("div", "map-air-tip-time"); time.textContent = t("측정시각") + ": " + s.at + " (KST)"; box.append(time);
      }
      return box;
    }
    function popupOf(s){
      const box = el("div", "map-air-popup"), name = el("strong", "map-air-popup-name"); name.textContent = s.name; box.append(name);
      const row = (key, value) => { const n = el("div", "map-air-popup-row"); n.append(el("span", "map-air-popup-key", key), el("span", "", value)); box.append(n); };
      row("측정시각", s.at ? s.at + " (KST)" : t("관측값 없음")); row("주소", s.address); if (s.network) row("측정망", s.network);
      for (const [id, spec] of Object.entries(METRICS)) row(spec.label, valueText(s, id) + " · " + statusText(s, id));
      box.append(el("p", "map-weather-note", "실시간 자료는 최종 확정 전 값입니다.")); return box;
    }
    function renderList(){
      listTimer = 0; list.replaceChildren();
      if (!shown){ summary.textContent = ""; return; }
      const bounds = map.getBounds(), center = map.getCenter(), id = metric();
      const inView = stations.filter(s => bounds.contains([s.lat, s.lng])).sort((a, b) => center.distanceTo([a.lat, a.lng]) - center.distanceTo([b.lat, b.lng]));
      const unavailable = inView.filter(s => observation(s, id).grade === 0).length;
      summary.textContent = t(METRICS[id].label) + word(" · 화면 안 " + inView.length + "곳", " · " + inView.length + " stations in view")
        + (latestTime() ? " · " + latestTime() + " KST" : "")
        + (unavailable ? word(" · 결측·시각 확인 " + unavailable + "곳", " · " + unavailable + " missing or outdated readings") : "");
      for (const s of inView.slice(0, 30)){
        const item = el("li"), go = button("", "map-air-go"), name = el("span", "map-air-go-name"), detail = el("span", "map-air-go-meta");
        name.textContent = s.name; detail.textContent = valueText(s) + " · " + statusText(s) + (s.at ? " · " + s.at + " KST" : "");
        go.style.borderLeftColor = COLORS[observation(s, id).grade]; go.append(name, detail);
        go.addEventListener("click", () => { map.setView([s.lat, s.lng], Math.max(14, map.getZoom())); const marker = markerOf.get(s); if (marker) marker.openPopup(); });
        item.append(go); list.append(item);
      }
      if (!inView.length) list.append(el("li", "map-air-empty", "지금 화면에는 측정소가 없어요. 지도를 옮기거나 축소해 보세요."));
      if (inView.length > 30) list.append(el("li", "map-air-empty", "가까운 30곳을 보여 줍니다. 지도를 옮기면 목록이 바뀝니다."));
    }
    function draw(){
      layer.clearLayers(); markerOf.clear(); legend.replaceChildren();
      for (let grade = 1; grade <= 4; grade++){
        const label = el("span", "map-air-grade"), dot = el("i"); dot.style.background = COLORS[grade];
        label.append(dot, document.createTextNode(gradeText(grade))); legend.append(label);
      }
      const missing = el("span", "map-air-grade"), dot = el("i"); dot.style.background = COLORS[0]; missing.append(dot, document.createTextNode(t("결측·오래된 관측"))); legend.append(missing);
      if (!shown){ map.removeLayer(layer); map.removeLayer(renderer); renderList(); return; }
      const id = metric();
      for (const s of stations){
        const m = L.circleMarker([s.lat, s.lng], { renderer, radius:6, color:"#fff", weight:1.5, fillColor:COLORS[observation(s, id).grade], fillOpacity:.9, bubblingMouseEvents:false });
        m.bindTooltip(() => tooltipOf(s), { className:"map-air-tooltip", direction:"top", opacity:1, offset:[0, -4] });
        m.bindPopup(() => popupOf(s), { maxWidth:330 }); m.addTo(layer); markerOf.set(s, m);
      }
      layer.addTo(map); renderList();
    }
    function render(){ draw(); toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown)); clear.disabled = !shown; }
    async function show(refreshing = false){
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller;
      status.textContent = t("대기질 자료를 받는 중…"); refresh.disabled = true;
      try {
        const result = await load({ signal:controller.signal, refresh:refreshing });
        if (destroyed || seq !== generation) return;
        stations = result.stations; fetchedAt = result.fetchedAt; unmatched = result.unmatched; shown = true; render();
        status.textContent = word("자료 받은 때: ", "Fetched: ") + new Date(fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST"
          + (unmatched ? word(" · 위치를 맞추지 못한 관측 " + unmatched + "건", " · " + unmatched + " readings without a matched location") : "");
      } catch(error){
        if (controller.signal.aborted || seq !== generation) return;
        status.textContent = t(failureText(error)) + (shown ? " " + t("앞서 받은 관측값을 유지합니다. 측정시각을 확인해 주세요.") : "");
      } finally { if (seq === generation){ abort = null; refresh.disabled = false; } }
    }
    function clearAll(){ generation++; if (abort) abort.abort(); abort = null; shown = false; refresh.disabled = false; render(); status.textContent = t("미세먼지 표시를 지웠어요."); }
    toggle.addEventListener("click", () => {
      if (shown || abort){ clearAll(); panel.hidden = true; } else { panel.hidden = false; show(); }
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    close.addEventListener("click", () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); });
    clear.addEventListener("click", clearAll); refresh.addEventListener("click", () => show(true));
    select.addEventListener("change", () => { map.closePopup(); render(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !listTimer) listTimer = setTimeout(renderList, 120); };
    const language = () => { map.closePopup(); render(); };
    map.on("moveend", move); window.addEventListener("mni18nchange", language);
    const ageTimer = setInterval(() => {
      if (shown && stations.some(s => markerOf.get(s).options.fillColor !== COLORS[observation(s, metric()).grade])){
        map.closePopup(); render();
      }
    }, 60000);
    fetch("/can-proxy-weather", { cache:"no-store", signal:capability.signal }).then(r => r.ok ? r.text() : "").then(value => {
      if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("측정소의 미세먼지·초미세먼지·오존 관측값을 지도에서 봅니다."); }
    }).catch(() => {});
    render();
    const controller = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){ return shown ? [t(METRICS[metric()].label), latestTime() ? latestTime() + " KST" : t("관측값 없음"), t("출처: 한국환경공단 에어코리아")].join(" · ") : ""; },
      destroy(){
        destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(listTimer); clearInterval(ageTimer);
        map.off("moveend", move); window.removeEventListener("mni18nchange", language);
        layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); pane.remove(); panel.remove(); toggle.remove(); markerOf.clear();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => controller.destroy()); return controller;
  }
  return { mount, rows, province, station, measurement, observation, join, pages, readStations, load, failureText, METRICS, GRADES, COLORS, CACHE_KEY };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNAirQuality;
