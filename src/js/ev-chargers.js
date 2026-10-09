"use strict";
/* 한국환경공단 전기자동차 충전소 정보. 정보 조회로 전체 상태를 받은 뒤 최근 10분의
   변경분을 합친다. 8분이 지나면 전체를 다시 받아 변경분 사이의 공백을 막는다.
   statUpdDt는 마지막 상태 변경 시각이며, 자료를 확인한 시각과 다르다. */
const MNEvChargers = (() => {
  const SOURCE = "https://www.data.go.kr/data/15076352/openapi.do", TTL = 60000, SNAPSHOT_TTL = 8 * 60000, STALE_AFTER = 5 * 60000;
  const cache = new Map(), text = v => v == null ? "" : String(v).trim();
  const TYPES = { "01":["DC차데모", ["chademo"]], "02":["AC완속", ["ac"]], "03":["DC차데모+AC3상", ["chademo", "ac3"]],
    "04":["DC콤보", ["combo"]], "05":["DC차데모+DC콤보", ["chademo", "combo"]], "06":["DC차데모+AC3상+DC콤보", ["chademo", "ac3", "combo"]],
    "07":["AC3상", ["ac3"]], "08":["DC콤보(완속)", ["combo"]], "09":["NACS", ["nacs"]], "10":["DC콤보+NACS", ["combo", "nacs"]], "11":["DC콤보2(버스전용)", ["bus"]] };
  const STATES = { "0":"상태 미확인", "1":"통신 이상", "2":"충전 가능", "3":"충전 중", "4":"운영 중지", "5":"점검 중", "6":"예약 중", "9":"상태 미확인" };
  const validDistrict = v => /^[1-9]\d{4}$/.test(text(v));
  function stamp(value){
    const s = text(value); if (!/^\d{14}$/.test(s)) return null;
    const parts = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)].map(Number);
    const utc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3] - 9, parts[4], parts[5]);
    if (!Number.isFinite(utc)) return null;
    return new Date(utc + 9 * 3600000).toISOString().replace(/\D/g, "").slice(0, 14) === s ? utc : null;
  }
  function rows(json){
    const root = json && (json.response || json), code = text(root && (root.resultCode || root.header && root.header.resultCode));
    if (["03", "0003"].includes(code)) return { items:[], total:0 };
    const body = root && (root.body || root); if (!["00", "0000"].includes(code) || !body) throw new Error("ev-invalid-data");
    const raw = body.items, item = Array.isArray(raw) ? raw : raw && raw.item, total = Number(body.totalCount);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("ev-invalid-data");
    return { items:(Array.isArray(item) ? item : item && typeof item === "object" ? [item] : []).filter(v => v && typeof v === "object"), total };
  }
  function charger(row){
    const stationId = text(row.statId), id = text(row.chgerId); if (!stationId || !id) return null;
    const lat = text(row.lat) ? Number(row.lat) : NaN, lng = text(row.lng) ? Number(row.lng) : NaN, power = text(row.output) ? Number(row.output) : NaN;
    const located = Number.isFinite(lat) && Number.isFinite(lng) && lat >= 32.5 && lat <= 39 && lng >= 124 && lng <= 132.5;
    return { key:stationId + ":" + id, stationId, id, name:text(row.statNm) || stationId, district:text(row.zscode),
      address:[text(row.addr), text(row.addrDetail)].filter(Boolean).join(" "), location:text(row.location), lat:located ? lat : null, lng:located ? lng : null,
      type:text(row.chgerType).padStart(2, "0"), power:Number.isFinite(power) && power > 0 && power <= 10000 ? power : null,
      method:text(row.method), hours:text(row.useTime), operator:text(row.busiNm) || text(row.bnm), phone:text(row.busiCall),
      parking:text(row.parkingFree), restriction:text(row.limitYn), restrictionNote:text(row.limitDetail), deleted:text(row.delYn), note:text(row.note),
      state:text(row.stat), changed:text(row.statUpdDt), chargingSince:text(row.nowTsdt), lastEnd:text(row.lastTedt) };
  }
  function normalize(items, district){
    const byId = new Map(), deletedIds = new Set(); let other = 0;
    for (const row of items){
      const c = charger(row); if (!c || c.district && c.district !== district){ other++; continue; }
      if (c.deleted === "Y"){ byId.delete(c.key); deletedIds.add(c.key); continue; }
      if (deletedIds.has(c.key)) continue;
      const old = byId.get(c.key); if (!old || (stamp(c.changed) || 0) >= (stamp(old.changed) || 0)) byId.set(c.key, c);
    }
    return { chargers:[...byId.values()], deleted:deletedIds.size, other };
  }
  function merge(chargers, updates){
    const changes = new Map();
    for (const r of updates){
      const key = text(r.statId) + ":" + text(r.chgerId), time = stamp(r.statUpdDt), old = changes.get(key);
      if (!old || (time || 0) >= (stamp(old.statUpdDt) || 0)) changes.set(key, r);
    }
    return chargers.map(c => {
      const r = changes.get(c.key); if (!r || stamp(r.statUpdDt) != null && stamp(r.statUpdDt) < (stamp(c.changed) || 0)) return c;
      return { ...c, state:text(r.stat), changed:text(r.statUpdDt), chargingSince:text(r.nowTsdt), lastEnd:text(r.lastTedt) };
    });
  }
  function status(c, data, now = Date.now()){
    if (!data || data.stale || !Number.isFinite(data.checkedAt) || now < data.checkedAt || now - data.checkedAt >= STALE_AFTER) return { label:"최근 상태 확인 필요", available:false, color:"#7b8794" };
    const changed = stamp(c.changed);
    if (changed == null || changed > now + 60000 || !STATES[c.state]) return { label:"상태 미확인", available:false, color:"#7b8794" };
    if (c.restriction !== "N") return { label:c.restriction === "Y" ? "이용 제한" : "이용 제한 확인 필요", available:false, color:"#ac761b" };
    if (!TYPES[c.type]) return { label:"커넥터 확인 필요", available:false, color:"#7b8794" };
    if (c.type === "11") return { label:"버스 전용", available:false, color:"#ac761b" };
    return { label:STATES[c.state], available:c.state === "2", color:c.state === "2" ? "#168263" : c.state === "3" || c.state === "6" ? "#426bc0" : "#7b8794" };
  }
  function distance(a, b){
    const rad = Math.PI / 180, h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function stations(data, center, { radius = 3000, connector = "all", availableOnly = true } = {}, now = Date.now()){
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || center.lat < 32.5 || center.lat > 39 || center.lng < 124 || center.lng > 132.5) return [];
    const groups = new Map();
    for (const c of data.chargers){
      if (connector !== "all" && !(TYPES[c.type] && TYPES[c.type][1].includes(connector))) continue;
      let g = groups.get(c.stationId); if (!g){ g = { id:c.stationId, name:c.name, lat:null, lng:null, chargers:[] }; groups.set(c.stationId, g); }
      if (g.lat == null && c.lat != null){ g.lat = c.lat; g.lng = c.lng; }
      g.chargers.push({ ...c, status:status(c, data, now) });
    }
    return [...groups.values()].filter(g => g.lat != null).map(g => ({ ...g, distance:distance(center, g), available:g.chargers.filter(c => c.status.available).length }))
      .filter(g => g.distance <= radius && (!availableOnly || g.available > 0)).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  }
  async function pages(kind, district, { signal, refresh = false, onProgress } = {}){
    const items = []; let total = Infinity, fetchedAt = Infinity, stale = false;
    for (let page = 1; page <= 10 && items.length < total; page++){
      if (signal) signal.throwIfAborted();
      const response = await fetch("/ev-" + (kind === "info" ? "chargers" : "charger-status") + "?district=" + district + "&page=" + page + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
      if (!response.ok){ const reason = text(await response.text()), error = new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "ev-fetch-failed");
        error.upstream = text(response.headers && response.headers.get("X-ClassDock-Bus-Upstream")); throw error; }
      const result = rows(await response.json()); if (signal) signal.throwIfAborted();
      const at = Date.parse(response.headers && response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
      fetchedAt = Math.min(fetchedAt, Number.isFinite(at) ? Math.min(Date.now(), at) : Date.now()); stale = stale || response.headers && response.headers.get("X-ClassDock-Bus-Stale") === "1";
      items.push(...result.items); total = result.total; if (onProgress) onProgress(items.length, total); if (!result.items.length) break;
    }
    return { items, fetchedAt, stale:!!stale, complete:items.length >= total, total };
  }
  async function load(district, options = {}){
    district = text(district); if (!validDistrict(district)) throw new Error("bus-bad-request"); if (options.signal) options.signal.throwIfAborted();
    const old = cache.get(district), now = Date.now();
    if (old && !options.refresh && now >= old.checkedAt && now - old.checkedAt < TTL && !old.stale) return old;
    try {
      let data;
      if (old && old.complete && !old.stale && now >= old.snapshotAt && now - old.snapshotAt < SNAPSHOT_TTL){
        const changes = await pages("status", district, options);
        // 일부 변경분을 최신 전체 상태처럼 취급하지 않는다. 다음 갱신 때 전체를 다시 받는다.
        data = changes.complete && !changes.stale && changes.fetchedAt >= old.checkedAt ? { ...old, chargers:merge(old.chargers, changes.items), checkedAt:changes.fetchedAt }
          : { ...old, stale:true, checkedAt:old.checkedAt };
      } else {
        const snapshot = await pages("info", district, options);
        data = { ...normalize(snapshot.items, district), district, total:snapshot.total, complete:snapshot.complete, stale:snapshot.stale,
          checkedAt:snapshot.fetchedAt, snapshotAt:snapshot.fetchedAt };
      }
      if (options.signal) options.signal.throwIfAborted();
      if (!cache.has(district) && cache.size >= 6) cache.delete(cache.keys().next().value); if (data.complete && !data.stale) cache.set(district, data); else cache.delete(district);
      return data;
    } catch(error){ cache.delete(district); throw error; }
  }
  function failureText(error){
    if (error.message === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (error.message === "bus-key-invalid") return "한국환경공단 전기자동차 충전소 정보 API의 활용신청 승인과 인증키를 확인해 주세요.";
    if (error.message === "bus-quota") return "충전기 API의 오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    if (error.message === "bus-rate-limit") return "조회가 잠시 몰렸어요. 조금 기다린 뒤 다시 갱신해 주세요.";
    if (error.message === "ev-no-district") return "지도 중심의 시군구를 찾지 못했어요. 대한민국으로 지도를 옮기거나 지역을 직접 골라 주세요.";
    return "충전기 자료를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  function mount({ map, stage, toolRow, doc, t = v => v, movePanel = null, getDistricts = async () => [] }){
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const literal = n => { n.setAttribute("data-i18n-ignore", ""); n.setAttribute("lang", "ko"); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const toggle = button("전기차 충전", "map-toolvis-ev-chargers"); toolRow.append(toggle); toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "evChargers");
    const panel = el("section", "map-weather-panel map-ev-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("사용 가능한 전기차 충전기"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "사용 가능한 전기차 충전기"), close);
    const regions = el("div", "map-ev-regions"), province = literal(el("select", "map-ev-province")), district = literal(el("select", "map-ev-district"));
    province.setAttribute("aria-label", t("시도 선택")); district.setAttribute("aria-label", t("시군구 선택")); regions.append(province, district);
    const filters = el("div", "map-ev-filters"), radius = el("select", "map-ev-radius"), connector = el("select", "map-ev-connector");
    radius.setAttribute("aria-label", t("검색 반경")); connector.setAttribute("aria-label", t("충전 커넥터"));
    for (const v of [1000, 3000, 5000, 10000]){ const n = el("option"); n.value = String(v); n.textContent = v / 1000 + " km"; radius.append(n); } radius.value = "3000";
    for (const [id, label] of [["all", "모든 커넥터"], ["combo", "DC콤보"], ["ac", "AC완속"], ["chademo", "DC차데모"], ["ac3", "AC3상"], ["nacs", "NACS"]]){ const n = el("option", "", label); n.value = id; connector.append(n); } connector.value = "all";
    const available = el("input", "map-ev-available"), automatic = el("input", "map-ev-auto"), availableLabel = el("label"), autoLabel = el("label");
    available.type = automatic.type = "checkbox"; available.checked = automatic.checked = true;
    availableLabel.append(available, el("span", "", "충전 가능만")); autoLabel.append(automatic, el("span", "", "1분 자동 갱신")); filters.append(radius, connector, availableLabel, autoLabel);
    const tools = el("div", "map-weather-tools"), center = button("지도 중심 지역", "map-ev-center"), refresh = button("상태 갱신", "map-ev-refresh"), clear = button("지도에서 지우기", "map-ev-clear"); tools.append(center, refresh, clear);
    const summary = el("p", "map-ev-summary"), statusLine = el("p", "map-weather-status map-ev-status"), list = el("ol", "map-ev-list");
    statusLine.setAttribute("role", "status"); statusLine.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "선택한 시군구 안에서 지도 중심 반경의 충전소를 찾습니다. 충전 가능은 조회 시점의 상태이며, 커넥터·이용시간·현장 조건을 확인해 주세요. 상태 변경 시각은 마지막 조회 시각과 다릅니다.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 한국환경공단 전기자동차 충전소 정보"); source.href = SOURCE; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, regions, filters, tools, summary, statusLine, list, note, foot); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel); if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapEvChargersPane"); pane.style.zIndex = "445"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapEvChargersPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController(), markers = new Map(), entries = new Map();
    let catalog = null, data = null, loadedRegion = null, shown = false, destroyed = false, abort = null, generation = 0, drawTimer = 0, autoTimer = 0;
    const current = () => data ? stations(data, map.getCenter(), { radius:Number(radius.value), connector:connector.value, availableOnly:available.checked }) : [];
    const stationColor = g => g.available ? "#168263" : g.chargers.some(c => c.status.color === "#426bc0") ? "#426bc0" : g.chargers.some(c => c.status.color === "#ac761b") ? "#ac761b" : "#7b8794";
    const clock = at => new Date(at).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST";
    function controls(){ toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown)); toggle.setAttribute("aria-expanded", String(!panel.hidden)); center.disabled = refresh.disabled = !!abort; province.disabled = district.disabled = !catalog; }
    function fillDistricts(code){
      district.replaceChildren(); for (const v of catalog.filter(v => v.sido === province.value)){ const n = el("option"); n.value = v.code; n.textContent = v.sgg; district.append(n); }
      district.value = (catalog.find(v => v.code === code && v.sido === province.value) || catalog.find(v => v.sido === province.value) || {}).code || "";
    }
    async function ensureCatalog(){
      if (catalog) return catalog; const items = await getDistricts(); if (destroyed) return [];
      catalog = items.filter(v => validDistrict(v.code) && v.sido && v.sgg); if (!catalog.length){ catalog = null; throw new Error("ev-no-district"); }
      province.replaceChildren(); for (const name of new Set(catalog.map(v => v.sido))){ const n = el("option"); n.value = name; n.textContent = name; province.append(n); }
      province.value = catalog[0].sido; fillDistricts(); return catalog;
    }
    function card(g, detail = false){
      const box = el("div", "map-ev-card"), name = literal(el("strong", "map-ev-name")), badge = el("div", "map-ev-badge"); name.textContent = g.name; box.style.setProperty("--ev-color", stationColor(g));
      badge.textContent = word("충전 가능 ", "Available ") + g.available + " / " + g.chargers.length + word("기", " chargers");
      const meta = el("p"); meta.textContent = (g.distance / 1000).toFixed(1) + " km · " + [...new Set(g.chargers.map(c => TYPES[c.type] ? TYPES[c.type][0] : t("커넥터 확인 필요")))].join(" · "); box.append(name, badge, meta);
      if (!detail) return box;
      const sample = g.chargers[0], line = (label, value) => { if (!value) return; const n = el("p"), v = literal(el("span")); v.textContent = value; n.append(el("span", "map-ev-key", label), v); box.append(n); };
      line("주소", sample.address); line("상세 위치", sample.location); line("이용시간", sample.hours); line("운영기관", sample.operator); line("전화번호", sample.phone);
      line("주차요금", sample.parking === "Y" ? t("무료") : sample.parking === "N" ? t("유료") : t("요금 확인 필요"));
      line("마지막 상태 조회", clock(data.checkedAt));
      for (const c of g.chargers){
        const row = el("div", "map-ev-charger"), label = el("strong"), info = literal(el("p"));
        label.textContent = word("충전기 ", "Charger ") + c.id + " · " + t(status(c, data).label); label.style.color = status(c, data).color;
        info.textContent = (TYPES[c.type] ? TYPES[c.type][0] : t("커넥터 확인 필요")) + (c.power ? " · " + c.power + " kW" : "") + (c.method ? " · " + c.method : ""); row.append(label, info);
        const changed = el("p"); changed.textContent = t("상태 변경") + ": " + (stamp(c.changed) == null ? t("시각 미등록") : clock(stamp(c.changed))); row.append(changed);
        for (const value of [c.restrictionNote, c.note]) if (value){ const n = literal(el("p")); n.textContent = value; row.append(n); }
        box.append(row);
      }
      return box;
    }
    function draw(){
      clearTimeout(drawTimer); drawTimer = 0; list.replaceChildren();
      if (!shown || !data){ layer.clearLayers(); markers.clear(); entries.clear(); map.removeLayer(layer); map.removeLayer(renderer); summary.textContent = ""; controls(); return; }
      const all = current(), selected = all.slice(0, 100), ids = new Set(selected.map(g => g.id));
      for (const [id, marker] of markers) if (!ids.has(id) && !marker.isPopupOpen()){ layer.removeLayer(marker); markers.delete(id); entries.delete(id); }
      summary.textContent = loadedRegion.name + " · " + Number(radius.value) / 1000 + " km · " + all.length + word("곳", " stations")
        + word(" · 충전 가능 ", " · available ") + all.reduce((n, g) => n + g.available, 0) + word("기", " chargers") + (all.length > 100 ? word(" · 가까운 100곳 표시", " · nearest 100 shown") : "");
      for (const g of selected){
        entries.set(g.id, g); let marker = markers.get(g.id);
        if (marker){ marker.setStyle({ fillColor:stationColor(g) }); const p = marker.getLatLng(); if (p.lat !== g.lat || p.lng !== g.lng) marker.setLatLng([g.lat, g.lng]); }
        else { marker = L.circleMarker([g.lat, g.lng], { pane:"mapEvChargersPane", renderer, radius:8, color:"#fff", weight:2, fillColor:stationColor(g), fillOpacity:1, bubblingMouseEvents:false })
          .bindTooltip(() => card(entries.get(g.id) || g), { direction:"top", offset:[0, -8], className:"map-ev-tooltip" })
          .bindPopup(() => card(entries.get(g.id) || g, true), { className:"map-ev-popup", maxHeight:260, minWidth:220, maxWidth:330 }).addTo(layer); markers.set(g.id, marker); }
        const item = el("li"), go = button("", "map-ev-go"), name = literal(el("span", "map-ev-go-name")), meta = el("span", "map-ev-go-meta"); name.textContent = g.name;
        meta.textContent = word("충전 가능 ", "Available ") + g.available + "/" + g.chargers.length + word("기", " chargers") + " · " + (g.distance / 1000).toFixed(1) + " km";
        go.style.borderLeftColor = stationColor(g); go.append(name, meta); go.addEventListener("click", () => { map.setView([g.lat, g.lng], Math.max(map.getZoom(), 16), { animate:false }); draw(); const m = markers.get(g.id); if (m) m.openPopup(); }); item.append(go); list.append(item);
      }
      if (!all.length) list.append(el("li", "map-ev-empty", "조건에 맞는 충전소가 없어요. 반경·커넥터·충전 가능만 선택 또는 조회 지역을 확인해 주세요."));
      layer.addTo(map); controls();
    }
    function scheduleAuto(){ clearTimeout(autoTimer); autoTimer = 0; if (!destroyed && shown && !panel.hidden && automatic.checked) autoTimer = setTimeout(() => { autoTimer = 0; if (!abort) show(false); else scheduleAuto(); }, 60000); }
    async function show(refreshing = false, atCenter = false){
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller; controls(); statusLine.textContent = t("충전기 상태를 조회하는 중…");
      try {
        const choices = await ensureCatalog(); if (destroyed || seq !== generation || controller.signal.aborted) return;
        const p = map.getCenter(), choice = atCenter ? choices.find(v => v.contains(p.lat, p.lng)) : choices.find(v => v.code === district.value); if (!choice) throw new Error("ev-no-district");
        province.value = choice.sido; fillDistricts(choice.code);
        const result = await load(choice.code, { signal:controller.signal, refresh:refreshing }); if (destroyed || seq !== generation || controller.signal.aborted) return;
        // 갱신 시 상세가 옛 상태를 계속 보여 주지 않도록 닫는다. 지도 이동 중에는 유지한다.
        map.closePopup(); data = result; loadedRegion = choice; shown = true; draw();
        const missing = data.chargers.filter(c => c.lat == null).length;
        statusLine.textContent = t("마지막 상태 조회") + ": " + clock(data.checkedAt) + (!data.complete ? " · " + t("충전기 목록 일부만 표시합니다.") : "")
          + (data.stale ? " · " + t("최근 상태 확인 필요") : "") + (missing ? word(" · 좌표 미등록 " + missing + "기 제외", " · " + missing + " chargers without coordinates excluded") : "");
      } catch(error){
        if (!controller.signal.aborted && seq === generation){
          if (data){ map.closePopup(); data = { ...data, stale:true }; draw(); }
          statusLine.textContent = t(failureText(error)); if (["bus-key-invalid", "bus-key-required", "bus-quota"].includes(error.message)) automatic.checked = false;
          if (/^HTTP \d{3}(?: - [\w-]+)?$/.test(error.upstream || "")) statusLine.textContent += " · " + error.upstream;
        }
      } finally { if (seq === generation){ abort = null; controls(); scheduleAuto(); } }
    }
    function clearAll(){ generation++; if (abort) abort.abort(); abort = null; shown = false; clearTimeout(autoTimer); map.closePopup(); draw(); statusLine.textContent = t("충전소 표시를 지웠어요."); }
    toggle.addEventListener("click", () => { if (!panel.hidden){ clearAll(); panel.hidden = true; } else { panel.hidden = false; if (!shown) show(false, true); else if (automatic.checked && Date.now() - data.checkedAt >= TTL) show(); else scheduleAuto(); } controls(); });
    close.addEventListener("click", () => { panel.hidden = true; scheduleAuto(); controls(); toggle.focus(); }); center.addEventListener("click", () => show(false, true)); refresh.addEventListener("click", () => show(true)); clear.addEventListener("click", clearAll);
    province.addEventListener("change", () => { fillDistricts(); show(); }); district.addEventListener("change", () => show()); automatic.addEventListener("change", scheduleAuto);
    for (const node of [radius, connector, available]) node.addEventListener("change", () => { map.closePopup(); draw(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !drawTimer) drawTimer = setTimeout(draw, 120); }, language = () => { map.closePopup(); draw(); };
    const ageTimer = setInterval(() => { if (shown && data && Date.now() - data.checkedAt >= STALE_AFTER){ map.closePopup(); draw(); } }, 30000);
    map.on("moveend", move); map.on("popupclose", move); window.addEventListener("mni18nchange", language);
    fetch("/can-proxy-weather", { signal:capability.signal, cache:"no-store" }).then(r => r.ok ? r.text() : "").then(value => { if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("주변 충전소의 사용 가능한 충전기와 커넥터를 확인합니다."); } }).catch(() => {}); controls();
    const api = {
      isAvailable(){ return !toggle.disabled; }, captureNote(){ return shown && data ? t("출처: 한국환경공단 전기자동차 충전소 정보") + " · " + loadedRegion.name + " · " + clock(data.checkedAt)
        + (data.stale || Date.now() - data.checkedAt >= STALE_AFTER ? " · " + t("최근 상태 확인 필요") : "") : ""; },
      destroy(){ destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(autoTimer); clearTimeout(drawTimer); clearInterval(ageTimer);
        map.off("moveend", move); map.off("popupclose", move); window.removeEventListener("mni18nchange", language); layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); markers.clear(); entries.clear(); pane.remove(); panel.remove(); toggle.remove(); }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => api.destroy()); return api;
  }
  return { mount, stamp, rows, charger, normalize, merge, status, distance, stations, pages, load, failureText, validDistrict, SOURCE, TYPES, STATES };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNEvChargers;
