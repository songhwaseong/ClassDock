"use strict";
/* 서울시 실시간 돌발정보(서울 열린데이터광장 AccInfo). 공사·사고·행사 통제 지점을 지도에 겹친다.
   키는 런처에만 두고(서울 '일반 인증키' — 지하철 실시간 키와 다르다), 런처가 XML 을 그대로 넘긴다.
   좌표는 grs80tm_x/y 로 오며 중부원점 TM(EPSG:5181)이다 — 봉은교 공사 지점으로 맞춰 봤다.
   유형 이름은 같은 키의 코드표(AccMainCode·AccSubCode)에서 받고, 못 받으면 확인한 다섯 가지만 내장으로 쓴다.
   실시간 층이라 .map 문서에 저장하지 않는다. */
const MNRoadIncidents = (() => {
  const CODE_CACHE_KEY = "mn.roadIncidents.codes.v1", CODE_TTL = 7 * 86400000, REFRESH_MS = 300000, MAX_PAGES = 5;
  const SOURCE = "https://data.seoul.go.kr/";
  const CATEGORIES = {
    work:{ label:"공사", color:"#d97706" },
    accident:{ label:"사고·고장", color:"#dc2626" },
    event:{ label:"행사·집회", color:"#7c3aed" },
    hazard:{ label:"기상·재난", color:"#0284c7" },
    other:{ label:"기타", color:"#64748b" }
  };
  // 표본 키로 확인한 유형 코드. 나머지는 코드표가 알려 준다.
  const KNOWN_TYPES = { A01:"교통사고", A02:"차량고장", A03:"보행사고", A04:"공사", A05:"낙하물" };
  const text = value => value == null ? "" : String(value).trim();
  const ENTITIES = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'" };
  function decode(value){
    return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (whole, dec, hex, name) => {
        if (name) return ENTITIES[name.toLowerCase()];
        const code = dec ? Number(dec) : parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      });
  }
  /* 응답은 <서비스이름><list_total_count/><RESULT><CODE/></RESULT><row>…</row>… 의 평평한 모양이다.
     브라우저 밖(단위 시험)에서도 같은 결과가 나오게 DOMParser 대신 이 모양만 읽는다. */
  function parse(xml){
    const source = String(xml || "");
    const code = (source.match(/<CODE>\s*([A-Z]+-\d+)\s*<\/CODE>/) || [])[1] || "";
    if (code === "INFO-200") return { rows:[], total:0 };
    if (code !== "INFO-000") throw new Error(code === "INFO-100" ? "seoul-key-invalid" : "incidents-invalid-data");
    const total = Number((source.match(/<list_total_count>\s*(\d+)\s*<\/list_total_count>/) || [])[1]) || 0;
    const rows = [];
    for (const [, body] of source.matchAll(/<row>([\s\S]*?)<\/row>/g)){
      const row = {};
      for (const [, name, value] of body.matchAll(/<([A-Za-z_][\w]*)>([\s\S]*?)<\/\1>/g)) row[name.toLowerCase()] = decode(value).trim();
      rows.push(row);
    }
    return { rows, total };
  }
  // "20260407"+"1000" 또는 "20270301"+"000000" → "2026-04-07 10:00". 달력에 없는 날은 버린다.
  function stamp(date, time){
    const d = text(date), t = text(time).padStart(4, "0");
    if (!/^\d{8}$/.test(d) || !/^\d{4}(\d{2})?$/.test(t)) return "";
    const iso = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8), hour = Number(t.slice(0, 2)), minute = Number(t.slice(2, 4));
    const day = Date.parse(iso + "T00:00:00Z");
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== iso || hour > 24 || minute > 59) return "";
    return iso + " " + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  }
  const instant = value => value ? Date.parse(value.replace(" ", "T").replace(/T24:00$/, "T23:59") + ":00+09:00") : NaN;
  /* 본문은 보통 "제목\r-일시 : …\r-장소 : …\r-통제 : …" 꼴이다. 제목과 항목을 갈라 두되,
     꼴이 다르면 전체를 한 덩어리로 보여 준다(뜻을 추측해 지우지 않는다). */
  function describe(info){
    const lines = text(info).split(/[\r\n]+/).map(s => s.trim()).filter(Boolean), fields = [];
    let title = "";
    for (const line of lines){
      const field = line.match(/^[-·•*]\s*([^:：]{1,12}?)\s*[:：]\s*(.+)$/);
      if (field) fields.push([field[1].trim(), field[2].trim()]);
      else if (!title) title = line.replace(/^[-·•*]\s*/, "");
      else fields.push(["", line.replace(/^[-·•*]\s*/, "")]);
    }
    const pick = name => (fields.find(([key]) => key.replace(/\s/g, "") === name) || [])[1] || "";
    return { title, fields, place:pick("장소"), control:pick("통제"), lines };
  }
  function category(type, names, info){
    if (type === "A04") return "work";
    const s = names + " " + info;
    if (/공사|작업|보수|정비|포장|굴착/.test(names)) return "work";
    if (/사고|고장|낙하물|화재|전복|추돌|충돌/.test(names)) return "accident";
    if (/행사|집회|시위|축제|마라톤|행진|대회|퍼레이드/.test(s)) return "event";
    if (/기상|재난|침수|결빙|폭설|강풍|안개|낙석|붕괴|싱크홀|땅꺼짐|통제\(기상/.test(s)) return "hazard";
    if (/공사|작업/.test(info)) return "work";
    return "other";
  }
  const fullClosure = value => /전면\s*(통제|차단)|양방향\s*(전면\s*)?통제|전\s*차로\s*(통제|차단)|진입\s*금지/.test(value);
  function normalize(rows, codes = {}, coords = typeof MNKoreaCoords !== "undefined" ? MNKoreaCoords : null){
    const byId = new Map(); let unlocated = 0;
    for (const row of rows){
      const id = text(row.acc_id); if (!id) continue;
      const type = text(row.acc_type), dtype = text(row.acc_dtype);
      const typeName = (codes.main && codes.main[type]) || KNOWN_TYPES[type] || "", dtypeName = (codes.sub && codes.sub[dtype]) || "";
      const info = text(row.acc_info), x = Number(row.grs80tm_x), y = Number(row.grs80tm_y);
      let position = null;
      if (text(row.grs80tm_x) && text(row.grs80tm_y) && Number.isFinite(x) && Number.isFinite(y) && coords){
        const p = coords.toWgs84("5181", x, y);
        if (p && p[0] >= 37.2 && p[0] <= 37.9 && p[1] >= 126.6 && p[1] <= 127.4) position = p;   // 서울과 맞닿은 도로까지
      }
      if (!position){ unlocated++; continue; }
      const detail = describe(info);
      byId.set(id, { id, type, dtype, typeName, dtypeName, info, ...detail,
        category:category(type, typeName + " " + dtypeName, info), full:fullClosure(detail.control || info),
        start:stamp(row.occr_date, row.occr_time), end:stamp(row.exp_clr_date, row.exp_clr_time),
        road:text(row.acc_road_code), link:text(row.link_id), lat:position[0], lng:position[1] });
    }
    return { incidents:[...byId.values()], unlocated };
  }
  // 진행 중(0) · 예정(1) · 해제 예정 시각 지남(2)
  function phase(incident, now = Date.now()){
    const start = instant(incident.start), end = instant(incident.end);
    if (Number.isFinite(start) && start > now) return 1;
    if (Number.isFinite(end) && end < now) return 2;
    return 0;
  }
  async function get(kind, page, { signal, refresh = false } = {}){
    if (signal) signal.throwIfAborted();
    const response = await fetch("/road-incidents?kind=" + kind + "&page=" + page + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
    if (!response.ok){ const reason = text(await response.text()); throw new Error(/^seoul-[a-z-]+$/.test(reason) ? reason : "incidents-fetch-failed"); }
    const result = parse(await response.text()); if (signal) signal.throwIfAborted();
    const at = Date.parse(response.headers && response.headers.get("X-ClassDock-Fetched-At") || "");
    return { ...result, fetchedAt:Number.isFinite(at) ? Math.min(Date.now(), at) : Date.now(), stale:!!(response.headers && response.headers.get("X-ClassDock-Stale") === "1") };
  }
  function readCodes(now = Date.now()){
    try {
      const cache = JSON.parse(localStorage.getItem(CODE_CACHE_KEY) || "null");
      if (!cache || !Number.isFinite(cache.at) || cache.at > now || now - cache.at >= CODE_TTL) return null;
      const clean = map => Object.fromEntries(Object.entries(map || {}).filter(([k, v]) => /^[0-9A-Z]{2,8}$/.test(k) && typeof v === "string" && v.length <= 40));
      const codes = { main:clean(cache.main), sub:clean(cache.sub) };
      return Object.keys(codes.main).length ? codes : null;
    } catch(_){ return null; }
  }
  let codeMemo = null;
  // 코드표를 못 받아도 돌발 목록은 보여 준다(유형 이름만 내장값이나 코드로 남는다).
  async function loadCodes(options = {}){
    if (codeMemo) return codeMemo;
    const cached = readCodes(); if (cached) return (codeMemo = cached);
    try {
      const [main, sub] = await Promise.all([get("main", 1, options), get("sub", 1, options)]);
      const table = (rows, key, name) => Object.fromEntries(rows.map(r => [text(r[key]), text(r[name])]).filter(([k, v]) => k && v));
      codeMemo = { main:table(main.rows, "acc_type", "acc_type_nm"), sub:table(sub.rows, "acc_dtype", "acc_dtype_nm") };
      if (Object.keys(codeMemo.main).length) try { localStorage.setItem(CODE_CACHE_KEY, JSON.stringify({ at:Date.now(), ...codeMemo })); } catch(_){}
      return codeMemo;
    } catch(error){
      if (options.signal && options.signal.aborted) throw error;
      if (error.message === "seoul-key-required" || error.message === "seoul-key-invalid") throw error;
      return { main:{}, sub:{} };
    }
  }
  async function load(options = {}){
    const codes = await loadCodes({ signal:options.signal });
    const rows = []; let total = Infinity, fetchedAt = Infinity, stale = false;
    for (let page = 1; page <= MAX_PAGES && rows.length < total; page++){
      const result = await get("info", page, options);
      total = result.total; fetchedAt = Math.min(fetchedAt, result.fetchedAt); stale = stale || result.stale; rows.push(...result.rows);
      if (!result.rows.length) break;
    }
    if (!Number.isFinite(fetchedAt)) fetchedAt = Date.now();
    return { ...normalize(rows, codes, options.coords), total:Number.isFinite(total) ? total : rows.length, fetchedAt, stale, complete:rows.length >= total };
  }
  function failureText(error){
    if (error.message === "seoul-key-required") return "설정 → 연결의 '서울 열린데이터(일반)'에 일반 인증키를 넣어 주세요.";
    if (error.message === "seoul-key-invalid") return "서울 열린데이터광장 일반 인증키를 확인해 주세요. 지하철 실시간 키로는 조회할 수 없어요.";
    return "돌발정보를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  function mount({ map, stage, toolRow, doc, t = v => v, movePanel = null }){
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const literal = n => { n.setAttribute("data-i18n-ignore", ""); n.setAttribute("lang", "ko"); return n; };
    const toggle = button("돌발·통제", "map-toolvis-road-incidents"); toolRow.append(toggle);
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "roadIncidents");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-pressed", "false");
    const panel = el("section", "map-weather-panel map-incident-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("서울 돌발·통제"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "서울 돌발·통제"), close);
    const types = el("div", "map-zone-types map-incident-types"), checks = new Map(), counts = new Map();
    for (const [id, spec] of Object.entries(CATEGORIES)){
      const label = el("label", "map-zone-type"), check = el("input"), swatch = el("i"), count = el("span", "map-incident-count");
      check.type = "checkbox"; check.checked = true; check.value = id;
      swatch.style.background = spec.color; swatch.setAttribute("aria-hidden", "true");
      label.append(check, swatch, el("span", "", spec.label), count); types.append(label); checks.set(id, check); counts.set(id, count);
    }
    const upcomingLabel = el("label", "map-zone-type map-incident-upcoming"), upcoming = el("input"); upcoming.type = "checkbox"; upcoming.checked = true;
    upcomingLabel.append(upcoming, el("span", "", "예정된 통제도 보기")); types.append(upcomingLabel);
    const tools = el("div", "map-weather-tools"), refresh = button("자료 갱신", "map-incident-refresh"), fit = button("서울 전체 보기", "map-incident-fit"), clear = button("지도에서 지우기", "map-incident-clear");
    tools.append(refresh, fit, clear);
    const summary = el("p", "map-zone-summary map-incident-summary"), status = el("p", "map-weather-status map-incident-status"), list = el("ol", "map-zone-list map-incident-list");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "서울시가 등록한 공사·사고·행사 통제 지점입니다. 굵은 테두리는 전면 통제입니다. 실제 현장 상황과 다를 수 있으니 안내 표지를 따라 주세요. 켜 두면 5분마다 새로 받습니다.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 서울 열린데이터광장 실시간 돌발정보");
    source.href = SOURCE; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, types, tools, summary, status, list, note, foot); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel); if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapRoadIncidentsPane"); pane.style.zIndex = "615"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapRoadIncidentsPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController(), markers = new Map();
    let data = null, shown = false, destroyed = false, abort = null, generation = 0, listTimer = 0;
    const phaseText = p => p === 1 ? t("예정") : p === 2 ? t("해제 예정 시각 지남") : t("진행 중");
    const selected = () => data ? data.incidents.filter(i => checks.get(i.category).checked && (upcoming.checked || phase(i) !== 1)) : [];
    const distance = i => map.getCenter().distanceTo([i.lat, i.lng]);
    const when = i => (i.start || "?") + " ~ " + (i.end || t("해제 시각 미정"));
    function controls(){
      toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown)); toggle.setAttribute("aria-expanded", String(!panel.hidden));
      refresh.disabled = !!abort; fit.disabled = clear.disabled = !shown;
    }
    function card(i, popup = false){
      const spec = CATEGORIES[i.category], box = el("div", "map-zone-card map-incident-card" + (i.full ? " is-full" : ""));
      box.style.setProperty("--zone-color", spec.color);
      const name = literal(el("strong")); name.textContent = i.title || i.dtypeName || i.typeName || t("돌발 상황"); box.append(name);
      const badges = el("div", "map-incident-badges"); badges.append(el("span", "map-zone-badge", spec.label));
      const kind = literal(el("span", "map-incident-kind")); kind.textContent = [i.typeName || i.type, i.dtypeName].filter(Boolean).join(" · "); if (kind.textContent) badges.append(kind);
      if (i.full) badges.append(el("span", "map-incident-full", "전면 통제"));
      const p = phase(i); if (p) badges.append(el("span", "map-incident-phase", p === 1 ? "예정" : "해제 예정 시각 지남"));
      box.append(badges);
      if (popup){
        const rows = i.fields.length ? i.fields : i.lines.slice(1).map(line => ["", line]);
        for (const [key, value] of rows){
          const row = el("p"), content = literal(el("span"));
          if (key){ const k = literal(el("span", "map-zone-key")); k.textContent = key + ": "; row.append(k); }
          content.textContent = value; row.append(content); box.append(row);
        }
        const time = el("p"), k = el("span", "map-zone-key", "통제 기간"), v = el("span"); k.textContent += ": "; v.textContent = when(i); time.append(k, v); box.append(time);
      } else {
        for (const [label, value] of [["장소", i.place], ["통제", i.control]]){
          if (!value) continue; const row = el("p"), k = el("span", "map-zone-key", label), v = literal(el("span")); k.textContent += ": "; v.textContent = value; row.append(k, v); box.append(row);
        }
        const until = el("p", "map-incident-until"); until.textContent = i.end ? word(i.end + "까지", "Until " + i.end) : t("해제 시각 미정"); box.append(until);
      }
      return box;
    }
    function renderList(){
      listTimer = 0; list.replaceChildren(); if (!shown || !data){ summary.textContent = ""; return; }
      const items = selected(), bounds = map.getBounds(), inView = items.filter(i => bounds.contains([i.lat, i.lng]));
      const full = items.filter(i => i.full).length;
      summary.textContent = word("서울 " + items.length + "곳 · 전면 통제 " + full + "곳 · 화면 안 " + inView.length + "곳", "Seoul: " + items.length + " incidents · " + full + " full closures · " + inView.length + " in view");
      for (const i of inView.sort((a, b) => Number(b.full) - Number(a.full) || distance(a) - distance(b)).slice(0, 40)){
        const item = el("li"), go = button("", "map-zone-go map-incident-go"), name = literal(el("span", "map-zone-go-name")), meta = el("span", "map-zone-go-meta");
        name.textContent = i.title || i.typeName || i.type; go.style.borderLeftColor = CATEGORIES[i.category].color;
        meta.textContent = [t(CATEGORIES[i.category].label), i.full ? t("전면 통제") : "", phaseText(phase(i)), i.end ? word("~" + i.end, "until " + i.end) : ""].filter(Boolean).join(" · ");
        go.append(name, meta);
        go.addEventListener("click", () => { map.setView([i.lat, i.lng], Math.max(16, map.getZoom())); const m = markers.get(i.id); if (m) m.openPopup(); });
        item.append(go); list.append(item);
      }
      if (!inView.length) list.append(el("li", "map-zone-empty", items.length ? "지금 화면에는 돌발·통제 지점이 없어요. '서울 전체 보기'를 눌러 보세요." : "표시할 돌발·통제 지점이 없어요. 갈래 선택을 확인해 주세요."));
      if (inView.length > 40) list.append(el("li", "map-zone-empty", "전면 통제와 가까운 곳부터 40곳을 보여 줍니다. 지도를 옮기면 목록이 바뀝니다."));
    }
    function draw(){
      layer.clearLayers(); markers.clear();
      for (const [id, count] of counts) count.textContent = data ? " " + data.incidents.filter(i => i.category === id).length : "";
      if (!shown || !data){ map.removeLayer(layer); map.removeLayer(renderer); renderList(); controls(); return; }
      for (const i of selected()){
        const color = CATEGORIES[i.category].color, later = phase(i) === 1;
        const marker = L.circleMarker([i.lat, i.lng], { renderer, radius:i.full ? 8 : 6.5, color:i.full ? "#1f2937" : "#fff", weight:i.full ? 2.5 : 1.5,
          fillColor:color, fillOpacity:later ? .45 : .92, dashArray:later ? "3 2" : null, bubblingMouseEvents:false });
        marker.bindTooltip(() => card(i), { className:"map-zone-tooltip map-incident-tooltip", direction:"top", opacity:1, offset:[0, -6] });
        marker.bindPopup(() => card(i, true), { maxWidth:340 }); marker.addTo(layer); markers.set(i.id, marker);
      }
      layer.addTo(map); renderList(); controls();
    }
    async function show(refreshing = false, quiet = false){
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller; controls();
      if (!quiet) status.textContent = t("돌발정보를 받는 중…");
      try {
        const result = await load({ signal:controller.signal, refresh:refreshing });
        if (destroyed || seq !== generation || controller.signal.aborted) return;
        if (!quiet) map.closePopup();
        data = result; shown = true; draw();
        status.textContent = word("자료 받은 때: ", "Fetched: ") + new Date(data.fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST"
          + (!data.complete ? " · " + t("돌발 목록 일부만 표시합니다.") : "") + (data.stale ? " · " + t("갱신이 지연되어 이전 자료를 표시합니다.") : "")
          + (data.unlocated ? word(" · 위치를 읽지 못한 " + data.unlocated + "건 제외", " · " + data.unlocated + " without a usable location excluded") : "");
      } catch(error){
        if (!controller.signal.aborted && seq === generation) status.textContent = t(failureText(error)) + (shown ? " " + t("앞서 받은 돌발정보를 유지합니다.") : "");
      } finally { if (seq === generation){ abort = null; controls(); } }
    }
    function clearAll(){ generation++; if (abort) abort.abort(); abort = null; shown = false; map.closePopup(); draw(); status.textContent = t("돌발·통제 표시를 지웠어요."); }
    toggle.addEventListener("click", () => { if (!panel.hidden){ clearAll(); panel.hidden = true; } else { panel.hidden = false; if (!shown) show(); } controls(); });
    close.addEventListener("click", () => { panel.hidden = true; controls(); toggle.focus(); });
    refresh.addEventListener("click", () => show(true)); clear.addEventListener("click", clearAll);
    fit.addEventListener("click", () => { const points = selected().map(i => [i.lat, i.lng]); if (points.length) map.fitBounds(points, { padding:[40, 40], maxZoom:16 }); });
    for (const check of [...checks.values(), upcoming]) check.addEventListener("change", () => { map.closePopup(); draw(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !listTimer) listTimer = setTimeout(renderList, 120); }, language = () => { map.closePopup(); draw(); };
    map.on("moveend", move); window.addEventListener("mni18nchange", language);
    // 켜 둔 동안만 조용히 새로 받는다. 런처가 3분 묶어 두므로 여러 화면이 켜도 상류 호출은 늘지 않는다.
    const timer = setInterval(() => { if (shown && !abort && !destroyed) show(false, true); }, REFRESH_MS);
    fetch("/can-proxy-seoul-open", { signal:capability.signal, cache:"no-store" }).then(r => r.ok ? r.text() : "").then(value => {
      if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("서울시 공사·사고·행사 통제 지점을 지도에서 봅니다."); }
    }).catch(() => {}); controls();
    const api = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){ return shown && data ? t("출처: 서울 열린데이터광장 실시간 돌발정보") + " · " + new Date(data.fetchedAt).toLocaleString("sv-SE", { timeZone:"Asia/Seoul" }).slice(0, 16) + " KST" : ""; },
      destroy(){ destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(listTimer); clearInterval(timer);
        map.off("moveend", move); window.removeEventListener("mni18nchange", language); layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); markers.clear(); pane.remove(); panel.remove(); toggle.remove(); }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => api.destroy()); return api;
  }
  return { mount, parse, decode, stamp, describe, category, normalize, phase, get, load, loadCodes, readCodes, failureText, CATEGORIES, KNOWN_TYPES, SOURCE, CODE_CACHE_KEY };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNRoadIncidents;
