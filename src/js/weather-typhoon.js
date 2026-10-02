"use strict";
/* 지도 '바람' 창의 기상청 태풍 층(MNTyphoonLayer). 해석은 MNWeatherApi.parseTyphoons, 조회는 런처 /weather-typhoon.
   공식 통보문 기준이라 모델 바람 그림과 달리 이름·중심기압·최대풍속과 지나온 길이 정확하다.
   그리는 것: 지나온 길(통보 위치를 이은 실선) · 지금 위치 표지와 이름표 · 강풍(15 m/s)·폭풍(25 m/s) 반경 원 ·
   진로 예보(지금 위치에서 예상 위치들을 잇는 점선, 예상 시각 이름표, 70% 확률 반경 원).
   진로 예보는 가장 늦은 통보의 것을 태풍마다 따로 받는다(/weather-typhoon-fcst). 받지 못해도 지나온 길은 그린다.
   이름표는 말풍선(tooltip)이 아니라 표지 안에 둔다 — 지도 그림 저장이 말풍선 층을 숨기기 때문이다.
   .map 문서에는 아무것도 쓰지 않는다. */
const MNTyphoonLayer = (() => {
  const SYMBOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">'
    + '<circle cx="12" cy="12" r="3.4"/><path d="M12 8.6C12 4.2 15.2 2.6 19 3.1M12 15.4c0 4.4-3.2 6-7 5.5"/></svg>';
  function mount({ map, host, word = (ko, en) => ko, onChange = () => {}, api = typeof MNWeatherApi !== "undefined" ? MNWeatherApi : null }){
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const label = el("label", "map-wind-color-label map-typhoon-toggle"), check = el("input", "map-typhoon-check"), checkText = el("span");
    check.type = "checkbox"; label.append(check, checkText);
    const status = el("p", "map-typhoon-status"); status.setAttribute("aria-live", "polite");
    const list = el("div", "map-typhoon-list");
    host.append(label, status, list);
    const pane = map.createPane("mapTyphoonPane"); pane.style.zIndex = "630"; pane.style.pointerEvents = "none";
    let layer = null, typhoons = [], fetchedAt = 0, loading = false, errorText = "", generation = 0, destroyed = false, fitted = false;
    // 진로 예보: "번호-발표시각" → 예상 위치 목록. 같은 통보의 예보는 바뀌지 않으므로 다시 받지 않는다.
    let forecasts = new Map(), forecastFailed = false;
    const forecastKey = t => t.seq + "-" + t.latest.bulletin;
    const forecastOf = t => forecasts.get(forecastKey(t)) || [];
    const stamp = time => new Date(time).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }) + " KST";
    const english = () => word(false, true);
    // 기상청은 방향을 NW 같은 16방위 약자로 준다. 한국어 화면에서는 '북서'로 읽는다.
    const COMPASS = "N,NNE,NE,ENE,E,ESE,SE,SSE,S,SSW,SW,WSW,W,WNW,NW,NNW".split(",");
    const KOREAN_COMPASS = "북,북북동,북동,동북동,동,동남동,남동,남남동,남,남남서,남서,서남서,서,서북서,북서,북북서".split(",");
    const directionName = d => { const i = COMPASS.indexOf(d); return i < 0 || english() ? d : KOREAN_COMPASS[i]; };
    // 지도 이름표용 짧은 예상 시각(한국 시각): "3일 03시" / "3 03:00".
    const shortTime = time => { const d = new Date(time + 9 * 3600000), day = d.getUTCDate(), hour = String(d.getUTCHours()).padStart(2, "0");
      return word(day + "일 " + hour + "시", day + " " + hour + ":00"); };
    const radiusText = (km, other) => km + " km" + (other ? word(" (" + directionName(other.direction) + "쪽 " + other.km + " km)", " (" + other.km + " km to the " + other.direction + ")") : "");
    const current = () => typhoons.filter(t => !t.ended);
    const titleOf = t => word("제" + t.seq + "호 태풍 " + (t.name || ""), "Typhoon No. " + t.seq + " " + (t.nameEn || t.name || "")).trim();
    const shortOf = t => word("제" + t.seq + "호 " + (t.name || ""), t.nameEn || t.name || "No. " + t.seq).trim();
    function boundsOf(group){
      const points = [];
      for (const t of group){
        for (const f of t.fixes) points.push([f.lat, f.lng]);
        for (const p of forecastOf(t)) points.push([p.lat, p.lng]);
        // 강풍 반경까지 화면에 들어오게 위도 1° ≈ 111 km 로 넉넉히 넓힌다.
        const r = (t.latest.gale || 0) / 111, f = t.latest;
        if (r) points.push([f.lat - r, f.lng - r], [f.lat + r, f.lng + r]);
      }
      return points;
    }
    function fit(group){
      const points = boundsOf(group);
      if (points.length) map.fitBounds(points, { padding:[40, 40], maxZoom:6, animate:false });
    }
    function draw(){
      if (layer){ layer.remove(); layer = null; }
      if (!check.checked) return;
      layer = L.layerGroup();
      const base = { pane:"mapTyphoonPane", interactive:false };
      for (const t of current()){
        const f = t.latest, track = t.fixes.map(p => [p.lat, p.lng]);
        if (f.gale) L.circle([f.lat, f.lng], { ...base, radius:f.gale * 1000, color:"#f59e0b", weight:1.5, fillColor:"#f59e0b", fillOpacity:.08 }).addTo(layer);
        if (f.storm) L.circle([f.lat, f.lng], { ...base, radius:f.storm * 1000, color:"#d9363e", weight:1.5, fillColor:"#d9363e", fillOpacity:.14 }).addTo(layer);
        if (track.length > 1) L.polyline(track, { ...base, color:"#d9363e", weight:3, opacity:.9 }).addTo(layer);
        const plan = forecastOf(t);
        if (plan.length){
          // 확률 반경 원을 먼저(아래에) 깔고, 그 위에 점선 진로·예상 위치 점·시각 이름표를 얹는다.
          for (const p of plan) if (p.probability) L.circle([p.lat, p.lng], { ...base, radius:p.probability * 1000, color:"#d9363e", weight:1, opacity:.55, dashArray:"3 5", fillColor:"#d9363e", fillOpacity:.04 }).addTo(layer);
          L.polyline([[f.lat, f.lng], ...plan.map(p => [p.lat, p.lng])], { ...base, color:"#d9363e", weight:2.5, opacity:.95, dashArray:"8 7" }).addTo(layer);
          for (const p of plan){
            L.circleMarker([p.lat, p.lng], { ...base, radius:4, color:"#d9363e", weight:2, fillColor:"#fff", fillOpacity:1 }).addTo(layer);
            const when = el("span", "map-typhoon-time", shortTime(p.at));
            L.marker([p.lat, p.lng], { ...base, keyboard:false, icon:L.divIcon({ className:"map-typhoon-time-icon", html:when, iconSize:[8, 8], iconAnchor:[4, 4] }) }).addTo(layer);
          }
        }
        for (const p of t.fixes.slice(0, -1)) L.circleMarker([p.lat, p.lng], { ...base, radius:3, color:"#d9363e", weight:2, fillColor:"#fff", fillOpacity:1 }).addTo(layer);
        const mark = el("span", "map-typhoon-mark"); mark.innerHTML = SYMBOL; mark.setAttribute("aria-hidden", "true");
        const tag = el("span", "map-typhoon-label", shortOf(t) + (f.pressure ? " · " + f.pressure + " hPa" : ""));
        const icon = el("span", "map-typhoon-pin"); icon.append(mark, tag);
        L.marker([f.lat, f.lng], { ...base, keyboard:false, icon:L.divIcon({ className:"map-typhoon-icon", html:icon, iconSize:[28, 28], iconAnchor:[14, 14] }) }).addTo(layer);
      }
      layer.addTo(map);
    }
    function renderList(){
      list.replaceChildren();
      for (const t of current()){
        const f = t.latest, item = el("div", "map-typhoon-item");
        const name = el("strong", "", titleOf(t) + (t.nameEn && !english() ? " (" + t.nameEn + ")" : ""));
        const lines = [
          stamp(f.at) + " · " + Math.abs(f.lat).toFixed(1) + "°" + (f.lat >= 0 ? "N" : "S") + " " + f.lng.toFixed(1) + "°E",
          [f.pressure ? word("중심기압 ", "Central pressure ") + f.pressure + " hPa" : "", f.wind ? word("최대풍속 ", "Max wind ") + f.wind + " m/s" : "",
            f.direction || f.speed ? word("이동 ", "Moving ") + [directionName(f.direction), f.speed !== null ? f.speed + " km/h" : ""].filter(Boolean).join(" ") : ""].filter(Boolean).join(" · "),
          f.place,
          [f.gale ? word("강풍(15 m/s) 반경 ", "Gale (15 m/s) radius ") + radiusText(f.gale, f.galeException) : "",
            f.storm ? word("폭풍(25 m/s) 반경 ", "Storm (25 m/s) radius ") + radiusText(f.storm, f.stormException) : ""].filter(Boolean).join(" · ")
        ].filter(Boolean);
        item.append(name, ...lines.map(line => el("p", "", line)));
        const plan = forecastOf(t);
        if (plan.length){
          // 예상 진로는 접어 두고 펼치면 시각별로 본다(일곱 줄이라 창이 길어지지 않게).
          const box = el("details", "map-typhoon-plan"), summary = el("summary", "", word("예상 진로 " + plan.length + "곳 · 70% 확률 반경 포함", "Forecast track · " + plan.length + " points with 70% probability radius"));
          box.append(summary, ...plan.map(p => el("p", "", [stamp(p.at), Math.abs(p.lat).toFixed(1) + "°" + (p.lat >= 0 ? "N" : "S") + " " + p.lng.toFixed(1) + "°E",
            p.pressure ? p.pressure + " hPa" : "", p.wind ? p.wind + " m/s" : "", p.probability ? word("확률 반경 ", "70% radius ") + p.probability + " km" : ""].filter(Boolean).join(" · "))));
          item.append(box);
        }
        // 비고(다음 발표 예정 시각 등)는 기상청 문장 그대로 작게 붙인다.
        for (const remark of f.remarks || []) item.append(el("small", "map-typhoon-remark", remark));
        const tools = el("div", "map-weather-tools"), go = el("button", "map-btn map-typhoon-go", word("지도에서 보기", "Show on map"));
        go.type = "button"; go.addEventListener("click", () => fit([t])); tools.append(go);
        if (t.image){
          const link = el("a", "map-typhoon-image", word("기상청 진로 예보도", "KMA forecast track"));
          link.href = t.image; link.target = "_blank"; link.rel = "noopener noreferrer"; tools.append(link);
        }
        item.append(tools); list.append(item);
      }
    }
    function sync(){
      checkText.textContent = word("기상청 태풍 정보", "KMA typhoon information");
      list.hidden = !check.checked;
      if (!check.checked) status.textContent = word("공식 통보문의 위치·중심기압·최대풍속과 지나온 길을 표시합니다. EXE·공공데이터포털 인증키가 필요합니다.",
        "Shows official KMA positions, pressure, winds and tracks. Requires the EXE and a data.go.kr key.");
      else if (loading) status.textContent = word("태풍 정보를 받는 중…", "Loading typhoon information…");
      else if (errorText) status.textContent = errorText;
      else if (!current().length) status.textContent = word("지금 진행 중인 태풍이 없습니다(최근 사흘 기상청 통보 기준). · 수신 ", "No active typhoon in KMA bulletins from the last three days. · Fetched ") + stamp(fetchedAt);
      else status.textContent = word("기상청 통보 · 수신 ", "KMA bulletins · Fetched ") + stamp(fetchedAt)
        + (forecastFailed ? word(" · 진로 예보를 받지 못해 지나온 길만 그렸습니다.", " · Forecast track unavailable; showing past track only.")
          : current().some(t => forecastOf(t).length) ? word(" · 점선은 진로 예보", " · Dashed line: forecast track") : "");
      renderList(); onChange();
    }
    async function refresh({ fitOnLoad = false } = {}){
      if (!check.checked || destroyed || !api) return;
      const seq = ++generation; loading = true; errorText = ""; sync();
      try {
        if (!(await api.available())) throw new Error("typhoon-desktop");
        const result = await api.loadTyphoons();
        if (destroyed || seq !== generation || !check.checked) return;
        typhoons = result.typhoons; fetchedAt = result.fetchedAt;
        draw();
        // 진로 예보는 지나온 길을 먼저 그린 뒤 태풍마다 받는다. 없던 통보의 것만 묻는다.
        const wanted = new Map(current().filter(t => t.latest.bulletin).map(t => [forecastKey(t), t]));
        for (const key of [...forecasts.keys()]) if (!wanted.has(key)) forecasts.delete(key);
        forecastFailed = false;
        for (const [key, t] of wanted){
          if (forecasts.has(key)) continue;
          try { const plan = await api.loadTyphoonForecast(t.seq, t.latest.bulletin); if (destroyed || seq !== generation) return; forecasts.set(key, plan); }
          catch(error){ if (destroyed || seq !== generation) return; forecastFailed = true; }
        }
        if (!check.checked) return;
        draw();
        if (fitOnLoad && !fitted && current().length){ fitted = true; fit(current()); }
      } catch(error){
        if (destroyed || seq !== generation) return;
        // 받지 못해도 앞서 그린 태풍은 그대로 둔다(바람 층과 같은 규칙).
        errorText = error && error.message === "typhoon-desktop"
          ? word("태풍 정보는 Windows ClassDock.exe에서 공공데이터포털 인증키로 볼 수 있습니다.", "Typhoon information requires the Windows ClassDock.exe and a data.go.kr key.")
          : api.failureText(error, "typhoon");
      } finally { if (!destroyed && seq === generation){ loading = false; sync(); } }
    }
    function clear(){
      generation++; loading = false; errorText = ""; typhoons = []; fitted = false; check.checked = false; forecasts = new Map(); forecastFailed = false;
      if (layer){ layer.remove(); layer = null; } sync();
    }
    check.addEventListener("change", () => { if (check.checked) refresh({ fitOnLoad:true }); else clear(); });
    if (!api) host.hidden = true;
    sync();
    return {
      refresh, clear, sync,
      shown:() => check.checked,
      captureNote:() => check.checked && current().length ? word("태풍 · 기상청 통보 ", "Typhoons · KMA ") + stamp(fetchedAt)
        + (current().some(t => forecastOf(t).length) ? word("(점선: 진로 예보)", " (dashed: forecast)") : "") : "",
      destroy(){ if (destroyed) return; destroyed = true; generation++; if (layer) layer.remove(); layer = null; pane.remove(); }
    };
  }
  return { mount };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNTyphoonLayer;
