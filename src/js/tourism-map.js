"use strict";
/* 한국관광공사 TourAPI. 주변 관광은 지도 중심 반경, 축제는 KST 월~일과 겹치는 일정이다.
   인증키는 런처에만 있다. 지도 이동으로 API를 다시 부르지 않고, 임시 층은 문서에 저장하지 않는다. */
const MNTourism = (() => {
  const TTL = 3600000, PAGE_SIZE = 100, cache = new Map();
  const TYPES = { "12":"관광지", "14":"문화시설", "28":"레포츠", "15":"축제·행사" };
  const text = value => value == null ? "" : String(value).trim();
  function date(value){
    const s = text(value);
    if (!/^\d{8}$/.test(s)) return "";
    const iso = s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6), at = Date.parse(iso + "T00:00:00Z");
    return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === iso ? s : "";
  }
  function week(now = Date.now()){
    const day = new Date(now + 9 * 3600000), today = day.toISOString().slice(0, 10).replace(/-/g, "");
    day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    const start = day.toISOString().slice(0, 10).replace(/-/g, ""); day.setUTCDate(day.getUTCDate() + 6);
    return { start, end:day.toISOString().slice(0, 10).replace(/-/g, ""), today };
  }
  const dayLabel = value => value ? value.slice(0, 4) + "." + value.slice(4, 6) + "." + value.slice(6) : "";
  function rows(json){
    const root = json && (json.response || json), code = text(root && root.header && root.header.resultCode);
    if (code === "03" || code === "0003") return { items:[], total:0 };
    if (code !== "00" && code !== "0000" || !root.body) throw new Error("tour-invalid-data");
    const raw = root.body.items, items = Array.isArray(raw) ? raw : raw && (Array.isArray(raw.item) ? raw.item : raw.item ? [raw.item] : []);
    return { items:(items || []).filter(r => r && typeof r === "object"), total:Number(root.body.totalCount) || 0 };
  }
  // TourAPI 사진 서버만 사용한다. 오래된 HTTP 주소도 같은 서버의 HTTPS로 표시한다.
  function photoUrl(value){
    try {
      const url = new URL(text(value));
      if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "tong.visitkorea.or.kr" || url.username || url.password
        || url.port || !/^\/cms\/resource\/.+\.(?:jpe?g|png|gif|webp|bmp)$/i.test(url.pathname) || url.search || url.hash) return "";
      url.protocol = "https:"; return url.href;
    } catch(_){ return ""; }
  }
  function place(row){
    const id = text(row.contentid), type = text(row.contenttypeid), title = text(row.title);
    if (!/^[1-9]\d{0,11}$/.test(id) || !TYPES[type] || !title) return null;
    const coord = value => /^\d+(?:\.\d+)?$/.test(text(value)) ? Number(value) : NaN;
    const lat = coord(row.mapy), lng = coord(row.mapx), located = lat >= 32.5 && lat <= 39 && lng >= 124 && lng <= 132.5;
    return { id, type, title, lat:located ? lat : null, lng:located ? lng : null,
      address:[text(row.addr1), text(row.addr2)].filter(Boolean).join(" "), tel:text(row.tel),
      photo:photoUrl(row.firstimage), thumbnail:photoUrl(row.firstimage2),
      start:date(row.eventstartdate), end:date(row.eventenddate), progress:text(row.progresstype) };
  }
  function normalize(items, request){
    const unique = new Map(); let excluded = 0;
    for (const row of items){
      const p = place(row);
      if (!p || (request.kind === "nearby" && p.type !== request.type)) continue;
      if (request.kind === "festivals"){
        if (p.type !== "15" || !p.start || !p.end || p.start > p.end || p.start > request.end || p.end < request.start) continue;
        if (/취소|연기/.test(p.progress)){ excluded++; continue; }
      }
      unique.set(p.id, p);
    }
    return { places:[...unique.values()], excluded };
  }
  // API의 줄바꿈·엔티티는 글자로 풀고, 어떤 HTML도 실행하거나 DOM에 넣지 않는다.
  function plain(value){
    return text(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?\s*>|<\/p\s*>/gi, "\n").replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi, entity => {
        const named = { "&amp;":"&", "&lt;":"<", "&gt;":">", "&quot;":'"', "&apos;":"'", "&nbsp;":" " };
        if (named[entity.toLowerCase()] != null) return named[entity.toLowerCase()];
        const n = entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
      }).trim().slice(0, 6000);
  }
  function homepage(value){
    const source = text(value), anchor = source.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    try {
      const url = new URL(plain(anchor ? anchor[1] : source));
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch(_){ return ""; }
  }
  async function get(path, { signal, refresh = false } = {}){
    if (signal) signal.throwIfAborted();
    const response = await fetch(path + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
    if (!response.ok){
      const reason = text(await response.text());
      throw new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "tour-fetch-failed");
    }
    const result = rows(await response.json());
    if (signal) signal.throwIfAborted();
    const stamp = Date.parse(response.headers && response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return { ...result, fetchedAt:Number.isFinite(stamp) ? Math.min(Date.now(), stamp) : Date.now() };
  }
  function remember(key, data){
    if (cache.size >= 30) cache.delete(cache.keys().next().value);
    cache.set(key, data); return data;
  }
  async function load(request, options = {}){
    if (options.signal) options.signal.throwIfAborted();
    const query = request.kind === "nearby"
      ? new URLSearchParams({ lat:Number(request.lat).toFixed(4), lng:Number(request.lng).toFixed(4), radius:request.radius, type:request.type }).toString()
      : new URLSearchParams({ start:request.start, end:request.end }).toString();
    const path = "/tourism-" + request.kind + "?" + query, old = cache.get(path);
    if (old && !options.refresh && Date.now() >= old.fetchedAt && Date.now() - old.fetchedAt < TTL) return old;
    const items = []; let fetchedAt = Date.now(), complete = false, total = 0;
    const max = request.kind === "nearby" ? 3 : 10;
    for (let page = 1; page <= max; page++){
      const result = await get(path + "&page=" + page, options);
      fetchedAt = Math.min(fetchedAt, result.fetchedAt); total = result.total; items.push(...result.items);
      if (!result.items.length || (total ? items.length >= total : result.items.length < PAGE_SIZE)){ complete = true; break; }
    }
    const data = { ...normalize(items, request), request:{ ...request }, fetchedAt, complete, total };
    if (options.signal) options.signal.throwIfAborted();
    return remember(path, data);
  }
  async function details(p, options = {}){
    if (options.signal) options.signal.throwIfAborted();
    const key = "detail:" + p.id + ":" + p.type, old = cache.get(key);
    if (old && Date.now() >= old.fetchedAt && Date.now() - old.fetchedAt < TTL) return old;
    const query = "?id=" + encodeURIComponent(p.id);
    const common = await get("/tourism-common" + query, options);
    const base = common.items.find(r => text(r.contentid) === p.id);
    if (!base) throw new Error("tour-no-details");
    let intro = {}, introError = null;
    try {
      const result = await get("/tourism-intro" + query + "&type=" + p.type, options);
      intro = result.items.find(r => text(r.contentid) === p.id && text(r.contenttypeid) === p.type) || {};
    } catch(error){ if (options.signal && options.signal.aborted) throw error; introError = error; }
    if (options.signal) options.signal.throwIfAborted();
    const data = { base, intro, introError, fetchedAt:common.fetchedAt };
    // 소개 조회가 실패하면 다음 선택에서 재시도한다.
    return introError ? data : remember(key, data);
  }
  function failureText(error){
    if (error.message === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (error.message === "bus-key-invalid") return "한국관광공사 국문 관광정보 서비스의 활용신청과 승인 상태를 확인해 주세요. 승인 직후에는 반영까지 시간이 걸릴 수 있어요.";
    if (error.message === "bus-quota") return "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    if (error.message === "tour-no-details") return "이 장소의 상세 정보가 없어요.";
    return "관광·축제 자료를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  function mount({ map, stage, toolRow, doc, t = value => value, movePanel = null }){
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const english = () => !!(window.MNI18N && window.MNI18N.lang === "en"), word = (ko, en) => english() ? en : ko;
    const toggle = button("관광·축제", "map-toolvis-tourism"); toolRow.append(toggle);
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "tourism");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-pressed", "false");
    const panel = el("section", "map-weather-panel map-tour-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("관광·축제"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "관광·축제"), close);
    const modes = el("div", "map-tour-modes"), nearby = button("주변 관광", "map-tour-nearby"), festivals = button("이번 주 축제", "map-tour-festivals"); modes.append(nearby, festivals);
    const filters = el("div", "map-weather-tools map-tour-filters"), category = el("select", "map-tour-category"), radius = el("select", "map-tour-radius");
    category.setAttribute("aria-label", t("관광 갈래")); radius.setAttribute("aria-label", t("관광 검색 반경"));
    for (const id of ["12", "14", "28"]){ const n = el("option", "", TYPES[id]); n.value = id; category.append(n); }
    for (const km of [1, 3, 5, 10, 20]){ const n = el("option", "", km + " km"); n.value = String(km * 1000); radius.append(n); }
    category.value = "12"; radius.value = "5000"; filters.append(category, radius);
    const tools = el("div", "map-weather-tools"), search = button("이 주변 찾기", "map-tour-search"), refresh = button("자료 갱신", "map-tour-refresh"), fit = button("전체 위치 보기", "map-tour-fit"), clear = button("지도에서 지우기", "map-tour-clear");
    tools.append(search, refresh, fit, clear);
    const summary = el("p", "map-tour-summary"), status = el("p", "map-weather-status map-tour-status"), list = el("ol", "map-tour-list");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const detailBox = el("section", "map-tour-details"); detailBox.hidden = true; detailBox.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "관광지는 지도 중심 반경, 축제는 한국 시간 월~일 일정입니다. 지도를 옮긴 뒤 '이 주변 찾기'를 누르세요. 축제 일정과 운영 정보는 방문 전 주최 측에 확인해 주세요.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 한국관광공사 TourAPI");
    source.href = "https://www.data.go.kr/data/15101578/openapi.do"; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, modes, filters, tools, summary, status, detailBox, list, note, foot); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapTourismPane"); pane.style.zIndex = "625"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapTourismPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController(), markerOf = new Map();
    let mode = "nearby", data = null, shown = false, destroyed = false, abort = null, detailAbort = null, generation = 0, detailGeneration = 0, selected = null, listTimer = 0, lastWeekAttempt = "";
    const period = p => p.start && p.end ? dayLabel(p.start) + " ~ " + dayLabel(p.end) : "";
    const festivalState = p => p.end < week().today ? t("행사 종료") : p.start > week().today ? t("개최 예정") : t("진행 중");
    const distance = p => p.lat == null ? Infinity : map.getCenter().distanceTo([p.lat, p.lng]);
    const distanceLabel = p => Number.isFinite(distance(p)) ? (distance(p) / 1000).toFixed(1) + " km" : t("위치 미등록");
    function controls(){
      nearby.setAttribute("aria-pressed", String(mode === "nearby")); festivals.setAttribute("aria-pressed", String(mode === "festivals"));
      filters.hidden = mode !== "nearby"; search.hidden = mode !== "nearby"; search.disabled = refresh.disabled = !!abort;
      fit.disabled = !shown || !data || !data.places.some(p => p.lat != null);
      toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown));
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    }
    function row(box, label, value){
      const clean = plain(value); if (!clean) return;
      const n = el("div", "map-tour-detail-row"), content = el("span"); content.textContent = clean; content.setAttribute("data-i18n-ignore", "");
      n.append(el("span", "map-tour-detail-key", label), content); box.append(n);
    }
    function detailHeader(p){
      detailBox.replaceChildren(); detailBox.hidden = false;
      const top = el("div", "map-tour-detail-heading"), name = el("strong"), hide = button("닫기"); name.textContent = p.title; name.setAttribute("data-i18n-ignore", "");
      hide.addEventListener("click", () => { selected = null; detailGeneration++; if (detailAbort) detailAbort.abort(); detailAbort = null; detailBox.hidden = true; });
      top.append(name, hide); detailBox.append(top); row(detailBox, "주소", p.address); row(detailBox, "일정", period(p));
      if (p.type === "15") row(detailBox, "상태", festivalState(p)); row(detailBox, "전화", p.tel);
    }
    async function openDetails(p){
      selected = p; panel.hidden = false; controls(); detailHeader(p);
      const pending = el("p", "map-weather-status", "상세 정보를 받는 중…"); detailBox.append(pending);
      if (detailAbort) detailAbort.abort(); const controller = new AbortController(); detailAbort = controller; const seq = ++detailGeneration;
      try {
        const result = await details(p, { signal:controller.signal });
        if (destroyed || seq !== detailGeneration || controller.signal.aborted) return;
        pending.remove();
        const info = result.intro, fields = p.type === "15"
          ? [["장소", "eventplace"], ["시간", "playtime"], ["요금", "usetimefestival"], ["주최", "sponsor1"], ["문의", "sponsor1tel"]]
          : p.type === "14" ? [["시간", "usetimeculture"], ["요금", "usefee"], ["휴무", "restdateculture"], ["주차", "parkingculture"], ["문의", "infocenterculture"]]
          : p.type === "28" ? [["시간", "usetimeleports"], ["요금", "usefeeleports"], ["휴무", "restdateleports"], ["주차", "parkingleports"], ["문의", "infocenterleports"]]
          : [["시간", "usetime"], ["휴무", "restdate"], ["주차", "parking"], ["체험 안내", "expguide"], ["문의", "infocenter"]];
        for (const [label, field] of fields) row(detailBox, label, info[field]);
        const overview = el("p", "map-tour-overview"); overview.textContent = plain(result.base.overview); overview.setAttribute("data-i18n-ignore", ""); if (overview.textContent) detailBox.append(overview);
        const url = homepage(result.base.homepage) || homepage(info.eventhomepage);
        if (url){ const link = el("a", "map-tour-homepage", "공식 홈페이지"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; detailBox.append(link); }
        if (result.introError) detailBox.append(el("p", "map-weather-status", failureText(result.introError)));
      } catch(error){ if (!controller.signal.aborted && seq === detailGeneration) pending.textContent = t(failureText(error)); }
      finally { if (seq === detailGeneration) detailAbort = null; }
    }
    function tooltipOf(p){
      const box = el("div", "map-tour-tip"), body = el("div", "map-tour-tip-body"), heading = el("div", "map-tour-tip-heading");
      box.setAttribute("data-i18n-ignore", ""); box.setAttribute("lang", word("ko", "en"));
      const icon = el("span", "map-tour-tip-icon"); icon.setAttribute("aria-hidden", "true");
      const name = el("strong", "map-tour-tip-name"); name.textContent = p.title;
      heading.append(icon, name);
      const meta = el("div", "map-tour-tip-meta"), category = el("span", "map-tour-tip-category", TYPES[p.type]);
      const distance = el("span", "map-tour-tip-distance", distanceLabel(p)); distance.title = t("지도 중심 기준");
      const pin = el("i", "map-tour-tip-pin"); pin.setAttribute("aria-hidden", "true"); distance.append(pin);
      meta.append(category, distance); body.append(heading, meta);
      if (p.type === "15"){
        box.classList.add("map-tour-tip-festival");
        body.append(el("div", "map-tour-tip-schedule", festivalState(p) + " · " + period(p)));
      }
      const credit = el("div", "map-tour-tip-credit", "사진: 한국관광공사 TourAPI"); credit.hidden = true;
      const urls = [...new Set([p.photo, p.thumbnail].filter(Boolean))];
      if (urls.length){
        const media = el("div", "map-tour-tip-media"), photo = el("img", "map-tour-tip-photo"); media.hidden = true;
        photo.alt = p.title; photo.decoding = "async"; photo.referrerPolicy = "no-referrer";
        const position = () => {
          const tooltip = markerOf.get(p.id)?.getTooltip?.();
          // update()는 내용 함수를 다시 호출하므로 로드된 사진을 유지한 채 위치만 보정한다.
          if (!destroyed && box.isConnected && tooltip?.getElement?.()?.contains(box)) tooltip.setLatLng(tooltip.getLatLng());
        };
        let index = 0;
        photo.addEventListener("load", () => { media.hidden = false; credit.hidden = false; icon.hidden = true; position(); });
        photo.addEventListener("error", () => {
          if (++index < urls.length){ photo.src = urls[index]; return; }
          // 둘 다 실패하면 깨진 이미지 대신 이름·갈래·거리만 남긴다.
          media.hidden = true; credit.hidden = true; icon.hidden = false; position();
        });
        media.append(photo); box.append(media); photo.src = urls[0];
      }
      body.append(credit); box.append(body);
      return box;
    }
    function popupOf(p){
      const box = el("div", "map-tour-popup"), name = el("strong", "map-tour-popup-name"); name.textContent = p.title; name.setAttribute("data-i18n-ignore", ""); box.append(name);
      row(box, "주소", p.address); row(box, "일정", period(p)); if (p.type === "15") row(box, "상태", festivalState(p));
      const more = button("상세보기"); more.addEventListener("click", () => openDetails(p)); box.append(more); return box;
    }
    function renderList(){
      listTimer = 0; list.replaceChildren(); if (!shown || !data){ summary.textContent = ""; return; }
      const all = data.places, bounds = map.getBounds(), visible = all.filter(p => p.lat != null && bounds.contains([p.lat, p.lng])).length;
      const r = data.request, missing = all.filter(p => p.lat == null).length;
      summary.textContent = (r.kind === "festivals" ? t(r.start === week().start ? "이번 주 축제" : "이전 주 축제") + " · " + dayLabel(r.start) + " ~ " + dayLabel(r.end) + " KST" : t(TYPES[r.type]) + " · " + r.radius / 1000 + " km")
        + word(" · " + all.length + "곳 (화면 안 " + visible + "곳)", " · " + all.length + " places (" + visible + " in view)")
        + (missing ? word(" · 위치 미등록 " + missing + "곳", " · " + missing + " without coordinates") : "");
      const sorted = [...all].sort((a, b) => distance(a) - distance(b) || a.title.localeCompare(b.title));
      for (const p of sorted.slice(0, 50)){
        const item = el("li"), go = button("", "map-tour-go"), name = el("span", "map-tour-go-name"), meta = el("span", "map-tour-go-meta");
        name.textContent = p.title; name.setAttribute("data-i18n-ignore", ""); go.style.borderLeftColor = p.type === "15" ? "#8b4ec6" : "#1684a0";
        meta.textContent = distanceLabel(p) + (p.type === "15" ? " · " + festivalState(p) + "\n" + period(p) : " · " + p.address); meta.setAttribute("data-i18n-ignore", "");
        go.append(name, meta); go.addEventListener("click", () => {
          if (p.lat != null){ map.setView([p.lat, p.lng], Math.max(14, map.getZoom())); const marker = markerOf.get(p.id); if (marker) marker.openPopup(); }
          openDetails(p);
        }); item.append(go); list.append(item);
      }
      if (!all.length) list.append(el("li", "map-tour-empty", r.kind === "nearby" ? "이 반경에 등록된 관광 장소가 없어요. 반경이나 갈래를 바꿔 보세요." : "이번 주에 등록된 축제·행사가 없어요."));
      if (all.length > 50) list.append(el("li", "map-tour-empty", "가까운 50곳을 보여 줍니다. 지도를 옮기면 목록이 바뀝니다."));
    }
    function draw(){
      layer.clearLayers(); markerOf.clear();
      if (!shown || !data){ map.removeLayer(layer); map.removeLayer(renderer); renderList(); controls(); return; }
      for (const p of data.places){
        if (p.lat == null) continue;
        const marker = L.circleMarker([p.lat, p.lng], { pane:"mapTourismPane", renderer, radius:p.type === "15" ? 7 : 6, weight:2, color:"#fff", fillColor:p.type === "15" ? "#8b4ec6" : "#1684a0", fillOpacity:.9 })
          .bindTooltip(() => tooltipOf(p), { direction:"top", offset:[0, -6], className:"map-tour-tooltip" }).bindPopup(() => popupOf(p)).addTo(layer);
        marker.on("click", () => openDetails(p)); markerOf.set(p.id, marker);
      }
      layer.addTo(map); renderList(); controls();
    }
    async function show(refreshing = false){
      const center = map.getCenter(), dates = week();
      if (mode === "nearby" && !(center.lat >= 32.5 && center.lat <= 39 && center.lng >= 124 && center.lng <= 132.5)){
        status.textContent = t("주변 관광은 대한민국 지도로 옮긴 뒤 찾아 주세요."); return;
      }
      const request = mode === "nearby" ? { kind:mode, lat:center.lat, lng:center.lng, radius:radius.value, type:category.value } : { kind:mode, start:dates.start, end:dates.end };
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller;
      status.textContent = t("관광·축제 자료를 받는 중…"); controls();
      try {
        const result = await load(request, { signal:controller.signal, refresh:refreshing });
        if (destroyed || seq !== generation || controller.signal.aborted) return;
        detailGeneration++; if (detailAbort) detailAbort.abort(); detailAbort = null; selected = null; detailBox.hidden = true;
        map.closePopup(); data = result; shown = true; draw();
        status.textContent = word("자료 받은 때: ", "Fetched: ") + new Date(data.fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST"
          + (!data.complete ? " · " + t("목록 일부만 표시합니다. 주변 관광은 반경을 줄여 다시 찾아 주세요.") : "")
          + (data.excluded ? word(" · 취소·연기 " + data.excluded + "건 제외", " · " + data.excluded + " cancelled or postponed events excluded") : "");
      } catch(error){
        if (!controller.signal.aborted && seq === generation) status.textContent = t(failureText(error)) + (shown ? " " + t("앞서 받은 관광·축제 표시를 유지합니다.") : "");
      } finally { if (seq === generation){ abort = null; controls(); } }
    }
    function clearAll(){
      generation++; detailGeneration++; if (abort) abort.abort(); if (detailAbort) detailAbort.abort(); abort = detailAbort = null;
      shown = false; selected = null; detailBox.hidden = true; map.closePopup(); draw(); status.textContent = t("관광·축제 표시를 지웠어요.");
    }
    toggle.addEventListener("click", () => {
      if (!panel.hidden){ clearAll(); panel.hidden = true; }
      else { panel.hidden = false; if (!shown) show(); }
      controls();
    });
    close.addEventListener("click", () => { panel.hidden = true; controls(); toggle.focus(); });
    nearby.addEventListener("click", () => { mode = "nearby"; controls(); show(); });
    festivals.addEventListener("click", () => { mode = "festivals"; controls(); show(); });
    search.addEventListener("click", () => show()); refresh.addEventListener("click", () => show(true)); clear.addEventListener("click", clearAll);
    for (const select of [category, radius]) select.addEventListener("change", () => show());
    fit.addEventListener("click", () => {
      const points = data && data.places.filter(p => p.lat != null).map(p => [p.lat, p.lng]);
      if (points && points.length) map.fitBounds(points, { padding:[36, 36], maxZoom:14 });
    });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !listTimer) listTimer = setTimeout(renderList, 120); };
    const language = () => { map.closePopup(); draw(); if (selected) openDetails(selected); };
    map.on("moveend", move); window.addEventListener("mni18nchange", language);
    // 주가 넘어가면 지난 주를 '이번 주'로 남겨 두지 않는다. 숨긴 층에서는 호출하지 않는다.
    const weekTimer = setInterval(() => {
      if (shown && data && data.request.kind === "festivals"){
        if (data.request.start !== week().start && lastWeekAttempt !== week().start && !abort){ lastWeekAttempt = week().start; mode = "festivals"; renderList(); show(); }
        else renderList();
      }
    }, 60000);
    fetch("/can-proxy-weather", { cache:"no-store", signal:capability.signal }).then(r => r.ok ? r.text() : "").then(value => {
      if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("지도 주변 관광지와 이번 주 전국 축제를 봅니다."); }
    }).catch(() => {});
    controls();
    const controller = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){ return shown && data ? (data.request.kind === "festivals" ? t(data.request.start === week().start ? "이번 주 축제" : "이전 주 축제") + " " + dayLabel(data.request.start) + "~" + dayLabel(data.request.end) + " KST" : t(TYPES[data.request.type]) + " " + data.request.radius / 1000 + " km") + " · " + t("출처: 한국관광공사 TourAPI") : ""; },
      destroy(){
        destroyed = true; generation++; detailGeneration++; if (abort) abort.abort(); if (detailAbort) detailAbort.abort(); capability.abort();
        clearTimeout(listTimer); clearInterval(weekTimer); map.off("moveend", move); window.removeEventListener("mni18nchange", language);
        layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); pane.remove(); panel.remove(); toggle.remove(); markerOf.clear();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => controller.destroy()); return controller;
  }
  return { mount, date, week, dayLabel, rows, photoUrl, place, normalize, plain, homepage, get, load, details, failureText, TYPES };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNTourism;
