"use strict";
/* 키 없는 Open-Meteo GFS 바람. 1.5° 간격의 표본을 벡터로 보간한다.
   화면의 입자 속도는 설명용이며 실제 이동 거리/시간을 뜻하지 않는다. */
const MNWeatherWind = (() => {
  const REGION = Object.freeze({ south:30, north:42, west:122, east:134, step:1.5, rows:9, cols:9 });
  const CACHE_KEY = "classdock-wind-gfs-v2", HOUR = 3600000, HOURS = 25;
  const ATTRIBUTION = '<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> / NOAA GFS · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>';
  const WORLD_ATTRIBUTION = '<a href="https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast" target="_blank" rel="noopener noreferrer">NOAA GFS</a> · 1°';
  const COLORS = [[0, [56, 120, 220]], [5, [34, 185, 181]], [10, [115, 195, 83]],
    [15, [245, 194, 58]], [20, [238, 116, 53]], [30, [189, 55, 107]]];
  const TEMPERATURE_COLORS = [[-20, [114, 79, 185]], [-10, [64, 112, 215]], [0, [67, 182, 215]],
    [10, [115, 195, 130]], [20, [245, 207, 80]], [30, [237, 123, 57]], [40, [196, 50, 78]]];
  const WORLD_COLORS = COLORS.map((stop, i) => [[0, 10, 20, 40, 60, 100][i], stop[1]]);
  const UPPER_TEMPERATURE_COLORS = TEMPERATURE_COLORS.map((stop, i) => [[-80, -60, -40, -20, 0, 10, 20][i], stop[1]]);
  let memory = null, pending = null, retryAt = 0;
  function coordinates(){
    return Array.from({ length:REGION.rows * REGION.cols }, (_, i) => ({
      lat:REGION.south + Math.floor(i / REGION.cols) * REGION.step,
      lng:REGION.west + (i % REGION.cols) * REGION.step
    }));
  }
  function requestUrl(){
    const points = coordinates();
    const q = new URLSearchParams({ latitude:points.map(p => p.lat).join(","), longitude:points.map(p => p.lng).join(","),
      hourly:"wind_speed_10m,wind_direction_10m,temperature_2m", forecast_hours:String(HOURS), wind_speed_unit:"ms",
      temperature_unit:"celsius", timeformat:"unixtime", cell_selection:"nearest" });
    return "https://api.open-meteo.com/v1/gfs?" + q;
  }
  function vector(speed, from){
    if (!Number.isFinite(speed) || speed < 0 || speed > 150 || !Number.isFinite(from) || from < 0 || from > 360) return null;
    const angle = from * Math.PI / 180;
    // 기상 풍향은 불어오는 방향. 입자는 그 반대 방향으로 움직인다.
    return { u:-speed * Math.sin(angle), v:-speed * Math.cos(angle) };
  }
  function parse(body, now = Date.now()){
    const points = coordinates();
    if (!Array.isArray(body) || body.length !== points.length) throw new Error("wind-data");
    let frames = null;
    const seen = new Set();
    body.forEach((item, index) => {
      const id = item.location_id == null ? index : item.location_id, point = points[id];
      if (!Number.isInteger(id) || !point || seen.has(id) || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)
          || Math.abs(item.latitude - point.lat) > .6 || Math.abs(item.longitude - point.lng) > .6) throw new Error("wind-data");
      seen.add(id);
      const h = item.hourly, units = item.hourly_units;
      if (!h || !Array.isArray(h.time) || h.time.length !== HOURS || !units || units.wind_speed_10m !== "m/s"
          || units.time !== "unixtime" || units.wind_direction_10m !== "°" || units.temperature_2m !== "°C"
          || ["wind_speed_10m", "wind_direction_10m", "temperature_2m"].some(key => !Array.isArray(h[key]) || h[key].length !== HOURS)) throw new Error("wind-data");
      const times = h.time.map(v => Number.isFinite(v) ? v * 1000 : NaN);
      if (times.some((v, i) => !Number.isFinite(v) || (i > 0 && v !== times[0] + i * HOUR))
          || Math.abs(now - times[0]) > 2 * HOUR || (frames && frames.some((f, i) => f.validAt !== times[i]))) throw new Error("wind-time");
      if (!frames) frames = times.map(validAt => ({ validAt, values:new Array(points.length) }));
      frames.forEach((f, i) => {
        const wind = vector(h.wind_speed_10m[i], h.wind_direction_10m[i]), temp = h.temperature_2m[i];
        f.values[id] = { u:wind ? wind.u : null, v:wind ? wind.v : null,
          temp:Number.isFinite(temp) && temp >= -100 && temp <= 70 ? temp : null };
      });
    });
    if (frames.some(f => f.values.filter(v => Number.isFinite(v.u)).length < points.length * .8)) throw new Error("wind-data");
    return { version:2, validAt:frames[0].validAt, fetchedAt:now, frames };
  }
  function validCache(grid, now){
    return !!grid && grid.version === 2 && Number.isFinite(grid.validAt) && Number.isFinite(grid.fetchedAt)
      && now - grid.validAt >= -HOUR && now - grid.validAt < 24 * HOUR && grid.fetchedAt <= now + 60000
      && grid.fetchedAt >= grid.validAt - HOUR && Array.isArray(grid.frames) && grid.frames.length === HOURS
      && grid.frames.every((f, i) => f && f.validAt === grid.validAt + i * HOUR && Array.isArray(f.values) && f.values.length === 81
        && f.values.filter(v => v && Number.isFinite(v.u) && Number.isFinite(v.v)).length >= 65
        && f.values.every(v => v && ((v.u === null && v.v === null) ||
          (Number.isFinite(v.u) && Number.isFinite(v.v) && Math.hypot(v.u, v.v) <= 150))
          && (v.temp === null || (Number.isFinite(v.temp) && v.temp >= -100 && v.temp <= 70))));
  }
  function timeIndex(grid, time = Date.now()){
    return Math.max(0, Math.min(grid.frames.length - 1, Math.floor((time - grid.validAt) / (grid.world ? 3 * HOUR : HOUR))));
  }
  function fresh(grid, now){ return validCache(grid, now) && now - grid.fetchedAt < HOUR && now - grid.validAt < HOUR; }
  async function load(){
    const now = Date.now();
    if (!validCache(memory, now)){
      memory = null;
      try { const saved = JSON.parse(localStorage.getItem(CACHE_KEY)); if (validCache(saved, now)) memory = saved; } catch(_){}
    }
    if (fresh(memory, now)) return { grid:memory, saved:false };
    if (pending) return pending;
    if (now < retryAt){ if (memory) return { grid:memory, saved:true }; throw new Error("wind-retry"); }
    pending = (async () => {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 25000);
      try {
        const response = await fetch(requestUrl(), { signal:abort.signal, credentials:"omit", referrerPolicy:"no-referrer" });
        if (!response.ok) throw new Error(response.status === 429 ? "wind-quota" : "wind-network");
        const grid = parse(await response.json());
        memory = grid; retryAt = 0;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(grid)); } catch(_){}
        return { grid, saved:false };
      } catch(error){
        retryAt = Date.now() + 5 * 60000;
        if (validCache(memory, Date.now())) return { grid:memory, saved:true };
        throw error;
      } finally { clearTimeout(timer); pending = null; }
    })();
    return pending;
  }
  function sample(grid, lat, lng){
    if (!grid) return null;
    if (grid.world) return worldSample(grid, lat, lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < REGION.south || lat > REGION.north || lng < REGION.west || lng > REGION.east) return null;
    const x = (lng - REGION.west) / REGION.step, y = (lat - REGION.south) / REGION.step;
    const col = Math.min(REGION.cols - 2, Math.floor(x)), row = Math.min(REGION.rows - 2, Math.floor(y));
    const dx = x - col, dy = y - row, values = grid.values;
    const corners = [values[row * REGION.cols + col], values[row * REGION.cols + col + 1],
      values[(row + 1) * REGION.cols + col], values[(row + 1) * REGION.cols + col + 1]];
    const weights = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
    // 변수별로 결측을 유지한다. 바람 결측 때문에 온도를 숨기거나, 결측을 0으로 보간하지 않는다.
    const interpolate = key => corners.some((v, i) => weights[i] > 1e-10 && (!v || !Number.isFinite(v[key]))) ? null
      : corners.reduce((sum, v, i) => sum + (weights[i] > 1e-10 ? v[key] * weights[i] : 0), 0);
    const u = interpolate("u"), v = interpolate("v"), temp = interpolate("temp");
    const speed = u === null || v === null ? null : Math.hypot(u, v);
    const direction = speed === null || speed < .05 ? null : (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
    return { u, v, speed, direction, temp };
  }
  function color(value, mode = "wind", stops = mode === "temperature" ? TEMPERATURE_COLORS : COLORS){
    value = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], value));
    const index = stops.findIndex((stop, i) => i > 0 && value <= stop[0]);
    const a = stops[index - 1], b = stops[index], mix = (value - a[0]) / (b[0] - a[0]);
    return a[1].map((channel, i) => Math.round(channel + (b[1][i] - channel) * mix));
  }
  const WORLD_COUNT = 360 * 181, WORLD_LEVELS = [10, 850, 500, 250];
  const worldMemory = new Map(), worldPending = new Map();
  async function worldRequest(url, binary = false){
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 120000);
    try {
      const response = await fetch(url, { signal:abort.signal, cache:"no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "world-wind-desktop" : "world-wind-network");
      return binary ? await response.arrayBuffer() : await response.json();
    } finally { clearTimeout(timer); }
  }
  function parseWorldCatalog(body, now = Date.now()){
    if (!body || !/^\d{10}$/.test(body.cycle) || !Number.isFinite(body.runAt) || body.runAt > now
        || now - body.runAt >= 48 * HOUR || body.runAt % (6 * HOUR) !== 0 || body.step !== 3 || body.resolution !== 1
        || !Array.isArray(body.hours) || body.hours.length !== 9 || body.hours.some((h, i) => !Number.isInteger(h)
          || h < 0 || h > 72 || h % 3 !== 0 || h !== body.hours[0] + 3 * i)
        || new Date(body.runAt).toISOString().replace(/[-T:]/g, "").slice(0, 10) !== body.cycle) throw new Error("world-wind-data");
    return body;
  }
  async function worldCatalog(){
    // Relative routes only exist in the Windows EXE. Avoid fetching large data in a standalone HTML page.
    try {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
      try {
        const response = await fetch("/can-proxy-world-wind", { signal:abort.signal, cache:"no-store" });
        if (!response.ok || (await response.text()).trim() !== "yes") throw new Error("world-wind-desktop");
      } finally { clearTimeout(timer); }
    } catch(_) { throw new Error("world-wind-desktop"); }
    return parseWorldCatalog(await worldRequest("/world-wind-catalog"));
  }
  function parseWorldFrame(buffer, catalog, hour, level){
    if (!buffer || buffer.byteLength !== 40 + WORLD_COUNT * 12) throw new Error("world-wind-data");
    const view = new DataView(buffer), runAt = view.getFloat64(16, true), validAt = view.getFloat64(24, true), fetchedAt = view.getFloat64(32, true);
    if (view.getUint32(0, true) !== 0x31574443 || view.getInt32(4, true) !== 360 || view.getInt32(8, true) !== 181
        || !WORLD_LEVELS.includes(level) || view.getInt32(12, true) !== level || runAt !== catalog.runAt || validAt !== runAt + hour * HOUR
        || !Number.isFinite(fetchedAt) || fetchedAt < runAt || fetchedAt > Date.now() + 60000) throw new Error("world-wind-data");
    const arrays = Array.from({ length:3 }, (_, channel) => {
      const data = new Float32Array(WORLD_COUNT);
      for (let i = 0; i < WORLD_COUNT; i++){
        const v = view.getFloat32(40 + (channel * WORLD_COUNT + i) * 4, true);
        if (!Number.isNaN(v) && (!Number.isFinite(v) || (channel === 2 ? v < -120 || v > 70 : Math.abs(v) > 200))) throw new Error("world-wind-data");
        data[i] = v;
      }
      return data;
    });
    return { world:true, level, runAt, validAt, fetchedAt, u:arrays[0], v:arrays[1], temp:arrays[2] };
  }
  async function worldFrame(catalog, index, level){
    const hour = catalog.hours[index];
    if (!Number.isInteger(hour) || !WORLD_LEVELS.includes(level)) throw new Error("world-wind-data");
    const key = catalog.cycle + "/" + hour + "/" + level;
    if (worldMemory.has(key)){ const data = worldMemory.get(key); worldMemory.delete(key); worldMemory.set(key, data); return data; }
    if (worldPending.has(key)) return worldPending.get(key);
    const task = (async () => {
      const buffer = await worldRequest("/world-wind-frame?" + new URLSearchParams({ cycle:catalog.cycle, hour:String(hour), level:String(level) }), true);
      const data = parseWorldFrame(buffer, catalog, hour, level); worldMemory.set(key, data);
      while (worldMemory.size > 12) worldMemory.delete(worldMemory.keys().next().value);
      return data;
    })();
    worldPending.set(key, task);
    try { return await task; } finally { worldPending.delete(key); }
  }
  function worldSample(grid, lat, lng){
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85.05112878 || !grid.u) return null;
    const x = ((lng % 360) + 360) % 360, y = lat + 90, col = Math.floor(x), row = Math.floor(y), dx = x - col, dy = y - row;
    const ids = [row * 360 + col, row * 360 + (col + 1) % 360, (row + 1) * 360 + col, (row + 1) * 360 + (col + 1) % 360];
    const weights = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
    const interpolate = values => ids.some((id, i) => weights[i] > 1e-10 && !Number.isFinite(values[id])) ? null
      : ids.reduce((sum, id, i) => sum + (weights[i] > 1e-10 ? values[id] * weights[i] : 0), 0);
    const u = interpolate(grid.u), v = interpolate(grid.v), temp = interpolate(grid.temp), speed = u === null || v === null ? null : Math.hypot(u, v);
    return { u, v, temp, speed, direction:speed === null || speed < .05 ? null : (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360 };
  }
  function mount({ map, stage, toolRow, doc, movePanel = null }){
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
    const btn = cls => { const n = el("button", "map-btn " + cls); n.type = "button"; return n; };
    const toggle = btn("map-toolvis-weather map-wind-toggle"); toolRow.append(toggle);
    const panel = el("section", "map-weather-panel map-wind-panel"); panel.hidden = true;
    const heading = el("div", "map-weather-heading"), title = el("strong"), close = btn("map-wind-close"); heading.append(title, close);
    const controls = el("div", "map-weather-tools"), show = btn("map-wind-show"), pause = btn("map-wind-pause"), clear = btn("map-wind-clear");
    controls.append(show, pause, clear);
    const colorLabel = el("label", "map-wind-color-label"), colorCheck = el("input"); colorCheck.type = "checkbox"; colorCheck.checked = true;
    const colorText = el("span"); colorLabel.append(colorCheck, colorText);
    const modeLabel = el("label", "map-wind-mode-label"), modeText = el("span"), modeSelect = el("select", "map-select map-wind-mode");
    const windOption = el("option"), tempOption = el("option"); windOption.value = "wind"; tempOption.value = "temperature";
    modeSelect.append(windOption, tempOption); modeSelect.value = "wind"; modeLabel.append(modeText, modeSelect);
    const scopeLabel = el("label", "map-wind-mode-label"), scopeText = el("span"), scopeSelect = el("select", "map-select map-wind-scope");
    const koreaOption = el("option"), worldOption = el("option"); koreaOption.value = "korea"; worldOption.value = "world";
    scopeSelect.append(koreaOption, worldOption); scopeSelect.value = "korea"; scopeLabel.append(scopeText, scopeSelect);
    const levelLabel = el("label", "map-wind-mode-label"), levelText = el("span"), levelSelect = el("select", "map-select map-wind-level");
    const levelOptions = WORLD_LEVELS.map(level => { const option = el("option"); option.value = String(level); levelSelect.append(option); return option; });
    levelSelect.value = "10"; levelLabel.append(levelText, levelSelect);
    const timeline = el("div", "map-wind-timeline"), timeTitle = el("div"), timeOutput = el("output", "map-wind-selected-time");
    const slider = el("input", "map-wind-time"); slider.type = "range"; slider.min = "0"; slider.max = String(HOURS - 1); slider.step = "1"; slider.value = "0";
    const timeEnds = el("div", "map-wind-time-ends"), timeStart = el("span"), timeEnd = el("span"); timeEnds.append(timeStart, timeEnd);
    const timeButtons = el("div", "map-weather-tools"), previous = btn("map-wind-previous"), current = btn("map-wind-current"), next = btn("map-wind-next");
    timeButtons.append(previous, current, next); timeline.append(timeTitle, timeOutput, slider, timeEnds, timeButtons);
    const spotBox = el("div", "map-wind-spot"), spotTitle = el("strong"), spotValues = el("p", "map-wind-spot-values"), spotNote = el("small");
    spotBox.setAttribute("aria-live", "polite"); spotBox.append(spotTitle, spotValues, spotNote);
    const status = el("p", "map-weather-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note"), source = el("a"); source.href = "https://open-meteo.com/"; source.target = "_blank"; source.rel = "noopener noreferrer";
    source.textContent = "Open-Meteo / NOAA GFS · CC BY 4.0";
    panel.append(heading, scopeLabel, levelLabel, controls, modeLabel, colorLabel, timeline, spotBox, status, note, source); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapWindPane"); pane.style.zIndex = "390"; pane.style.pointerEvents = "none";
    const heat = el("canvas", "map-wind-canvas leaflet-zoom-hide"), trails = el("canvas", "map-wind-canvas leaflet-zoom-hide"), spotCanvas = el("canvas", "map-wind-canvas leaflet-zoom-hide");
    for (const canvas of [heat, trails, spotCanvas]) canvas.setAttribute("aria-hidden", "true");
    pane.append(heat, trails, spotCanvas);
    const heatCtx = heat.getContext("2d"), ctx = trails.getContext("2d"), spotCtx = spotCanvas.getContext("2d");
    const legend = el("div", "map-wind-legend"), legendTitle = el("div"), ramp = el("div", "map-wind-ramp"), ticks = el("div", "map-wind-ticks"), timeLabel = el("div");
    legend.append(legendTitle, ramp, ticks, timeLabel); stage.append(legend); legend.hidden = true;
    let grid = null, saved = false, active = false, playing = false, moving = false, destroyed = false, loading = false;
    let frame = 0, lastFrame = 0, generation = 0, frozen = 0, width = 0, height = 0, ratio = 1, columns = 0;
    let field = [], seeds = [], particles = [], errorKey = "", selectedIndex = 0, spot = null;
    let catalog = null, attribution = "";
    const CELL = 12;
    const stamp = time => new Date(time).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }) + " KST";
    const selectedFrame = () => grid ? grid.frames[selectedIndex] : null;
    const isWorld = () => scopeSelect.value === "world";
    const levelName = () => isWorld() && levelSelect.value !== "10" ? levelSelect.value + " hPa" : word("지상 10m", "10 m");
    const colorStops = () => modeSelect.value === "temperature" ? (isWorld() && levelSelect.value !== "10" ? UPPER_TEMPERATURE_COLORS : TEMPERATURE_COLORS)
      : isWorld() ? WORLD_COLORS : COLORS;
    function renderLegend(){
      const temperature = modeSelect.value === "temperature", stops = colorStops();
      const min = stops[0][0], max = stops[stops.length - 1][0], percent = n => (n - min) / (max - min) * 100;
      ramp.style.background = "linear-gradient(to right," + stops.map(c => "rgb(" + c[1].join(",") + ") " + percent(c[0]) + "%").join(",") + ")";
      ticks.replaceChildren();
      for (const [n] of stops){
        const tick = el("span"); tick.textContent = n === max ? n + "+" : temperature && n === min ? n + "−" : String(n);
        tick.style.left = percent(n) + "%"; ticks.append(tick);
      }
      ramp.hidden = ticks.hidden = !colorCheck.checked;
      const tempLevel = isWorld() && levelSelect.value !== "10" ? levelName() : word("지상 2m", "2 m");
      legendTitle.textContent = colorCheck.checked && temperature ? tempLevel + word(" 기온 · °C / 선: 바람", " temperature · °C / lines: wind")
        : levelName() + word(" 풍속 · m/s", " wind · m/s");
    }
    function renderSpot(){
      spotBox.hidden = !active;
      spotTitle.textContent = spot ? word("선택 지점 · ", "Selected point · ") + spot.lat.toFixed(3) + ", " + spot.lng.toFixed(3)
        : word("지도에서 지점을 눌러 보세요", "Select a point on the map");
      spotNote.textContent = word("선택한 시각의 보간 예보입니다. 풍향은 바람이 불어오는 방향입니다.", "Interpolated forecast for the selected time. Direction indicates where wind comes from.");
      if (!active || !spot){ spotValues.textContent = ""; return; }
      const value = sample(selectedFrame(), spot.lat, spot.lng);
      if (!value){ spotValues.textContent = word("표시 범위 밖입니다.", "Outside the covered region."); return; }
      if (isWorld() && value.speed === null && value.temp === null){ spotValues.textContent = word("지형 아래의 기압면이거나 자료가 없는 지점입니다.", "This pressure level is below terrain, or data is missing."); return; }
      const directions = word("북,북북동,북동,동북동,동,동남동,남동,남남동,남,남남서,남서,서남서,서,서북서,북서,북북서", "N,NNE,NE,ENE,E,ESE,SE,SSE,S,SSW,SW,WSW,W,WNW,NW,NNW").split(",");
      const direction = value.direction === null ? (value.speed === null ? "—" : word("무풍", "Calm"))
        : directions[Math.round(value.direction / 22.5) % 16] + " " + (Math.round(value.direction) % 360) + "°";
      spotValues.textContent = word("풍속 ", "Speed ") + (value.speed === null ? "—" : value.speed.toFixed(1) + " m/s")
        + " · " + word("풍향 ", "From ") + direction + "\n" + word("기온 ", "Temperature ") + (value.temp === null ? "—" : value.temp.toFixed(1) + " °C")
        + "\n" + stamp(selectedFrame().validAt);
    }
    function drawSpot(){
      if (!spotCtx) return;
      spotCtx.clearRect(0, 0, width, height); if (!active || !spot) return;
      const p = map.latLngToContainerPoint(spot), x = p.x * ratio, y = p.y * ratio;
      spotCtx.beginPath(); spotCtx.arc(x, y, 7, 0, Math.PI * 2); spotCtx.fillStyle = "#102b40"; spotCtx.fill();
      spotCtx.strokeStyle = "white"; spotCtx.lineWidth = 2; spotCtx.stroke();
    }
    function sync(){
      toggle.textContent = word("바람", "Wind"); title.textContent = isWorld() ? word("세계 바람", "World wind") : word("한반도 주변 바람", "Wind around Korea");
      scopeText.textContent = word("범위", "Region"); koreaOption.textContent = word("한반도 주변", "Around Korea"); worldOption.textContent = word("세계", "World");
      levelText.textContent = word("고도 · 기압면", "Height / pressure"); levelLabel.hidden = !isWorld(); levelSelect.disabled = loading;
      [word("지상 10m", "10 m above ground"), "850 hPa (~1.5 km)", "500 hPa (~5.5 km)", "250 hPa (~10.5 km)"].forEach((label, i) => { levelOptions[i].textContent = label; });
      source.href = isWorld() ? "https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast" : "https://open-meteo.com/";
      source.textContent = isWorld() ? "NOAA GFS · 1°" : "Open-Meteo / NOAA GFS · CC BY 4.0";
      panel.setAttribute("aria-label", title.textContent); toggle.setAttribute("aria-expanded", String(!panel.hidden));
      toggle.setAttribute("aria-pressed", String(active)); toggle.classList.toggle("is-on", active);
      close.textContent = word("닫기", "Close"); show.textContent = active ? word("자료 갱신", "Update data") : isWorld() ? word("세계 바람 보기", "Show world wind") : word("한반도 바람 보기", "Show wind");
      show.disabled = loading; pause.disabled = !active; clear.disabled = !active && !loading;
      pause.textContent = word(playing ? "일시정지" : "재생", playing ? "Pause" : "Play"); pause.setAttribute("aria-pressed", String(playing)); clear.textContent = word("지도에서 지우기", "Clear wind");
      colorText.textContent = word("색상 표시", "Show colors"); modeText.textContent = word("지도 색상", "Map colors");
      windOption.textContent = word("풍속", "Wind speed"); tempOption.textContent = word("기온", "Temperature");
      const count = grid ? grid.frames.length : isWorld() ? 9 : HOURS;
      timeTitle.textContent = isWorld() ? word("예보 시각 · 3시간 간격", "Forecast time · every 3 hours") : word("예보 시각 · 1시간 간격", "Forecast time · hourly"); slider.setAttribute("aria-label", timeTitle.textContent);
      timeOutput.textContent = grid ? stamp(selectedFrame().validAt) : word("자료를 받으면 시각을 고를 수 있습니다.", "Load data to choose a time.");
      slider.max = String(count - 1); slider.value = String(selectedIndex); slider.disabled = !active || loading; slider.setAttribute("aria-valuetext", timeOutput.textContent);
      timeStart.textContent = grid ? stamp(grid.validAt) : ""; timeEnd.textContent = grid ? stamp(grid.frames[count - 1].validAt) : "";
      previous.textContent = word("이전 시간", "Previous hour"); current.textContent = word("현재 시각", "Current hour"); next.textContent = word("다음 시간", "Next hour");
      previous.disabled = !active || loading || selectedIndex === 0; next.disabled = !active || loading || selectedIndex === count - 1; current.disabled = !active || loading;
      note.textContent = word("가입·키 없이 사용 · 비상업적 이용. 바람은 지상 10m, 기온은 지상 2m 예보를 1.5° 간격으로 받아 보간합니다. 범위: 북위 30–42°, 동경 122–134°. 선의 움직임은 설명용입니다. 자료는 1시간 재사용합니다.",
        "No account or key · non-commercial use. 10 m wind and 2 m temperature sampled every 1.5° and interpolated; 30–42°N, 122–134°E. Particle motion is illustrative. Data is reused for one hour.");
      if (isWorld()) note.textContent = word("가입·키 없이 Windows EXE에서 사용. NOAA GFS 1° 격자 예보이며 선택한 시각·고도만 받아 저장합니다. 지상 기온은 2m, 상층 기온은 선택한 기압면 기준입니다. 괄호의 높이는 근삿값이며 지형 아래 기압면과 극지방(±85° 밖)은 숨깁니다. 선의 움직임은 설명용입니다.",
        "No account or key, in the Windows EXE. NOAA GFS 1° forecasts are downloaded and cached for the selected time and level. Surface temperature is at 2 m; upper temperature is on the selected pressure surface. Heights are approximate. Below-terrain levels and polar regions beyond ±85° are hidden. Particle motion is illustrative.");
      renderLegend(); renderSpot();
      timeLabel.textContent = grid ? (saved ? word("저장 자료 · ", "Saved data · ") : "") + stamp(selectedFrame().validAt)
        + (isWorld() ? " · " + levelName() + word(" · 모델 ", " · Run ") + stamp(grid.runAt) : "") : "";
      legend.hidden = !active;
      if (loading) status.textContent = word("바람 자료를 받는 중…", "Loading wind data…");
      else if (errorKey === "world-wind-desktop") status.textContent = word("세계 바람은 최신 Windows ClassDock.exe에서 사용할 수 있습니다.", "World wind requires the latest Windows ClassDock.exe.");
      else if (errorKey) status.textContent = errorKey === "wind-quota" || errorKey === "wind-retry"
        ? word("조회가 제한되었습니다. 5분 뒤 다시 눌러 주세요.", "Requests are limited. Try again in five minutes.")
        : word("바람 자료를 받지 못했습니다. 인터넷 연결을 확인하고 잠시 후 다시 눌러 주세요.", "Could not load wind. Check your connection and try again later.");
      else if (active) status.textContent = (saved ? word("갱신 실패 — 저장 자료 표시 · ", "Update failed — showing saved data · ") : word("선택한 예보 · ", "Selected forecast · ")) + stamp(selectedFrame().validAt)
        + word(" · 수신 ", " · Fetched ") + stamp(grid.fetchedAt);
      else status.textContent = word("버튼을 누르면 선택한 범위의 바람을 표시합니다.", "Select Show wind to display the selected region.");
    }
    function stop(){ if (frame) cancelAnimationFrame(frame); frame = 0; lastFrame = 0; }
    function at(x, y){ return x >= 0 && y >= 0 && x < width && y < height ? field[Math.floor(y / CELL) * columns + Math.floor(x / CELL)] : null; }
    function seed(){ const s = seeds[Math.floor(Math.random() * seeds.length)]; return s ? { x:s.x, y:s.y, age:Math.random() * 3 } : null; }
    function tick(time){
      frame = 0;
      if (!active || !playing || moving || frozen || destroyed || document.hidden || !seeds.length || !stage.getClientRects().length) return;
      if (!lastFrame){ lastFrame = time; frame = requestAnimationFrame(tick); return; }
      if (time - lastFrame < 32){ frame = requestAnimationFrame(tick); return; }
      const dt = Math.min(.1, (time - lastFrame) / 1000); lastFrame = time;
      ctx.globalCompositeOperation = "destination-in"; ctx.fillStyle = "rgba(0,0,0,0.91)"; ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.25; ctx.beginPath();
      particles = particles.map(p => {
        const v = p && at(p.x, p.y);
        if (!v || p.age > 4) return seed();
        const x = p.x + v.dx * dt, y = p.y + v.dy * dt;
        if (!at(x, y)) return seed();
        ctx.moveTo(p.x, p.y); ctx.lineTo(x, y); return { x, y, age:p.age + dt };
      });
      ctx.stroke(); frame = requestAnimationFrame(tick);
    }
    function start(){ stop(); if (active && playing && !moving && !frozen && !document.hidden && !destroyed && seeds.length) frame = requestAnimationFrame(tick); }
    function redraw(){
      stop(); if (!active || destroyed || !heatCtx || !ctx) return;
      const size = map.getSize(); ratio = Math.min(1, 1600 / Math.max(1, size.x, size.y));
      width = Math.max(1, Math.round(size.x * ratio)); height = Math.max(1, Math.round(size.y * ratio));
      const origin = map.containerPointToLayerPoint([0, 0]);
      for (const canvas of [heat, trails, spotCanvas]){ canvas.width = width; canvas.height = height; canvas.style.width = size.x + "px"; canvas.style.height = size.y + "px"; L.DomUtil.setPosition(canvas, origin); }
      heat.hidden = !colorCheck.checked; pane.style.visibility = "";
      columns = Math.ceil(width / CELL); field = []; seeds = [];
      for (let y = 0; y < height; y += CELL) for (let x = 0; x < width; x += CELL){
        const px = Math.min(width - 1, x + CELL / 2), py = Math.min(height - 1, y + CELL / 2);
        const ll = map.containerPointToLatLng([px / ratio, py / ratio]), wind = sample(selectedFrame(), ll.lat, ll.lng);
        if (!wind){ field.push(null); continue; }
        // Mercator의 동서·남북 배율에 같은 위도 계수를 적용한다. 속도는 화면 표시용이다.
        const scale = 2 * ratio / Math.max(.15, Math.cos(ll.lat * Math.PI / 180));
        field.push(wind.speed === null ? null : { dx:wind.u * scale, dy:-wind.v * scale });
        if (wind.speed !== null) seeds.push({ x:px, y:py });
        const value = modeSelect.value === "temperature" ? wind.temp : wind.speed;
        if (value !== null){ heatCtx.fillStyle = "rgba(" + color(value, modeSelect.value, colorStops()).join(",") + ",.42)"; heatCtx.fillRect(x, y, CELL, CELL); }
      }
      ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 1.5;
      // 정지 상태에서도 방향이 남도록 처음에는 작은 화살표를 그린다.
      for (let y = 30; y < height; y += 64) for (let x = 30; x < width; x += 64){
        const v = at(x, y); if (!v || Math.hypot(v.dx, v.dy) < .2) continue;
        const angle = Math.atan2(v.dy, v.dx), length = 10;
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(length, 0);
        ctx.lineTo(length - 5, -4); ctx.moveTo(length, 0); ctx.lineTo(length - 5, 4); ctx.stroke(); ctx.restore();
      }
      particles = Array.from({ length:Math.min(650, Math.ceil(seeds.length / 5)) }, seed); drawSpot(); start();
    }
    function suspend(){ moving = true; stop(); pane.style.visibility = "hidden"; }
    function moved(){ moving = false; redraw(); }
    function visibility(){ if (document.hidden) stop(); else start(); }
    async function showWind(options = {}){
      if (loading || frozen || destroyed) return;
      const world = isWorld(), wasActive = active, wasPlaying = playing, selectedTime = active ? selectedFrame().validAt : Date.now();
      if (world){ const keepSpot = spot; clearWind(false); spot = keepSpot; }
      const seq = ++generation; loading = true; errorKey = ""; sync();
      try {
        let result, index;
        if (world){
          const selectedCatalog = options.reuse && catalog ? catalog : await worldCatalog();
          if (destroyed || seq !== generation) return;
          catalog = selectedCatalog;
          const frames = catalog.hours.map(h => ({ validAt:catalog.runAt + h * HOUR }));
          const data = { world:true, level:Number(levelSelect.value), runAt:catalog.runAt, validAt:frames[0].validAt, frames };
          index = Number.isInteger(options.index) ? Math.max(0, Math.min(8, options.index)) : timeIndex(data, selectedTime);
          const loaded = await worldFrame(catalog, index, data.level);
          data.frames[index] = loaded; data.fetchedAt = loaded.fetchedAt;
          result = { grid:data, saved:catalog.saved === true };
        } else result = await load();
        if (destroyed || seq !== generation) return;
        if (!heatCtx || !ctx) throw new Error("wind-canvas");
        grid = result.grid; selectedIndex = world ? index : timeIndex(grid, selectedTime); saved = result.saved; active = true;
        if (!attribution){ attribution = world ? WORLD_ATTRIBUTION : ATTRIBUTION; if (map.attributionControl) map.attributionControl.addAttribution(attribution); }
        playing = wasActive ? wasPlaying : !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!wasActive && !options.reuse)
          map.fitBounds(world ? [[-65, -180], [75, 180]] : [[REGION.south, REGION.west], [REGION.north, REGION.east]], { padding:[35, 35], animate:false });
        redraw();
      } catch(error){ if (!destroyed && seq === generation) errorKey = error.message || "wind-network"; }
      finally { if (!destroyed && seq === generation){ loading = false; sync(); } }
    }
    function clearWind(resetCatalog = true){
      if (attribution && map.attributionControl) map.attributionControl.removeAttribution(attribution);
      attribution = ""; if (resetCatalog) catalog = null;
      generation++; loading = false; active = false; playing = false; grid = null; selectedIndex = 0; spot = null; errorKey = ""; stop();
      field = []; seeds = []; particles = []; if (heatCtx) heatCtx.clearRect(0, 0, width, height); if (ctx) ctx.clearRect(0, 0, width, height); drawSpot(); sync();
    }
    function selectTime(index){
      if (!active || loading || frozen || !Number.isFinite(index)) return;
      if (isWorld()) return showWind({ reuse:true, index });
      selectedIndex = Math.max(0, Math.min(HOURS - 1, Math.floor(index))); redraw(); sync();
    }
    toggle.addEventListener("click", () => { panel.hidden = !panel.hidden; sync(); if (!panel.hidden) show.focus(); });
    close.addEventListener("click", () => { panel.hidden = true; sync(); toggle.focus(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    show.addEventListener("click", showWind); clear.addEventListener("click", clearWind);
    pause.addEventListener("click", () => { playing = !playing; if (playing) start(); else stop(); sync(); });
    colorCheck.addEventListener("change", () => { heat.hidden = !colorCheck.checked; sync(); });
    modeSelect.addEventListener("change", () => { redraw(); sync(); });
    scopeSelect.addEventListener("change", () => { clearWind(); sync(); });
    levelSelect.addEventListener("change", () => { if (active) return showWind({ reuse:true, index:selectedIndex }); sync(); });
    slider.addEventListener("input", () => { if (!isWorld()) return selectTime(Number(slider.value)); });
    slider.addEventListener("change", () => { if (isWorld()) return selectTime(Number(slider.value)); });
    previous.addEventListener("click", () => selectTime(selectedIndex - 1)); next.addEventListener("click", () => selectTime(selectedIndex + 1));
    current.addEventListener("click", () => { if (grid) selectTime(timeIndex(grid)); });
    map.on("movestart zoomstart", suspend); map.on("moveend zoomend resize", moved);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("mni18nchange", sync);
    // 앱 안에서 다른 문서로 전환했다 돌아온 경우에도 애니메이션을 다시 시작한다.
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) start(); else stop(); }); observer.observe(stage);
    sync();
    const controller = {
      inspectAt(at){
        if (!active || frozen || destroyed || !at || !Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return false;
        spot = { lat:at.lat, lng:at.lng }; panel.hidden = false; drawSpot(); sync(); return true;
      },
      freeze(){ frozen++; stop(); return () => { frozen = Math.max(0, frozen - 1); start(); }; },
      captureNote(){ if (active && isWorld()) return (colorCheck.checked && modeSelect.value === "temperature" ? word("기온·바람", "Temperature / wind") : word("바람", "Wind")) + " (1°) · " + timeLabel.textContent + " · NOAA GFS";
        return active ? (colorCheck.checked && modeSelect.value === "temperature" ? word("기온·바람(1.5° 보간) · ", "Temperature / wind (1.5° interpolation) · ")
        : word("바람(1.5° 보간) · ", "Wind (1.5° interpolation) · ")) + timeLabel.textContent + " · Open-Meteo / NOAA GFS · CC BY 4.0" : ""; },
      destroy(){
        if (destroyed) return; destroyed = true; generation++; stop(); observer.disconnect();
        if (attribution && map.attributionControl) map.attributionControl.removeAttribution(attribution);
        map.off("movestart zoomstart", suspend); map.off("moveend zoomend resize", moved);
        document.removeEventListener("visibilitychange", visibility); window.removeEventListener("mni18nchange", sync);
        field = []; seeds = []; particles = []; grid = null; active = false; spot = null; pane.remove(); panel.remove(); legend.remove(); toggle.remove();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => controller.destroy()); return controller;
  }
  return { mount, REGION, HOURS, coordinates, requestUrl, vector, parse, sample, color, timeIndex, validCache, fresh, load,
    parseWorldCatalog, parseWorldFrame, worldSample, worldFrame };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNWeatherWind;
