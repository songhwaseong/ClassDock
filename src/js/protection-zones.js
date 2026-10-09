"use strict";
/* 경찰청 전국 보호구역 현황. 시군구별 API 경계를 임시 지도 층으로 표시한다.
   키는 런처에만 두며, 지도 이동·갈래 변경은 추가 API 조회를 만들지 않는다.
   SRID 없는 평면 WKT는 경찰청 공식 지도의 EPSG:5181을 사용한다.
   근거: https://www.safetyzone.go.kr/js/ptl/map/map.js (지도 투영), map_ptl_polygon.js (WKT).
   다른 좌표계를 추측하거나 반경 원으로 보호구역을 대신하지 않는다. */
const MNProtectionZones = (() => {
  const TTL = 86400000, MAX_PAGES = 10, cache = new Map();
  const TYPES = { "1":{ label:"어린이 보호구역", color:"#bf7100" }, "2":{ label:"노인 보호구역", color:"#8649bf" }, "3":{ label:"장애인 보호구역", color:"#147fa8" } };
  const SOURCE = "https://www.data.go.kr/data/15142010/openapi.do";
  const text = value => value == null ? "" : String(value).trim();
  const validDistrict = value => /^[1-9]\d{4}$/.test(text(value));
  function rows(json){
    const root = json && (json.response || json), code = text(root && root.header && root.header.resultCode);
    if (["03", "0003", "ERR_03"].includes(code)) return { items:[], total:0 };
    if (!["00", "0000"].includes(code) || !root.body) throw new Error("zones-invalid-data");
    const raw = root.body.items, items = Array.isArray(raw) ? raw : raw && (Array.isArray(raw.item) ? raw.item : raw.item ? [raw.item] : []);
    return { items:(items || []).filter(r => r && typeof r === "object"), total:Number(root.body.totalCount) || 0 };
  }
  function geometry(value, coords = typeof MNKoreaCoords !== "undefined" ? MNKoreaCoords : null){
    let source = text(value), srid = "", raw, kind;
    if (!source || source.length > 1000000) return null;
    const prefix = source.match(/^SRID=(\d+);\s*/i);
    if (prefix){ srid = prefix[1]; source = source.slice(prefix[0].length); }
    try {
      if (source.startsWith("{")){
        const json = JSON.parse(source); raw = json.coordinates; kind = json.type;
        if (json.crs){ const code = text(json.crs.properties && json.crs.properties.name).match(/(?:EPSG[:/]+|::)(\d+)$/i); if (!code) return null; srid = code[1]; }
      } else {
        const header = source.match(/^(POLYGON|MULTIPOLYGON)\s*(ZM|Z|M)?\s*/i); if (!header) return null;
        kind = header[1].toUpperCase() === "POLYGON" ? "Polygon" : "MultiPolygon";
        const body = source.slice(header[0].length), tokens = [], token = /\s*([(),]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/igy;
        let end = 0, match;
        while ((match = token.exec(body))){ tokens.push(match[1]); end = token.lastIndex; if (tokens.length > 100000) return null; }
        if (body.slice(end).trim()) return null;
        let i = 0;
        const take = expected => { if (tokens[i++] !== expected) throw new Error("wkt"); };
        const dimensions = header[2] ? header[2].length + 2 : 2;
        function group(depth){
          take("("); const out = [];
          do {
            if (depth > 1) out.push(group(depth - 1));
            else { const point = []; for (let d = 0; d < dimensions; d++){ if (!tokens[i] || /^[(),]$/.test(tokens[i])) throw new Error("wkt"); point.push(Number(tokens[i++])); } out.push(point); }
            if (tokens[i] !== ",") break; i++;
          } while (i < tokens.length);
          take(")"); return out;
        }
        raw = group(kind === "Polygon" ? 2 : 3); if (i !== tokens.length) return null;
      }
      if (kind !== "Polygon" && kind !== "MultiPolygon") return null;
      const polygons = kind === "Polygon" ? [raw] : raw;
      if (!Array.isArray(polygons) || !polygons.length || polygons.length > 1000) return null;
      let count = 0; const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      const parts = polygons.map(polygon => {
        if (!Array.isArray(polygon) || !polygon.length) throw new Error("polygon");
        return polygon.map(ring => {
          if (!Array.isArray(ring) || ring.length < 4) throw new Error("ring");
          const points = ring.map(point => {
            if (++count > 20000 || !Array.isArray(point) || point.length < 2 || point.some(n => typeof n !== "number" || !Number.isFinite(n))) throw new Error("point");
            const [x, y] = point;
            const geographic = !srid && Math.abs(x) <= 180 && Math.abs(y) <= 90;
            const position = srid === "4326" || geographic ? [y, x] : coords && coords.toWgs84(srid || "5181", x, y);
            if (!position || position[0] < 32.5 || position[0] > 39 || position[1] < 124 || position[1] > 132.5) throw new Error("coordinates");
            bounds[0] = Math.min(bounds[0], position[0]); bounds[1] = Math.min(bounds[1], position[1]);
            bounds[2] = Math.max(bounds[2], position[0]); bounds[3] = Math.max(bounds[3], position[1]); return position;
          });
          const first = points[0], last = points[points.length - 1];
          if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) throw new Error("open-ring");
          if (new Set(points.map(p => p.join(","))).size < 3) throw new Error("degenerate-ring");
          return points;
        });
      });
      return { parts, bounds:[[bounds[0], bounds[1]], [bounds[2], bounds[3]]], center:[(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] };
    } catch(_){ return null; }
  }
  function normalize(items, district, coords){
    const byId = new Map(); let inactive = 0, other = 0;
    for (const row of items){
      if (["N", "0", "FALSE"].includes(text(row.useYn).toUpperCase())){ inactive++; continue; }
      const id = text(row.ptznMngNo), type = text(row.fcltTypeCd), rowDistrict = text(row.sggCd);
      if (!id || !TYPES[type] || rowDistrict && rowDistrict !== district){ other++; continue; }
      const entry = { id, type, name:text(row.trgtFcltNm) || "이름 미등록", district, representative:text(row.rprsPtznMngNo),
        address:[text(row.roadNmAddr) || text(row.lotnoAddr), text(row.roadNmAddr ? row.roadNmDaddr : row.lotnoDaddr)].filter(Boolean).join(" "),
        updated:text(row.lastMdfcnDt), registered:text(row.frstRegDt), usage:text(row.useYn), geometry:geometry(row.fturGeomVl, coords) };
      const old = byId.get(id); if (!old || !old.geometry && entry.geometry) byId.set(id, entry);
    }
    return { zones:[...byId.values()], inactive, other };
  }
  async function get(path, { signal, refresh = false } = {}){
    if (signal) signal.throwIfAborted();
    const response = await fetch(path + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
    if (!response.ok){ const reason = text(await response.text()), error = new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "zones-fetch-failed");
      error.upstream = text(response.headers && response.headers.get("X-ClassDock-Bus-Upstream")); throw error; }
    const result = rows(await response.json()); if (signal) signal.throwIfAborted();
    const at = Date.parse(response.headers && response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return { ...result, fetchedAt:Number.isFinite(at) ? Math.min(Date.now(), at) : Date.now(), stale:response.headers && response.headers.get("X-ClassDock-Bus-Stale") === "1" };
  }
  async function load(district, options = {}){
    district = text(district); if (!validDistrict(district)) throw new Error("bus-bad-request");
    if (options.signal) options.signal.throwIfAborted();
    const old = cache.get(district); if (old && !options.refresh && Date.now() - old.fetchedAt < TTL && !old.stale) return old;
    const all = []; let total = Infinity, fetchedAt = Infinity, stale = false;
    for (let page = 1; page <= MAX_PAGES && all.length < total; page++){
      const result = await get("/protection-zones?sgg=" + district + "&page=" + page, options);
      total = result.total; fetchedAt = Math.min(fetchedAt, result.fetchedAt); stale = stale || result.stale; all.push(...result.items);
      if (!result.items.length) break;
    }
    const data = { ...normalize(all, district, options.coords), district, total, fetchedAt, stale, complete:all.length >= total };
    if (options.signal) options.signal.throwIfAborted();
    if (!stale){ if (cache.size >= 12) cache.delete(cache.keys().next().value); cache.set(district, data); } return data;
  }
  function failureText(error){
    if (error.message === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (error.message === "bus-key-invalid") return "경찰청 전국 보호구역 현황 API의 심의승인과 인증키를 확인해 주세요. 심의 중에는 조회할 수 없으며, 승인 직후에는 반영까지 시간이 걸릴 수 있어요.";
    if (error.message === "bus-quota") return "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    if (error.message === "zones-no-district") return "지도 중심의 시군구를 찾지 못했어요. 대한민국으로 지도를 옮기거나 지역을 직접 골라 주세요.";
    if (error.message === "zones-catalog") return "지역 목록을 읽지 못했어요. 잠시 후 다시 시도해 주세요.";
    return "보호구역 자료를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  function mount({ map, stage, toolRow, doc, t = v => v, movePanel = null, getDistricts = async () => [] }){
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const literal = n => { n.setAttribute("data-i18n-ignore", ""); n.setAttribute("lang", "ko"); return n; };
    const toggle = button("보호구역", "map-toolvis-protection-zones"); toolRow.append(toggle);
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "protectionZones");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    const panel = el("section", "map-weather-panel map-zone-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("우리 동네 보호구역"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "우리 동네 보호구역"), close);
    const filters = el("div", "map-zone-regions"), province = literal(el("select", "map-zone-province")), district = literal(el("select", "map-zone-district"));
    province.setAttribute("aria-label", t("시도 선택")); district.setAttribute("aria-label", t("시군구 선택")); filters.append(province, district);
    const types = el("div", "map-zone-types"), checks = new Map();
    for (const [id, spec] of Object.entries(TYPES)){
      const label = el("label", "map-zone-type"), check = el("input"), swatch = el("i"); check.type = "checkbox"; check.checked = true; check.value = id;
      swatch.style.background = spec.color; swatch.setAttribute("aria-hidden", "true"); label.append(check, swatch, el("span", "", spec.label)); types.append(label); checks.set(id, check);
    }
    const tools = el("div", "map-weather-tools"), center = button("지도 중심 지역", "map-zone-center"), search = button("이 지역 찾기", "map-zone-search"), refresh = button("자료 갱신", "map-zone-refresh"), fit = button("전체 경계 보기", "map-zone-fit"), clear = button("지도에서 지우기", "map-zone-clear");
    tools.append(center, search, refresh, fit, clear);
    const summary = el("p", "map-zone-summary"), status = el("p", "map-weather-status map-zone-status"), list = el("ol", "map-zone-list");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "API에 등록된 실제 경계를 표시합니다. 경계가 미등록되었거나 좌표를 읽을 수 없는 시설은 목록에만 남습니다. 지도를 옮긴 뒤 '지도 중심 지역'을 누르세요.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 경찰청 전국 보호구역 현황"); source.href = SOURCE; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, filters, types, tools, summary, status, list, note, foot); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel); if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapProtectionZonesPane"); pane.style.zIndex = "425"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapProtectionZonesPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController(), shapes = new Map();
    let catalog = null, data = null, loadedDistrict = null, shown = false, destroyed = false, abort = null, generation = 0, listTimer = 0;
    const selected = () => data ? data.zones.filter(z => checks.get(z.type).checked) : [];
    const distance = z => z.geometry ? map.getCenter().distanceTo(z.geometry.center) : Infinity;
    const visible = z => z.geometry && map.getBounds().intersects(z.geometry.bounds);
    function controls(){
      toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown)); toggle.setAttribute("aria-expanded", String(!panel.hidden));
      center.disabled = search.disabled = refresh.disabled = !!abort; fit.disabled = !shown || !selected().some(z => z.geometry);
      province.disabled = district.disabled = !catalog;
    }
    function fillDistricts(code){
      district.replaceChildren();
      for (const item of catalog.filter(v => v.sido === province.value)){ const n = el("option"); n.value = item.code; n.textContent = item.sgg; district.append(n); }
      const option = catalog.find(v => v.code === code && v.sido === province.value) || catalog.find(v => v.sido === province.value); district.value = option ? option.code : "";
    }
    async function ensureCatalog(){
      if (catalog) return catalog; const items = await getDistricts(); if (destroyed) return [];
      catalog = items.filter(v => validDistrict(v.code) && v.sido && v.sgg); if (!catalog.length){ catalog = null; throw new Error("zones-catalog"); }
      province.replaceChildren(); for (const name of new Set(catalog.map(v => v.sido))){ const n = el("option"); n.value = name; n.textContent = name; province.append(n); }
      province.value = catalog[0].sido; fillDistricts(); controls(); return catalog;
    }
    function card(z, popup = false){
      const box = el("div", "map-zone-card"); box.style.setProperty("--zone-color", TYPES[z.type].color);
      const name = literal(el("strong")); name.textContent = z.name; box.append(name, el("span", "map-zone-badge", TYPES[z.type].label));
      if (z.address){ const address = literal(el("p")); address.textContent = z.address; box.append(address); }
      if (popup){
        for (const [label, value] of [["관리번호", z.id], ["대표 관리번호", z.representative], ["등록일", z.registered], ["최종 수정일", z.updated]]){
          if (!value) continue; const row = el("p"), content = literal(el("span")), key = el("span", "map-zone-key"); key.textContent = t(label) + ": "; content.textContent = value; row.append(key, content); box.append(row);
        }
        if (!z.geometry) box.append(el("p", "map-weather-note", "경계 미등록·좌표 확인 필요"));
      }
      return box;
    }
    function renderList(){
      listTimer = 0; list.replaceChildren(); if (!shown || !data){ summary.textContent = ""; return; }
      const zones = selected(), boundaries = zones.filter(z => z.geometry), inView = boundaries.filter(visible).length;
      summary.textContent = loadedDistrict.name + word(" · " + zones.length + "곳 · 경계 " + boundaries.length + "곳 · 화면 안 " + inView + "곳", " · " + zones.length + " places · " + boundaries.length + " boundaries · " + inView + " in view")
        + (zones.length > boundaries.length ? word(" · 경계 미등록·좌표 확인 " + (zones.length - boundaries.length) + "곳", " · " + (zones.length - boundaries.length) + " without usable boundaries") : "");
      for (const z of [...zones].sort((a, b) => Number(visible(b)) - Number(visible(a)) || distance(a) - distance(b) || a.name.localeCompare(b.name)).slice(0, 50)){
        const item = el("li"), go = button("", "map-zone-go"), name = literal(el("span", "map-zone-go-name")), meta = el("span", "map-zone-go-meta"); name.textContent = z.name;
        go.style.borderLeftColor = TYPES[z.type].color;
        meta.textContent = t(TYPES[z.type].label) + " · " + (z.geometry ? (distance(z) / 1000).toFixed(1) + " km" : t("경계 미등록·좌표 확인 필요"));
        meta.title = t("경계 중심까지의 거리"); go.append(name, meta);
        go.addEventListener("click", () => { if (z.geometry){ map.fitBounds(z.geometry.bounds, { padding:[40, 40], maxZoom:17 }); const shape = shapes.get(z.id); if (shape) shape.openPopup(); }
          else { item.replaceChildren(go, card(z, true)); } }); item.append(go); list.append(item);
      }
      if (!zones.length) list.append(el("li", "map-zone-empty", "표시할 보호구역이 없어요. 지역과 갈래 선택을 확인해 주세요."));
      if (zones.length > 50) list.append(el("li", "map-zone-empty", "화면 안과 가까운 시설 50곳을 보여 줍니다. 지도를 옮기면 목록이 바뀝니다."));
    }
    function draw(){
      layer.clearLayers(); shapes.clear();
      if (!shown || !data){ map.removeLayer(layer); map.removeLayer(renderer); renderList(); controls(); return; }
      for (const z of selected()){
        if (!z.geometry) continue;
        const shape = L.polygon(z.geometry.parts, { pane:"mapProtectionZonesPane", renderer, color:TYPES[z.type].color, weight:2, fillColor:TYPES[z.type].color, fillOpacity:.17, bubblingMouseEvents:false })
          .bindTooltip(() => card(z), { direction:"top", className:"map-zone-tooltip", sticky:true }).bindPopup(() => card(z, true)).addTo(layer);
        shapes.set(z.id, shape);
      }
      layer.addTo(map); renderList(); controls();
    }
    async function show(refreshing = false, atCenter = false){
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller; controls(); status.textContent = t("보호구역 자료를 받는 중…");
      try {
        const choices = await ensureCatalog(); if (destroyed || seq !== generation || controller.signal.aborted) return;
        const point = map.getCenter(), choice = atCenter ? choices.find(v => v.contains(point.lat, point.lng)) : choices.find(v => v.code === district.value);
        if (!choice) throw new Error("zones-no-district");
        province.value = choice.sido; fillDistricts(choice.code);
        const result = await load(choice.code, { signal:controller.signal, refresh:refreshing });
        if (destroyed || seq !== generation || controller.signal.aborted) return;
        map.closePopup(); loadedDistrict = choice; data = result; shown = true; draw();
        status.textContent = word("자료 받은 때: ", "Fetched: ") + new Date(data.fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST"
          + (!data.complete ? " · " + t("보호구역 목록 일부만 표시합니다.") : "") + (data.stale ? " · " + t("갱신이 지연되어 이전 자료를 표시합니다.") : "")
          + (data.inactive ? word(" · 사용 안 함 " + data.inactive + "건 제외", " · " + data.inactive + " inactive records excluded") : "")
          + (data.other ? word(" · 갈래·지역·관리번호 확인 " + data.other + "건 제외", " · " + data.other + " invalid records excluded") : "");
      } catch(error){
        if (!controller.signal.aborted && seq === generation){ status.textContent = t(failureText(error)) + (shown ? " " + t("앞서 받은 보호구역 표시를 유지합니다.") : "");
          if (/^HTTP \d{3}(?: - [\w-]+)?$/.test(error.upstream || "")) status.textContent += " · " + error.upstream; }
      } finally { if (seq === generation){ abort = null; controls(); } }
    }
    function clearAll(){ generation++; if (abort) abort.abort(); abort = null; shown = false; map.closePopup(); draw(); status.textContent = t("보호구역 표시를 지웠어요."); }
    toggle.addEventListener("click", () => { if (!panel.hidden){ clearAll(); panel.hidden = true; } else { panel.hidden = false; if (!shown) show(false, true); } controls(); });
    close.addEventListener("click", () => { panel.hidden = true; controls(); toggle.focus(); });
    center.addEventListener("click", () => show(false, true)); search.addEventListener("click", () => show()); refresh.addEventListener("click", () => show(true)); clear.addEventListener("click", clearAll);
    province.addEventListener("change", () => { fillDistricts(); show(); }); district.addEventListener("change", () => show());
    for (const check of checks.values()) check.addEventListener("change", () => { map.closePopup(); draw(); });
    fit.addEventListener("click", () => { const bounds = selected().filter(z => z.geometry).flatMap(z => z.geometry.bounds); if (bounds.length) map.fitBounds(bounds, { padding:[40, 40] }); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !listTimer) listTimer = setTimeout(renderList, 120); }, language = () => { map.closePopup(); draw(); };
    map.on("moveend", move); window.addEventListener("mni18nchange", language);
    fetch("/can-proxy-weather", { signal:capability.signal, cache:"no-store" }).then(r => r.ok ? r.text() : "").then(value => {
      if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("어린이·노인·장애인 보호구역의 경계를 지도에서 봅니다."); }
    }).catch(() => {}); controls();
    const api = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){ return shown && data ? t("출처: 경찰청 전국 보호구역 현황") + " · " + loadedDistrict.name + " · " + [...checks].filter(([, c]) => c.checked).map(([id]) => t(TYPES[id].label)).join(", ")
        + " · " + new Date(data.fetchedAt).toISOString().slice(0, 10) : ""; },
      destroy(){ destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(listTimer);
        map.off("moveend", move); window.removeEventListener("mni18nchange", language); layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); shapes.clear(); pane.remove(); panel.remove(); toggle.remove(); }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => api.destroy()); return api;
  }
  return { mount, geometry, normalize, rows, get, load, failureText, validDistrict, TYPES, SOURCE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNProtectionZones;
