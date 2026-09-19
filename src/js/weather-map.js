"use strict";
/* 지도 '날씨' 패널(기상청 단기예보). 두 가지를 보인다.
   - 지도 가운데 날씨: 지금(실황) · 시간별 예보 · 모레까지 날짜별 최고·최저. 그 자리에 점 하나를 찍는다.
   - 전국 주요 도시: 도시마다 지금 하늘·기온을 지도 위 딱지로 펼친다(수업 첫머리 '오늘 전국 날씨').
   좌표는 기상청 격자(5km)로 바꿔 묻는다. 버스·항공 층처럼 .map 문서 모델에는 아무것도 쓰지 않는다
   (지금 이 순간의 값이라 파일에 담으면 낡는다). 캡처에는 딱지가 남고 출처·수신 시각은 captureNote 로 붙는다. */
const MNWeatherMap = (() => {
  // 전국 주요 도시 — 광역시·도청 소재지 무렵. 이름은 ASOS 지점 이름과 같게 두어 좌표를 그 표에서 가져온다.
  const CITIES = ["서울", "인천", "춘천", "강릉", "청주", "대전", "전주", "광주", "목포", "대구", "안동", "포항", "울산", "부산", "창원", "여수", "제주", "울릉도", "백령도"];
  function mount({ map, stage, toolRow, doc, t = value => value, movePanel = null }){
    const api = MNWeatherApi;
    const english = () => !!(window.MNI18N && window.MNI18N.lang === "en");
    const el = (tag, cls, label) => { const node = document.createElement(tag); if (cls) node.className = cls; if (label) node.textContent = t(label); return node; };
    const button = (label, cls = "") => { const node = el("button", "map-btn " + cls, label); node.type = "button"; return node; };

    const toggle = button("날씨", "map-toolvis-weather");
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "sunCloud");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-pressed", "false");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요."); toolRow.appendChild(toggle);

    const panel = el("section", "map-weather-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("날씨"));
    const heading = el("div", "map-weather-heading"), close = button("닫기");
    heading.append(el("strong", "", "날씨"), close);
    const tools = el("div", "map-weather-tools");
    const hereButton = button("지도 가운데 날씨", "map-weather-here"), citiesButton = button("전국 주요 도시", "map-weather-cities");
    const clearButton = button("지도에서 지우기"); clearButton.disabled = true;
    tools.append(hereButton, citiesButton, clearButton);
    const place = el("p", "map-weather-place");
    // 날씨 그림 글자(☀️ 등)는 icons.js 가 지우지 않게 ui-keep-symbols 안에 둔다.
    const nowBox = el("div", "map-weather-now ui-keep-symbols"); nowBox.hidden = true;
    const hours = el("div", "map-weather-hours ui-keep-symbols"); hours.hidden = true;
    const days = el("div", "map-weather-days ui-keep-symbols"); days.hidden = true;
    const status = el("p", "map-weather-status ui-keep-symbols"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "기상청 동네예보 격자(5km) 값이에요. 실황은 한 시간마다, 예보는 세 시간마다 새로 발표됩니다.");
    const source = el("a", "", "출처: 기상청(공공데이터포털)");
    source.href = "https://www.data.go.kr/data/15084084/openapi.do"; source.target = "_blank"; source.rel = "noopener noreferrer";
    panel.append(heading, tools, place, nowBox, hours, days, status, note, source);
    stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    if (typeof movePanel === "function") movePanel(panel, heading);

    const pane = map.createPane("mapWeatherPane"); pane.style.zIndex = "620";
    const layer = L.layerGroup();
    const capability = new AbortController();
    let destroyed = false, mode = "", generation = 0, abort = null, fetchedAt = 0, spot = null, forecast = null, current = null, cities = [];
    const setStatus = value => { if (status.textContent !== value) status.textContent = value; };
    const clock = stamp => new Date(stamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", hour12:false });
    const deg = v => v == null ? "–" : (Math.round(v * 10) / 10) + "°";

    // 날씨 그림(글자). 하늘보다 비·눈·낙뢰가 먼저다.
    function glyph({ sky = null, pty = null, lightning = false } = {}){
      if (lightning) return "⛈️";
      if (pty === 3 || pty === 7) return "🌨️";
      if (pty === 2 || pty === 6) return "🌨️";
      if (pty === 1 || pty === 4 || pty === 5) return "🌧️";
      if (sky === 1) return "☀️";
      if (sky === 3) return "⛅";
      if (sky === 4) return "☁️";
      return "·";
    }
    const describe = w => api.ptyName(w.pty, english()) || api.skyName(w.sky, english());
    // 한두 낱말은 사전에 넣지 않고 여기서 가른다(사전은 같은 글 조각을 화면 어디서나 바꾼다).
    const word = (ko, en) => english() ? en : ko;
    const hhmm = s => s.slice(0, 2) + ":" + s.slice(2, 4);
    const dayName = (ymd) => {
      const names = english() ? ["Today", "Tomorrow", "Day after"] : ["오늘", "내일", "모레"];
      const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const ahead = Math.round((d - today) / 86400000);
      return names[ahead] || (Number(ymd.slice(4, 6)) + "/" + Number(ymd.slice(6, 8)));
    };
    const failure = error => t(api.failureText(error, "forecast"));

    // ── 지도 ──
    function draw(){
      layer.clearLayers();
      if (!mode){ map.removeLayer(layer); return; }
      layer.addTo(map);
      const tag = (at, glyphText, label, tip, cls = "") => {
        const html = '<span class="map-weather-tag-glyph">' + glyphText + '</span><span class="map-weather-tag-text"></span>';
        const icon = L.divIcon({ className:"map-weather-tag ui-keep-symbols " + cls, html, iconSize:null, iconAnchor:[13, 12] });
        const marker = L.marker(at, { icon, pane:"mapWeatherPane", keyboard:false, bubblingMouseEvents:false });
        marker.on("add", () => { const node = marker.getElement(); if (node) node.querySelector(".map-weather-tag-text").textContent = label; });
        if (tip) marker.bindTooltip(tip, { direction:"top", offset:[0, -14] });
        layer.addLayer(marker);
        return marker;
      };
      if (mode === "here" && spot && current) tag(spot, glyph(current), deg(current.temp), [describe(current), place.textContent].filter(Boolean).join(" · "), "is-here");
      if (mode === "cities") for (const c of cities) if (c.now) tag([c.lat, c.lng], glyph(c.now), c.label + " " + deg(c.now.temp), describe(c.now));
    }

    // ── 패널 ──
    function renderHere(){
      nowBox.hidden = hours.hidden = days.hidden = mode !== "here";
      if (mode !== "here") return;
      nowBox.replaceChildren();
      if (current){
        const big = el("span", "map-weather-now-glyph"); big.textContent = glyph(current);
        const temp = el("strong", "map-weather-now-temp"); temp.textContent = deg(current.temp);
        const desc = el("span", "map-weather-now-desc"); desc.textContent = describe(current);
        const detail = el("span", "map-weather-now-detail");
        detail.textContent = [current.humidity != null ? word("습도", "Humidity") + " " + current.humidity + "%" : "",
          current.wind != null ? word("바람", "Wind") + " " + current.wind + "m/s" : "",
          current.rain1h != null && current.rain1h > 0 ? word("1시간 강수", "Rain (1h)") + " " + current.rain1h + "mm" : ""].filter(Boolean).join(" · ");
        nowBox.append(big, temp, desc, detail);
      } else nowBox.append(el("span", "map-weather-now-desc", "지금 날씨를 받지 못했어요."));
      // 시간별: 앞으로 24시간을 세 시간 간격으로(교실 화면에 한 줄로 들어가게).
      hours.replaceChildren();
      const list = forecast ? forecast.hours : [];
      const nowKey = (() => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + String(d.getHours()).padStart(2, "0") + "00"; })();
      const upcoming = list.filter(h => h.date + h.time >= nowKey).filter((h, i) => i % 3 === 0).slice(0, 8);
      for (const h of upcoming){
        const cell = el("div", "map-weather-hour");
        const time = el("span", "map-weather-hour-time"); time.textContent = hhmm(h.time);
        const g = el("span", "map-weather-hour-glyph"); g.textContent = glyph(h); g.title = describe(h);
        const temp = el("strong", "map-weather-hour-temp"); temp.textContent = deg(h.temp);
        const pop = el("span", "map-weather-hour-pop"); pop.textContent = h.pop != null ? h.pop + "%" : "";
        pop.title = word("강수확률", "Chance of rain");
        cell.append(time, g, temp, pop);
        hours.append(cell);
      }
      hours.hidden = !upcoming.length;
      days.replaceChildren();
      const dayList = forecast ? forecast.days.slice(0, 3) : [];
      dayList.forEach(d => {
        const card = el("div", "map-weather-day");
        const name = el("span", "map-weather-day-name"); name.textContent = dayName(d.date);
        const g = el("span", "map-weather-day-glyph"); g.textContent = glyph(d); g.title = describe(d);
        const range = el("span", "map-weather-day-range");
        range.textContent = (d.max != null || d.min != null) ? deg(d.max) + " / " + deg(d.min) : "";
        const pop = el("span", "map-weather-day-pop"); pop.textContent = d.popMax != null ? word("강수", "Rain") + " " + d.popMax + "%" : "";
        card.append(name, g, range, pop);
        days.append(card);
      });
      days.hidden = !dayList.length;
    }
    function render(){
      draw();
      renderHere();
      clearButton.disabled = !mode;
      toggle.classList.toggle("is-on", !!mode); toggle.setAttribute("aria-pressed", String(!!mode));
    }

    // ── 조회 ──
    function cancel(){ generation++; if (abort) abort.abort(); abort = null; hereButton.disabled = citiesButton.disabled = false; }
    async function loadHere(){
      cancel();
      const seq = generation, controller = new AbortController(); abort = controller;
      hereButton.disabled = true;
      const center = map.getCenter();
      const near = api.nearestStation(center.lat, center.lng);
      const g = api.toGrid(center.lat, center.lng);
      setStatus(t("기상청 날씨를 받는 중…"));
      try {
        // 실황이 안 와도 예보는 보이고, 예보가 안 와도 실황은 보인다. 둘 다 안 오면 까닭을 알린다.
        const [nowResult, fcResult] = await Promise.allSettled([
          api.loadNow(center.lat, center.lng, { signal:controller.signal }),
          api.loadForecast(center.lat, center.lng, { signal:controller.signal })
        ]);
        if (destroyed || seq !== generation) return;
        if (nowResult.status === "rejected" && fcResult.status === "rejected") throw nowResult.reason;
        mode = "here"; spot = [center.lat, center.lng];
        current = nowResult.status === "fulfilled" ? nowResult.value : null;
        forecast = fcResult.status === "fulfilled" ? fcResult.value : null;
        fetchedAt = (current && current.fetchedAt) || (forecast && forecast.fetchedAt) || Date.now();
        place.textContent = word("지도 가운데", "Map center") + (near ? " · " + word("가까운 곳", "near") + " " + near.name : "") + " · " + word("격자", "grid") + " " + g.nx + "," + g.ny;
        render();
        setStatus(t("수신") + " " + clock(fetchedAt));
      } catch(error){
        if (controller.signal.aborted || seq !== generation) return;
        setStatus(failure(error));
      } finally {
        if (seq === generation){ hereButton.disabled = false; abort = null; }
      }
    }
    async function loadCities(){
      cancel();
      const seq = generation, controller = new AbortController(); abort = controller;
      citiesButton.disabled = true;
      const list = CITIES.map(name => api.STATIONS.find(s => s.name === name)).filter(Boolean)
        .map(s => ({ name:s.name, label:s.name, lat:s.lat, lng:s.lng, now:null }));
      let done = 0, lastError = null;
      setStatus(t("전국 주요 도시 날씨를 받는 중…") + " 0/" + list.length);
      // 한 번에 셋씩 묻는다(런처가 10분 캐시를 두므로 다시 눌러도 헛걸음이 적다).
      const queue = list.slice();
      const worker = async () => {
        while (queue.length){
          const city = queue.shift();
          try { city.now = await api.loadNow(city.lat, city.lng, { signal:controller.signal }); }
          catch(error){ if (controller.signal.aborted) return; lastError = error; if (/^bus-key|^bus-quota/.test(error.message)) queue.length = 0; }
          done++;
          if (seq === generation) setStatus(t("전국 주요 도시 날씨를 받는 중…") + " " + done + "/" + list.length);
        }
      };
      try {
        await Promise.all([worker(), worker(), worker()]);
        if (destroyed || seq !== generation) return;
        const got = list.filter(c => c.now);
        if (!got.length){ setStatus(failure(lastError)); return; }
        mode = "cities"; cities = list; current = null; forecast = null; spot = null;
        fetchedAt = Math.max(...got.map(c => c.now.fetchedAt || 0)) || Date.now();
        place.textContent = t("전국 주요 도시") + " " + got.length + (english() ? "" : "곳");
        render();
        const b = L.latLngBounds(got.map(c => [c.lat, c.lng]));
        map.fitBounds(b, { padding:[40, 40], maxZoom:8 });
        setStatus(t("수신") + " " + clock(fetchedAt) + (got.length < list.length ? " · " + t("일부 도시는 받지 못했어요.") : ""));
      } finally {
        if (seq === generation){ citiesButton.disabled = false; abort = null; }
      }
    }
    function clearAll(){
      cancel(); mode = ""; current = null; forecast = null; cities = []; spot = null; place.textContent = "";
      render(); setStatus(t("날씨 표시를 지웠어요."));
    }

    hereButton.addEventListener("click", loadHere);
    citiesButton.addEventListener("click", loadCities);
    clearButton.addEventListener("click", clearAll);
    // 켜진 채로 도구 단추를 누르면 지우고 닫는다(버스·항공 단추와 같은 규칙).
    toggle.addEventListener("click", () => {
      if (mode){ clearAll(); panel.hidden = true; }
      else panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) hereButton.focus();
    });
    close.addEventListener("click", () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const onLang = () => { if (mode) render(); };
    window.addEventListener("mni18nchange", onLang);

    fetch("/can-proxy-weather", { cache:"no-store", signal:capability.signal }).then(r => r.ok ? r.text() : "").then(value => {
      if (destroyed || value.trim() !== "yes") return;
      toggle.disabled = false; toggle.title = t("기상청 날씨(지금·예보)를 지도에서 봅니다.");
    }).catch(() => {});

    const controller = {
      freeze(){ return () => {}; },
      captureNote(){
        if (!mode) return "";
        return [t("날씨"), place.textContent, t("수신") + " " + new Date(fetchedAt).toLocaleString(), word("기상청", "KMA")].filter(Boolean).join(" · ");
      },
      destroy(){
        destroyed = true; cancel(); capability.abort(); window.removeEventListener("mni18nchange", onLang);
        layer.clearLayers(); map.removeLayer(layer); panel.remove(); toggle.remove(); pane.remove();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => controller.destroy());
    return controller;
  }
  return { mount, CITIES };
})();
