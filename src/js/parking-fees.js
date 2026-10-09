"use strict";
/* 전국주차장정보표준데이터. 전국 목록을 페이지 끝까지 받은 뒤 지도 중심 거리로 비교한다.
   시간/요금 누락은 무료로 바꾸지 않는다. 일일권은 자동 상한으로 가정하지 않는다.
   API 키는 런처에만 두며 지도 이동·시간 변경은 받은 목록을 재사용한다. */
const MNParkingFees = (() => {
  const SOURCE = "https://www.data.go.kr/data/15012896/standard.do";
  const TTL = 7 * 86400000, MAX_PAGES = 50;
  let memory = null;
  const text = v => v == null ? "" : String(v).trim();
  function number(value){
    const source = text(value).replace(/\s*(?:분|원|면)$/, "");
    if (source.includes(",") && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(source)) return null;
    const s = source.replace(/,/g, "");
    if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
    const n = Number(s); return Number.isFinite(n) && n <= 100000000 ? n : null;
  }
  function rows(json){
    const root = json && (json.response || json), code = text(root && root.header && root.header.resultCode);
    if (["03", "0003"].includes(code)) return { items:[], total:0 };
    if (!["00", "0000"].includes(code) || !root.body) throw new Error("parking-invalid-data");
    const raw = root.body.items, item = Array.isArray(raw) ? raw : raw && raw.item;
    const items = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
    const total = Number(root.body.totalCount);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("parking-invalid-data");
    return { items:items.filter(r => r && typeof r === "object"), total };
  }
  function lot(row){
    const lat = number(row.latitude), lng = number(row.longitude), capacity = number(row.prkcmprt);
    const located = lat != null && lng != null && lat >= 32.5 && lat <= 39 && lng >= 124 && lng <= 132.5;
    return { id:text(row.prkplceNo), name:text(row.prkplceNm), kind:text(row.prkplceSe), type:text(row.prkplceType),
      address:text(row.rdnmadr) || text(row.lnmadr), lat:located ? lat : null, lng:located ? lng : null,
      capacity:capacity > 0 && Number.isInteger(capacity) ? capacity : null, feeInfo:text(row.parkingchrgeInfo),
      basicTime:number(row.basicTime), basicFee:number(row.basicCharge), unitTime:number(row.addUnitTime), unitFee:number(row.addUnitCharge),
      dayTicket:number(row.dayCmmtkt), dayTicketTime:text(row.dayCmmtktAdjTime), monthly:number(row.monthCmmtkt),
      days:text(row.operDay), hours:[[text(row.weekdayOperOpenHhmm), text(row.weekdayOperColseHhmm)],
        [text(row.satOperOperOpenHhmm), text(row.satOperCloseHhmm)], [text(row.holidayOperOpenHhmm), text(row.holidayCloseOpenHhmm)]],
      payment:text(row.metpay), remarks:text(row.spcmnt), manager:text(row.institutionNm), phone:text(row.phoneNumber),
      accessible:text(row.pwdbsPpkZoneYn), restriction:text(row.enforceSe), date:text(row.referenceDate) };
  }
  function normalize(items){
    const byId = new Map();
    for (const row of items){
      const p = lot(row); if (!p.name) continue;
      const id = p.id || [p.name, p.address, p.lat, p.lng].join("|");
      const old = byId.get(id); if (!old || p.date > old.date || !old.lat && p.lat) byId.set(id, { ...p, id });
    }
    return [...byId.values()];
  }
  // 단위요금은 시작한 단위까지 올림한다. 혼합요금·빈 추가요금은 계산 불가로 남긴다.
  function estimate(p, minutes = 120){
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null;
    if (p.feeInfo === "무료") return 0;
    if (p.feeInfo !== "유료" || p.basicTime == null || p.basicFee == null || p.basicTime < 0 || p.basicFee < 0) return null;
    if (p.basicTime > 0 && minutes <= p.basicTime) return p.basicFee;
    if (!(p.unitTime > 0) || p.unitFee == null || p.unitFee < 0 || p.basicFee === 0 && p.unitFee === 0) return null;
    return p.basicFee + Math.ceil(Math.max(0, minutes - p.basicTime) / p.unitTime) * p.unitFee;
  }
  function hours(p, day = 0){
    const labels = ["평일", "토요일", "공휴일"], pair = p.hours && p.hours[day];
    if (p.days && !p.days.split(/[+·,\s]+/).includes(labels[day])) return { state:"closed", label:"운영요일 아님" };
    if (!pair || !pair.every(v => /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(v))) return { state:"unknown", label:"운영시간 미등록" };
    if (pair[0] === "00:00" && ["23:59", "24:00"].includes(pair[1])) return { state:"all", label:"24시간" };
    if (pair[0] === pair[1]) return { state:"unknown", label:"운영시간 확인 필요" };
    return { state:"hours", label:pair[0] + "–" + pair[1] + (pair[1] < pair[0] ? " (익일)" : "") };
  }
  function distance(a, b){
    const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function nearby(lots, center, radius = 3000, minutes = 120, sort = "fee", freeOnly = false){
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || center.lat < 32.5 || center.lat > 39 || center.lng < 124 || center.lng > 132.5) return [];
    return lots.filter(p => p.lat != null && p.lng != null).map(p => ({ lot:p, distance:distance(center, p), amount:estimate(p, minutes) }))
      .filter(p => p.distance <= radius && (!freeOnly || p.lot.feeInfo === "무료"))
      .sort((a, b) => (sort === "distance" ? a.distance - b.distance : (a.amount == null ? Infinity : a.amount) - (b.amount == null ? Infinity : b.amount))
        || a.distance - b.distance || a.lot.name.localeCompare(b.lot.name));
  }
  // 전국 자료는 localStorage 용량을 넘을 수 있어 별도 IndexedDB에 담는다. 저장 실패 시 메모리로 계속 사용한다.
  async function persisted(write){
    if (typeof indexedDB === "undefined") return null;
    return new Promise(resolve => {
      let db = null, settled = false;
      const finish = value => { if (settled) return; settled = true; if (db) db.close(); resolve(value); };
      let open; try { open = indexedDB.open("ClassDockParking", 1); } catch(_){ finish(null); return; }
      open.onupgradeneeded = () => { open.result.createObjectStore("catalog"); };
      open.onerror = open.onblocked = () => finish(null);
      open.onsuccess = () => {
        db = open.result; if (settled){ db.close(); return; }
        try {
          const transaction = db.transaction("catalog", write ? "readwrite" : "readonly"), store = transaction.objectStore("catalog");
          const request = write ? store.put(write, "national") : store.get("national"); let value = null;
          request.onsuccess = () => { value = request.result; };
          transaction.oncomplete = () => finish(write || value);
          transaction.onerror = transaction.onabort = () => finish(null);
        } catch(_){ finish(null); }
      };
    });
  }
  function fresh(saved){
    return saved && saved.version === 1 && saved.complete && !saved.stale && Array.isArray(saved.lots)
      && Number.isFinite(saved.fetchedAt) && Date.now() >= saved.fetchedAt && Date.now() - saved.fetchedAt < TTL;
  }
  async function get(page, { signal, refresh = false } = {}){
    if (signal) signal.throwIfAborted();
    const response = await fetch("/parking-fees?page=" + page + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
    if (!response.ok){ const reason = text(await response.text()), error = new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "parking-fetch-failed");
      error.upstream = text(response.headers && response.headers.get("X-ClassDock-Bus-Upstream")); throw error; }
    const result = rows(await response.json()); if (signal) signal.throwIfAborted();
    const at = Date.parse(response.headers && response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return { ...result, fetchedAt:Number.isFinite(at) ? Math.min(Date.now(), at) : Date.now(), stale:response.headers && response.headers.get("X-ClassDock-Bus-Stale") === "1" };
  }
  async function load(options = {}){
    if (options.signal) options.signal.throwIfAborted();
    if (!options.refresh){
      const saved = fresh(memory) ? memory : await persisted();
      if (options.signal) options.signal.throwIfAborted();
      if (fresh(saved)){ memory = saved; return saved; }
    }
    const all = []; let total = Infinity, fetchedAt = Infinity, stale = false;
    for (let page = 1; page <= MAX_PAGES && all.length < total; page++){
      const result = await get(page, options); total = result.total; fetchedAt = Math.min(fetchedAt, result.fetchedAt);
      stale = stale || result.stale; all.push(...result.items);
      if (options.onProgress) options.onProgress(all.length, total);
      if (!result.items.length) break;
    }
    const data = { version:1, lots:normalize(all), total, fetchedAt, stale, complete:all.length >= total };
    if (options.signal) options.signal.throwIfAborted();
    if (fresh(data)){ memory = data; await persisted(data); }
    if (options.signal) options.signal.throwIfAborted(); return data;
  }
  function failureText(error){
    if (error.message === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (error.message === "bus-key-invalid") return "전국주차장정보표준데이터 API의 활용신청 승인과 인증키를 확인해 주세요.";
    if (error.message === "bus-quota") return "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    return "주차장 자료를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  function mount({ map, stage, toolRow, doc, t = v => v, movePanel = null }){
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const literal = n => { n.setAttribute("data-i18n-ignore", ""); n.setAttribute("lang", "ko"); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const select = (label, cls, options, value) => {
      const box = el("label", "map-parking-field"), node = el("select", cls); node.setAttribute("aria-label", t(label));
      for (const [v, name] of options){ const option = el("option", "", name); option.value = String(v); node.append(option); }
      node.value = String(value); box.append(el("span", "", label), node); return { box, node };
    };
    const toggle = button("주차요금", "map-toolvis-parking-fees"); toolRow.append(toggle);
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "parkingFees");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    const panel = el("section", "map-weather-panel map-parking-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("주차요금 비교"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "주차요금 비교"), close);
    const duration = select("주차 시간", "map-parking-duration", [[30, "30분"], [60, "1시간"], [120, "2시간"], [180, "3시간"], [240, "4시간"], [360, "6시간"], [480, "8시간"], [720, "12시간"]], 120);
    const radius = select("비교 반경", "map-parking-radius", [[1000, "1 km"], [3000, "3 km"], [5000, "5 km"], [10000, "10 km"]], 3000);
    const order = select("정렬", "map-parking-order", [["fee", "요금 낮은 순"], ["distance", "가까운 순"]], "fee");
    const day = select("운영시간 기준", "map-parking-day", [[0, "평일"], [1, "토요일"], [2, "공휴일"]], 0);
    const freeLabel = el("label", "map-parking-free-label"), free = el("input", "map-parking-free"); free.type = "checkbox"; freeLabel.append(free, el("span", "", "무료만"));
    const filters = el("div", "map-parking-filters"); filters.append(duration.box, radius.box, order.box, day.box, freeLabel);
    const tools = el("div", "map-weather-tools"), refresh = button("자료 갱신", "map-parking-refresh"), clear = button("지도에서 지우기", "map-parking-clear"); tools.append(refresh, clear);
    const summary = el("p", "map-parking-summary"), status = el("p", "map-weather-status map-parking-status"), list = el("ol", "map-parking-list");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "지도 중심에서 가까운 주차장을 비교합니다. 예상 요금은 기본·추가 요금 기준이며 할인·일일권·특수 조건은 별도입니다. 주차면수는 전체 규모입니다.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 전국주차장정보표준데이터"); source.href = SOURCE; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, filters, tools, summary, status, list, note, foot); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel); if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapParkingFeesPane"); pane.style.zIndex = "440"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapParkingFeesPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController(), markers = new Map(), entries = new Map();
    let data = null, shown = false, destroyed = false, abort = null, generation = 0, timer = 0;
    const timeLabel = () => Number(duration.node.value) < 60 ? word(duration.node.value + "분", duration.node.value + " min") : word(Number(duration.node.value) / 60 + "시간", Number(duration.node.value) / 60 + " h");
    const amountLabel = amount => amount == null ? t("요금 확인 필요") : amount === 0 ? t("무료") : amount.toLocaleString(word("ko-KR", "en-GB")) + word("원", " KRW");
    const color = p => p.lot.feeInfo === "무료" ? "#178466" : p.amount == null ? "#77818e" : "#3066c5";
    const items = () => data ? nearby(data.lots, map.getCenter(), Number(radius.node.value), Number(duration.node.value), order.node.value, free.checked) : [];
    function controls(){
      toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown)); toggle.setAttribute("aria-expanded", String(!panel.hidden)); refresh.disabled = !!abort;
    }
    function schedule(p){ const h = hours(p, Number(day.node.value)); return h.state === "hours" ? h.label.replace(" (익일)", word(" (익일)", " (next day)")) : t(h.label); }
    function card(entry, detail = false){
      const p = entry.lot, box = el("div", "map-parking-card"); box.style.setProperty("--parking-color", color(entry));
      const name = literal(el("strong", "map-parking-name")); name.textContent = p.name;
      const price = el("div", "map-parking-price"), caption = el("span"); caption.textContent = timeLabel() + word(" 예상", " estimate");
      price.append(caption, el("b", "", amountLabel(entry.amount))); box.append(name, price);
      const meta = el("p"); meta.textContent = (entry.distance / 1000).toFixed(1) + " km · " + schedule(p) + (p.capacity ? word(" · 총 " + p.capacity + "면", " · " + p.capacity + " total spaces") : ""); box.append(meta);
      if (!detail) return box;
      const line = (label, value) => { if (!value) return; const row = el("p"), content = literal(el("span")); content.textContent = value; row.append(el("span", "map-parking-key", label), content); box.append(row); };
      line("주소", p.address); line("주차장 구분", [p.kind, p.type, p.feeInfo].filter(Boolean).join(" · "));
      if (p.feeInfo === "유료" && p.basicTime != null && p.basicFee != null) line("기본요금", p.basicTime + word("분 / ", " min / ") + amountLabel(p.basicFee));
      if (p.unitTime > 0 && p.unitFee != null) line("추가요금", p.unitTime + word("분마다 ", " min: ") + amountLabel(p.unitFee));
      if (p.dayTicket > 0) line("일일권", amountLabel(p.dayTicket) + word(" · 적용 조건 확인", " · check conditions"));
      if (p.monthly > 0) line("월정기권", amountLabel(p.monthly));
      line("운영요일", p.days);
      for (let i = 0; i < 3; i++){ const h = hours(p, i); line(["평일", "토요일", "공휴일"][i], h.state === "hours" ? h.label : t(h.label)); }
      line("결제방법", p.payment); line("특기사항", p.remarks); line("부제 시행", p.restriction); line("관리기관", p.manager); line("전화번호", p.phone);
      if (["Y", "N"].includes(p.accessible)) line("장애인 전용 구역", p.accessible === "Y" ? t("있음") : t("없음"));
      line("데이터 기준일", p.date); box.append(el("p", "map-weather-note", "기본·추가 요금 기준 예상입니다. 할인·일일권·특수 조건은 별도로 확인해 주세요.")); return box;
    }
    function draw(){
      clearTimeout(timer); timer = 0; list.replaceChildren();
      if (!shown || !data){ layer.clearLayers(); markers.clear(); entries.clear(); map.removeLayer(layer); map.removeLayer(renderer); summary.textContent = ""; controls(); return; }
      const all = items(), selected = all.slice(0, 200), minutes = timeLabel();
      const selectedIds = new Set(selected.map(entry => entry.lot.id));
      // 팝업 자동 이동도 moveend를 발생시킨다. 같은 표시를 보존해 열린 상세를 지우지 않는다.
      // 열어 둔 한 곳은 반경·정렬 범위가 달라져도 닫기 전까지 유지한다.
      for (const [id, marker] of markers){
        if (!selectedIds.has(id) && !marker.isPopupOpen()){ layer.removeLayer(marker); markers.delete(id); entries.delete(id); }
      }
      summary.textContent = word("지도 중심 ", "Map center · ") + (Number(radius.node.value) / 1000) + " km · " + minutes + word(" 예상 · ", " estimate · ")
        + all.length + word("곳", " places") + (all.length > selected.length ? word(" · 상위 200곳 표시", " · first 200 shown") : "");
      for (const entry of selected){
        const p = entry.lot; entries.set(p.id, entry);
        let marker = markers.get(p.id);
        if (marker){
          marker.setStyle({ fillColor:color(entry) });
          const position = marker.getLatLng(); if (position.lat !== p.lat || position.lng !== p.lng) marker.setLatLng([p.lat, p.lng]);
        }
        else {
          marker = L.circleMarker([p.lat, p.lng], { pane:"mapParkingFeesPane", renderer, radius:8, color:"#fff", weight:2, fillColor:color(entry), fillOpacity:1, bubblingMouseEvents:false })
            .bindTooltip(() => card(entries.get(p.id) || entry), { direction:"top", offset:[0, -8], className:"map-parking-tooltip" })
            .bindPopup(() => card(entries.get(p.id) || entry, true), { className:"map-parking-popup", maxHeight:260, minWidth:220, maxWidth:320 }).addTo(layer);
          markers.set(p.id, marker);
        }
        const item = el("li"), go = button("", "map-parking-go"), name = literal(el("span", "map-parking-go-name")), price = el("b", "map-parking-go-price"), meta = el("span", "map-parking-go-meta");
        name.textContent = p.name; price.textContent = amountLabel(entry.amount); price.style.color = color(entry);
        meta.textContent = (entry.distance / 1000).toFixed(1) + " km · " + schedule(p) + (p.capacity ? word(" · 총 " + p.capacity + "면", " · " + p.capacity + " total spaces") : "");
        go.style.borderLeftColor = color(entry); go.append(name, price, meta);
        go.addEventListener("click", () => { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate:false }); draw(); const current = markers.get(p.id); if (current) current.openPopup(); });
        item.append(go); list.append(item);
      }
      if (!all.length) list.append(el("li", "map-parking-empty", "이 반경에서 등록된 주차장을 찾지 못했어요. 반경을 넓히거나 무료만 선택을 해제해 주세요."));
      layer.addTo(map); controls();
    }
    async function show(refreshing = false){
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller; controls();
      status.textContent = t("주차장 자료를 받는 중… 처음에는 전국 목록을 받아 잠시 걸릴 수 있어요.");
      try {
        const result = await load({ signal:controller.signal, refresh:refreshing, onProgress:(got, total) => {
          if (!destroyed && seq === generation) status.textContent = word("주차장 자료 받는 중: ", "Loading parking lots: ") + got.toLocaleString() + " / " + total.toLocaleString();
        } });
        if (destroyed || seq !== generation || controller.signal.aborted) return;
        map.closePopup(); data = result; shown = true; draw();
        const missing = data.lots.filter(p => p.lat == null).length;
        status.textContent = word("자료 받은 때: ", "Fetched: ") + new Date(data.fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST"
          + (!data.complete ? " · " + t("주차장 목록 일부만 표시합니다.") : "") + (data.stale ? " · " + t("갱신이 지연되어 이전 자료를 표시합니다.") : "")
          + (missing ? word(" · 전국 좌표 미등록 " + missing + "곳 제외", " · " + missing + " nationwide records without coordinates excluded") : "");
      } catch(error){
        if (!controller.signal.aborted && seq === generation){ status.textContent = t(failureText(error)) + (shown ? " " + t("앞서 받은 주차장 표시를 유지합니다.") : "");
          if (/^HTTP \d{3}(?: - [\w-]+)?$/.test(error.upstream || "")) status.textContent += " · " + error.upstream; }
      } finally { if (seq === generation){ abort = null; controls(); } }
    }
    function clearAll(){ generation++; if (abort) abort.abort(); abort = null; shown = false; map.closePopup(); draw(); status.textContent = t("주차장 표시를 지웠어요."); }
    toggle.addEventListener("click", () => { if (!panel.hidden){ clearAll(); panel.hidden = true; } else { panel.hidden = false; if (!shown) show(); } controls(); });
    close.addEventListener("click", () => { panel.hidden = true; controls(); toggle.focus(); });
    refresh.addEventListener("click", () => show(true)); clear.addEventListener("click", clearAll);
    for (const node of [duration.node, radius.node, order.node, day.node, free]) node.addEventListener("change", () => { map.closePopup(); draw(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !timer) timer = setTimeout(draw, 120); }, language = () => { map.closePopup(); draw(); };
    map.on("moveend", move); map.on("popupclose", move); window.addEventListener("mni18nchange", language);
    fetch("/can-proxy-weather", { signal:capability.signal, cache:"no-store" }).then(r => r.ok ? r.text() : "").then(value => {
      if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("주변 주차장 요금·운영시간·총 주차면수를 비교합니다."); }
    }).catch(() => {}); controls();
    const api = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){ return shown && data ? t("출처: 전국주차장정보표준데이터") + " · " + timeLabel() + word(" 예상", " estimate")
        + " · " + new Date(data.fetchedAt).toISOString().slice(0, 10) + (!data.complete ? " · " + t("주차장 목록 일부만 표시합니다.") : "") : ""; },
      destroy(){ destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(timer);
        map.off("moveend", move); map.off("popupclose", move); window.removeEventListener("mni18nchange", language); layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); markers.clear(); entries.clear(); pane.remove(); panel.remove(); toggle.remove(); }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => api.destroy()); return api;
  }
  return { mount, number, rows, lot, normalize, estimate, hours, distance, nearby, fresh, get, load, failureText, SOURCE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNParkingFees;
