"use strict";
/* 지도 '휴게소' 층(MNRestAreas). 한국도로공사 고속도로 공공데이터 포털(data.ex.co.kr)을 런처 /rest-areas 로 받는다.
   키는 공공데이터포털 키와 다른 '고속도로 공공데이터' 키이고 런처에만 둔다.
   2026-10-10 실제 키로 확인한 것:
   - 위치 목록(locationinfoRest) 203곳은 xValue=경도·yValue=위도(WGS84)다. 편의시설 목록(conveniServiceArea)과는
     serviceAreaCode 로, 음식·테마와는 stdRestCd 로 이어진다.
   - 편의시설 목록에만 있고 위치 목록에 없는 새 휴게소가 42곳 있다(시흥하늘·김해금관가야 …). 그 좌표는 카카오 장소
     검색으로 찾아 KAKAO_FIXES 에 담았고, 그래도 없는 곳은 카카오 키가 있으면 그 자리에서 찾아 본다.
   - 한 번에 99줄까지만 오고, 편의시설 목록의 145번째 줄은 늘 서버 오류 화면이 온다. 망가진 쪽은 99 → 11 → 1줄로
     쪼개 다시 물어 그 한 줄만 빠뜨린다.
   - 주유소는 코드가 들쭉날쭉해 이름("서울만남(부산)주유소" ↔ "서울만남(부산)휴게소")으로 잇는다.
   휴게소 목록은 브라우저에 이레, 주유 가격은 30분 담아 둔다. .map 문서에는 아무것도 쓰지 않는다. */
const MNRestAreas = (() => {
  const CACHE_KEY = "mn.restAreas.v1", CACHE_TTL = 7 * 86400000, GAS_TTL = 30 * 60000, PAGE = 99, MAX_PAGES = 10, LIST_LIMIT = 40, MAX_LOOKUPS = 60;
  const SOURCE = "https://data.ex.co.kr/";
  const KINDS = {
    rest:{ label:"휴게소", color:"#15803d" },
    shelter:{ label:"쉼터", color:"#64748b" }
  };
  /* 위치 목록에 없는 휴게소 42곳. 2026-10-10 카카오 장소 검색의 '고속도로휴게소' 갈래에서 골랐고, 방향이 갈린 곳은
     도로명 주소 번지(편의시설 목록의 주소와 같은 번지)로 방향을 맞췄다 — 지리산 광주방향은 카카오에서 '담양방향',
     밀양영남루 울산방향은 '밀양방향', 문의청남대 영덕방향은 '상주방향'이다. 코드와 이름 앞부분이 둘 다 맞을 때만 쓴다. */
  const KAKAO_FIXES = {
    A00264:["시흥하늘", 37.38385, 126.8555], A00265:["김해금관가야", 35.26944, 129.00383], A00307:["안산", 37.35118, 126.81864],
    A00312:["남한강", 37.48322, 127.46716], A00315:["처인", 37.34031, 127.22034], A00316:["고삼호수", 37.07709, 127.29453],
    A00059:["지리산", 35.48399, 127.5672], A00058:["지리산", 35.48138, 127.56676], A00074:["거창", 35.70875, 128.05796],
    A00073:["거창", 35.70629, 128.05698], A00223:["논공", 35.76739, 128.40341], A00226:["논공", 35.76455, 128.40282],
    A00238:["강천산", 35.36577, 127.10576], A00237:["강천산", 35.36426, 127.10487], A00141:["영천", 36.05322, 129.0445],
    A00140:["영천", 36.05133, 129.04254], A00142:["청통", 35.99395, 128.85911], A00143:["와촌", 35.95184, 128.7757],
    A00129:["함양", 35.55156, 127.76044], A00130:["함양", 35.55115, 127.75858], A00267:["매송", 37.26512, 126.88872],
    A00266:["매송", 37.2647, 126.89168], A00306:["부안고려청자", 35.67187, 126.73198], A00305:["부안고려청자", 35.67173, 126.7347],
    A00320:["김제", 35.84206, 126.90331], A00319:["김제", 35.83941, 126.89756], A00308:["서부산", 35.15722, 128.94865],
    A00310:["춘향", 35.33762, 127.35097], A00311:["춘향", 35.33661, 127.35454], A00271:["울주", 35.51313, 129.12857],
    A00270:["울주", 35.51061, 129.13052], A00314:["밀양영남루", 35.48946, 128.6643], A00313:["밀양영남루", 35.49205, 128.66436],
    A00161:["진안마이산", 35.77781, 127.42528], A00162:["진안마이산", 35.77477, 127.42636], A00303:["문의청남대", 36.54443, 127.48432],
    A00304:["문의청남대", 36.54231, 127.48374], A00263:["내린천", 37.91623, 128.28777], A00268:["평택", 37.04481, 126.94456],
    A00269:["장흥정남진", 34.72099, 126.93002], A00318:["포항", 36.26331, 129.37205], A00317:["영덕", 36.28066, 129.36384]
  };
  const text = value => value == null ? "" : String(value).trim();
  const compact = value => text(value).replace(/\s+/g, "");
  // "서울만남(부산)휴게소" → 앞부분 "서울만남" · 방향 "부산" · 이름 줄기 "서울만남(부산)"
  const core = name => compact(name).replace(/\([^)]*\)/g, "").replace(/(휴게소|쉼터|주유소|충전소)$/, "");
  const direction = name => (text(name).match(/\(([^)]+)\)/) || [])[1] || "";
  const stem = name => compact(name).replace(/(휴게소|쉼터|주유소|충전소)$/, "");
  const inKorea = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 38.7 && lng >= 124.5 && lng <= 131.9;
  const won = value => { const n = Number(text(value).replace(/[^\d]/g, "")); return n > 0 ? n : 0; };

  function parse(body){
    // 망가진 줄이 든 쪽은 code 없이 {"exception":{…}} 으로 온다.
    if (!body || typeof body !== "object" || body.code == null) throw new Error("expressway-bad-page");
    if (text(body.code) !== "SUCCESS") throw new Error(/유효하지/.test(text(body.message)) ? "expressway-key-invalid" : /콜수/.test(text(body.message)) ? "expressway-quota" : "rest-invalid-data");
    const list = Array.isArray(body.list) ? body.list.filter(row => row && typeof row === "object") : [];
    return { list, count:Number(body.count) || 0 };
  }
  async function get(kind, { page = 1, rows = PAGE, code = "", refresh = false, signal } = {}){
    if (signal) signal.throwIfAborted();
    const response = await fetch("/rest-areas?kind=" + kind + "&page=" + page + "&rows=" + rows + (code ? "&code=" + encodeURIComponent(code) : "") + (refresh ? "&refresh=1" : ""), { signal, cache:"no-store" });
    if (!response.ok){ const reason = text(await response.text()); throw new Error(/^expressway-[a-z-]+$/.test(reason) ? reason : "rest-fetch-failed"); }
    let body; try { body = JSON.parse(await response.text()); } catch(_){ throw new Error("expressway-bad-page"); }
    const result = parse(body); if (signal) signal.throwIfAborted();
    const at = Date.parse(response.headers && response.headers.get("X-ClassDock-Fetched-At") || "");
    return { ...result, fetchedAt:Number.isFinite(at) ? Math.min(Date.now(), at) : Date.now(), stale:!!(response.headers && response.headers.get("X-ClassDock-Stale") === "1") };
  }
  /* 한 쪽을 받되, 서버 오류 화면이 오면 그 쪽을 잘게 쪼개 다시 묻는다(99 = 9×11, 11 = 11×1 이라 경계가 맞는다).
     1줄짜리도 망가지면 그 줄만 빼고 센다. 키 오류·한도·연결 실패는 그대로 올려 보낸다.
     한 번 묻는 데 1.5~2초라, 전체 수를 알면 쪼갠 쪽을 한꺼번에 묻는다(차례로 물으면 첫 목록에 40초가 걸렸다).
     전체 수를 아직 모르면(첫 쪽이 망가짐) 앞에서부터 하나씩 묻는다 — 첫 성공이 전체 수를 알려 준다. */
  async function chunk(kind, page, rows, options, out){
    try {
      const result = await get(kind, { ...options, page, rows });
      out.rows.push(...result.list); out.count = Math.max(out.count, result.count);
      out.fetchedAt = Math.min(out.fetchedAt, result.fetchedAt); out.stale = out.stale || result.stale;
    } catch(error){
      if (error.message !== "expressway-bad-page") throw error;
      if (rows === 1){ out.skipped++; return; }
      const smaller = rows === PAGE ? 11 : 1, parts = rows / smaller, first = (page - 1) * parts + 1;
      const inRange = sub => !out.count || (sub - 1) * smaller < out.count;
      if (out.count){
        const subs = Array.from({ length:parts }, (_, i) => first + i).filter(inRange);
        await Promise.all(subs.map(sub => chunk(kind, sub, smaller, options, out)));
      } else {
        for (let sub = first; sub < first + parts && inRange(sub); sub++) await chunk(kind, sub, smaller, options, out);
      }
    }
  }
  async function fetchAll(kind, options = {}){
    const out = { rows:[], count:0, fetchedAt:Infinity, stale:false, skipped:0 };
    await chunk(kind, 1, PAGE, options, out);
    const pages = [];
    for (let page = 2; page <= MAX_PAGES && (page - 1) * PAGE < out.count; page++) pages.push(page);
    await Promise.all(pages.map(page => chunk(kind, page, PAGE, options, out)));
    if (!Number.isFinite(out.fetchedAt)) out.fetchedAt = Date.now();
    return out;
  }

  /* 위치 목록과 편의시설 목록을 serviceAreaCode 로 합친다. 위치가 없으면 KAKAO_FIXES(코드+이름 앞부분)로 채운다. */
  function merge(locRows, convRows = []){
    const byCode = new Map();
    for (const row of locRows){
      const id = text(row.serviceAreaCode), name = text(row.unitName); if (!id || !name) continue;
      const lat = Number(row.yValue), lng = Number(row.xValue), ok = inKorea(lat, lng);
      byCode.set(id, { id, std:text(row.stdRestCd), name, route:text(row.routeName), routeNo:text(row.routeNo),
        lat:ok ? lat : null, lng:ok ? lng : null, located:ok ? "api" : "" });
    }
    for (const row of convRows){
      const id = text(row.serviceAreaCode), name = text(row.serviceAreaName); if (!id || !name) continue;   // 이름 없는 줄은 어느 곳인지 모른다
      let area = byCode.get(id);
      if (!area){ area = { id, std:text(row.serviceAreaCode2), name, route:text(row.routeName), routeNo:text(row.routeCode), lat:null, lng:null, located:"" }; byCode.set(id, area); }
      if (!area.std) area.std = text(row.serviceAreaCode2);
      if (!area.route) area.route = text(row.routeName);
      Object.assign(area, { tel:text(row.telNo), brand:text(row.brand), address:text(row.svarAddr),
        facilities:text(row.convenience).split("|").map(text).filter(Boolean), truck:text(row.truckSaYn) === "O", repair:text(row.maintenanceYn) === "O", way:text(row.direction) });
    }
    for (const area of byCode.values()){
      area.kind = /쉼터$/.test(area.name) ? "shelter" : "rest";
      area.direction = direction(area.name) || (/^(통합|양방향)$/.test(area.way || "") ? "" : text(area.way));
      delete area.way;
      for (const key of ["tel", "brand", "address"]) if (typeof area[key] !== "string") area[key] = "";
      if (!Array.isArray(area.facilities)) area.facilities = [];
      area.truck = !!area.truck; area.repair = !!area.repair;
      if (area.lat == null){
        const fix = KAKAO_FIXES[area.id];
        if (fix && fix[0] === core(area.name)){ area.lat = fix[1]; area.lng = fix[2]; area.located = "kakao"; }
      }
    }
    return [...byCode.values()];
  }
  // 카카오 키워드 검색 결과에서 '휴게소' 갈래이고 이름 앞부분(·방향)이 맞는 첫 곳.
  function pickPlace(result, name, way){
    const docs = Array.isArray(result) ? result : result && Array.isArray(result.documents) ? result.documents : [];
    for (const doc of docs){
      if (!doc || typeof doc !== "object") continue;
      const place = compact(doc.place_name);
      if (!/휴게소|쉼터/.test(text(doc.category_name)) || !place.includes(name)) continue;
      if (way && !place.includes(way + "방향") && !place.includes("양방향")) continue;
      const lat = Number(doc.y), lng = Number(doc.x);
      if (inKorea(lat, lng)) return { lat, lng };
    }
    return null;
  }
  /* 내장 표에도 없는 새 휴게소는 카카오 키가 있으면 그 자리에서 찾는다(목록과 함께 이레 기억하니 다시 묻지 않는다).
     findPlace 가 null 을 돌려주면 카카오를 쓸 수 없다는 뜻이라 그만 묻는다. */
  async function locateMissing(areas, findPlace, signal){
    if (typeof findPlace !== "function") return 0;
    let found = 0, asked = 0;
    for (const area of areas){
      if (area.lat != null || asked >= MAX_LOOKUPS) continue;
      if (signal) signal.throwIfAborted();
      const name = core(area.name); if (!name) continue;
      asked++;
      let result;
      try { result = await findPlace(name + (area.kind === "shelter" ? "쉼터" : "휴게소") + (area.direction ? " " + area.direction + "방향" : "")); }
      catch(error){ if (signal && signal.aborted) throw error; return found; }
      if (result == null) return found;
      const hit = pickPlace(result, name, area.direction);
      if (hit){ area.lat = hit.lat; area.lng = hit.lng; area.located = "kakao"; found++; }
    }
    return found;
  }
  function readCache(now = Date.now()){
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!cache || !Number.isFinite(cache.at) || cache.at > now || now - cache.at >= CACHE_TTL || !Array.isArray(cache.areas)) return null;
      const areas = cache.areas.filter(a => a && typeof a === "object" && typeof a.id === "string" && typeof a.name === "string" && KINDS[a.kind] && (a.lat == null || inKorea(a.lat, a.lng)))
        .map(a => ({ ...a, facilities:Array.isArray(a.facilities) ? a.facilities.filter(f => typeof f === "string") : [] }));
      return areas.length ? { areas, fetchedAt:cache.at, skipped:Number(cache.skipped) || 0, partial:!!cache.partial, stale:false, cached:true } : null;
    } catch(_){ return null; }
  }
  async function loadList({ signal, refresh = false, findPlace = null } = {}){
    if (!refresh){ const cached = readCache(); if (cached) return cached; }
    // 편의시설을 못 받아도 위치는 보여 준다(키 오류·한도는 위치도 못 받으니 그대로 알린다).
    const [loc, conv] = await Promise.all([fetchAll("loc", { signal, refresh }),
      fetchAll("conveni", { signal, refresh }).catch(error => { if ((signal && signal.aborted) || /key|quota/.test(error.message)) throw error; return null; })]);
    const areas = merge(loc.rows, conv ? conv.rows : []);
    await locateMissing(areas, findPlace, signal);
    const result = { areas, fetchedAt:Math.min(loc.fetchedAt, conv ? conv.fetchedAt : Infinity), skipped:loc.skipped + (conv ? conv.skipped : 0),
      partial:!conv, stale:loc.stale || !!(conv && conv.stale), cached:false };
    if (conv && !result.stale) try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at:Date.now(), areas, skipped:result.skipped })); } catch(_){}
    return result;
  }

  function gasOf(row){
    return { name:text(row.serviceAreaName), company:text(row.oilCompany), way:text(row.direction),
      gasoline:won(row.gasolinePrice), diesel:won(row.diselPrice), lpg:text(row.lpgYn) === "Y" ? won(row.lpgPrice) : 0 };
  }
  /* 주유소 → 휴게소. 먼저 이름 줄기("서울만남(부산)")가 같은 곳, 없으면 방향을 뗀 앞부분이 같은 '양방향' 휴게소에
     붙인다(시흥하늘(일산)·시흥하늘(판교) 주유소 → 시흥하늘휴게소). 한 휴게소에 주유소가 둘일 수 있다. */
  function attachGas(areas, gasRows){
    const byStem = new Map(), byCore = new Map(), result = new Map();
    for (const area of areas){ byStem.set(stem(area.name), area); if (!direction(area.name)) byCore.set(core(area.name), area); }
    for (const row of gasRows){
      const gas = gasOf(row); if (!gas.name) continue;
      const area = byStem.get(stem(gas.name)) || byCore.get(core(gas.name)); if (!area) continue;
      if (!result.has(area.id)) result.set(area.id, []);
      result.get(area.id).push(gas);
    }
    return result;
  }
  // 대표 → 추천 → 프리미엄 → 싼 것 차례.
  function foods(rows){
    return rows.map(row => ({ name:text(row.foodNm), price:won(row.foodCost), best:text(row.bestfoodyn) === "Y", recommend:text(row.recommendyn) === "Y",
      premium:text(row.premiumyn) === "Y", note:text(row.etc) })).filter(food => food.name)
      .sort((a, b) => Number(b.best) - Number(a.best) || Number(b.recommend) - Number(a.recommend) || Number(b.premium) - Number(a.premium) || a.price - b.price);
  }
  function failureText(error){
    if (error.message === "expressway-key-required") return "설정 → 연결의 '한국도로공사(고속도로)'에 인증키를 넣어 주세요.";
    if (error.message === "expressway-key-invalid") return "고속도로 공공데이터 인증키를 확인해 주세요. 공공데이터포털(data.go.kr) 키로는 조회할 수 없어요.";
    if (error.message === "expressway-quota") return "고속도로 공공데이터 키의 호출 한도를 다 썼어요. 잠시 후 다시 시도해 주세요.";
    return "휴게소 정보를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  function mount({ map, stage, toolRow, doc, t = v => v, movePanel = null, findPlace = null }){
    const el = (tag, cls = "", label = "") => { const n = document.createElement(tag); n.className = cls; n.textContent = t(label); return n; };
    const button = (label, cls = "") => { const n = el("button", "map-btn " + cls, label); n.type = "button"; return n; };
    const word = (ko, en) => window.MNI18N && window.MNI18N.lang === "en" ? en : ko;
    const literal = n => { n.setAttribute("data-i18n-ignore", ""); n.setAttribute("lang", "ko"); return n; };
    const price = n => word(n.toLocaleString("ko-KR") + "원", "₩" + n.toLocaleString("en-US"));
    const toggle = button("휴게소", "map-toolvis-rest-areas"); toolRow.append(toggle);
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "restAreas");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요.");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-pressed", "false");
    const panel = el("section", "map-weather-panel map-rest-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("고속도로 휴게소"));
    const heading = el("div", "map-weather-heading"), close = button("닫기"); heading.append(el("strong", "", "고속도로 휴게소"), close);
    const types = el("div", "map-zone-types map-rest-types"), checks = new Map(), counts = new Map();
    for (const [id, spec] of Object.entries(KINDS)){
      const label = el("label", "map-zone-type"), check = el("input"), swatch = el("i"), count = el("span", "map-rest-count");
      check.type = "checkbox"; check.checked = true; check.value = id;
      swatch.style.background = spec.color; swatch.setAttribute("aria-hidden", "true");
      label.append(check, swatch, el("span", "", spec.label), count); types.append(label); checks.set(id, check); counts.set(id, count);
    }
    const truckLabel = el("label", "map-zone-type map-rest-truck"), truck = el("input"); truck.type = "checkbox";
    truckLabel.append(truck, el("span", "", "화물차 휴게소만")); types.append(truckLabel);
    const route = el("select", "map-rest-route"); route.setAttribute("aria-label", t("노선"));
    const tools = el("div", "map-weather-tools"), refresh = button("자료 갱신", "map-rest-refresh"), fit = button("전국 보기", "map-rest-fit"), clear = button("지도에서 지우기", "map-rest-clear");
    tools.append(route, refresh, fit, clear);
    const summary = el("p", "map-zone-summary map-rest-summary"), status = el("p", "map-weather-status map-rest-status"), list = el("ol", "map-zone-list map-rest-list");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "한국도로공사가 알려 준 고속도로 휴게소·쉼터입니다. 위치 목록에 없는 새 휴게소는 카카오 장소 검색 좌표로 채웠습니다. 주유 가격은 켜 둔 동안 30분마다 새로 받습니다.");
    const foot = el("p", "map-weather-note"), source = el("a", "", "출처: 한국도로공사 고속도로 공공데이터 포털");
    source.href = SOURCE; source.target = "_blank"; source.rel = "noopener noreferrer"; foot.append(source);
    panel.append(heading, types, tools, summary, status, list, note, foot); stage.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel); if (movePanel) movePanel(panel, heading);
    const pane = map.createPane("mapRestAreasPane"); pane.style.zIndex = "615"; pane.style.pointerEvents = "none";
    const renderer = L.svg({ pane:"mapRestAreasPane", padding:.3 }), layer = L.layerGroup(), capability = new AbortController(), markers = new Map(), details = new Map();
    let data = null, gas = new Map(), gasAt = 0, gasFailed = false, shown = false, destroyed = false, abort = null, generation = 0, listTimer = 0;
    const selected = () => data ? data.areas.filter(a => a.lat != null && checks.get(a.kind).checked && (!truck.checked || a.truck) && (!route.value || a.route === route.value)) : [];
    const distance = a => map.getCenter().distanceTo([a.lat, a.lng]);
    const where = a => [a.route, a.direction ? word(a.direction + "방향", "to " + a.direction) : ""].filter(Boolean).join(" · ");
    const gasLine = g => [g.gasoline ? t("휘발유") + " " + price(g.gasoline) : "", g.diesel ? t("경유") + " " + price(g.diesel) : "", g.lpg ? "LPG " + price(g.lpg) : ""].filter(Boolean).join(" · ");
    function controls(){
      toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown)); toggle.setAttribute("aria-expanded", String(!panel.hidden));
      refresh.disabled = !!abort; fit.disabled = clear.disabled = route.disabled = !shown;
    }
    function row(box, label, value, isLiteral = true){
      if (!value) return;
      const p = el("p"), k = el("span", "map-zone-key", label), v = el("span"); k.textContent += ": "; v.textContent = value;
      if (isLiteral) literal(v); p.append(k, v); box.append(p);
    }
    function section(box, label){ const part = el("div", "map-rest-section"); part.append(el("strong", "", label)); box.append(part); return part; }
    function fillDetail(part, detail){
      part.replaceChildren(); part.append(el("strong", "", "대표 음식"));
      if (!detail){ part.append(el("p", "map-rest-muted", "음식 정보를 받지 못했어요.")); return; }
      if (!detail.foods.length) part.append(el("p", "map-rest-muted", "등록된 음식 정보가 없어요."));
      const menu = el("ul", "map-rest-foods");
      for (const food of detail.foods.slice(0, 8)){
        const item = el("li"), name = literal(el("span", "map-rest-food")); name.textContent = food.name; item.append(name);
        for (const [on, label] of [[food.best, "대표"], [food.recommend, "추천"], [food.premium, "프리미엄"]]) if (on) item.append(el("span", "map-rest-tag", label));
        if (food.price){ const cost = el("span", "map-rest-price"); cost.textContent = price(food.price); item.append(cost); }
        menu.append(item);
      }
      if (detail.foods.length) part.append(menu);
      if (detail.foods.length > 8){ const more = el("p", "map-rest-muted"); more.textContent = word("외 " + (detail.foods.length - 8) + "가지", (detail.foods.length - 8) + " more"); part.append(more); }
      for (const theme of detail.themes){
        const p = el("p", "map-rest-theme"), name = literal(el("strong")), body = literal(el("span"));
        name.textContent = theme.name; body.textContent = theme.detail; p.append(name, body); part.append(p);
      }
    }
    function loadDetail(area){
      if (!/^\d{6}$/.test(area.std)) return Promise.resolve(null);
      if (!details.has(area.std)) details.set(area.std, Promise.all([get("food", { code:area.std, signal:capability.signal }), get("theme", { code:area.std, signal:capability.signal }).catch(() => ({ list:[] }))])
        .then(([food, theme]) => ({ foods:foods(food.list), themes:theme.list.map(r => ({ name:text(r.itemNm), detail:text(r.detail) })).filter(r => r.name) }))
        .catch(error => { details.delete(area.std); if (capability.signal.aborted) throw error; return null; }));
      return details.get(area.std);
    }
    function card(area, popup = false){
      const spec = KINDS[area.kind], box = el("div", "map-zone-card map-rest-card");
      box.style.setProperty("--zone-color", spec.color);
      const name = literal(el("strong")); name.textContent = area.name; box.append(name);
      const badges = el("div", "map-rest-badges"); badges.append(el("span", "map-zone-badge", spec.label));
      const line = literal(el("span", "map-rest-where")); line.textContent = where(area); if (line.textContent) badges.append(line);
      if (area.truck) badges.append(el("span", "map-rest-flag", "화물차 휴게소"));
      if (area.repair) badges.append(el("span", "map-rest-flag", "경정비"));
      box.append(badges);
      const stations = gas.get(area.id) || [];
      if (popup){
        row(box, "주소", area.address); row(box, "전화", area.tel); row(box, "브랜드", area.brand); row(box, "편의시설", area.facilities.join(" · "));
        for (const g of stations){ const label = stations.length > 1 && g.way ? word("주유(" + g.way + "방향)", "Fuel (to " + g.way + ")") : t("주유"); row(box, label, gasLine(g) + (g.company ? " · " + g.company : ""), false); }
        if (area.located === "kakao") box.append(el("p", "map-rest-muted", "위치는 카카오 장소 검색 좌표입니다."));
        const part = section(box, "대표 음식"); part.append(el("p", "map-rest-muted", "음식 정보를 받는 중…"));
        loadDetail(area).then(detail => { if (!destroyed) fillDetail(part, detail); }).catch(() => {});
      } else {
        row(box, "브랜드", area.brand); row(box, "편의시설", area.facilities.slice(0, 5).join(" · "));
        for (const g of stations.slice(0, 2)) row(box, "주유", gasLine(g), false);
      }
      return box;
    }
    function renderList(){
      listTimer = 0; list.replaceChildren(); if (!shown || !data){ summary.textContent = ""; return; }
      const items = selected(), bounds = map.getBounds(), inView = items.filter(a => bounds.contains([a.lat, a.lng]));
      summary.textContent = word("전국 " + items.length + "곳 · 화면 안 " + inView.length + "곳", "Nationwide: " + items.length + " · " + inView.length + " in view");
      for (const area of inView.sort((a, b) => distance(a) - distance(b)).slice(0, LIST_LIMIT)){
        const item = el("li"), go = button("", "map-zone-go map-rest-go"), name = literal(el("span", "map-zone-go-name")), meta = literal(el("span", "map-zone-go-meta"));
        name.textContent = area.name; go.style.borderLeftColor = KINDS[area.kind].color;
        const fuel = (gas.get(area.id) || [])[0];
        meta.textContent = [where(area), fuel && fuel.gasoline ? t("휘발유") + " " + price(fuel.gasoline) : ""].filter(Boolean).join(" · ");
        go.append(name, meta);
        go.addEventListener("click", () => { map.setView([area.lat, area.lng], Math.max(14, map.getZoom())); const m = markers.get(area.id); if (m) m.openPopup(); });
        item.append(go); list.append(item);
      }
      if (!inView.length) list.append(el("li", "map-zone-empty", items.length ? "지금 화면에는 휴게소가 없어요. '전국 보기'를 눌러 보세요." : "표시할 휴게소가 없어요. 선택을 확인해 주세요."));
      if (inView.length > LIST_LIMIT) list.append(el("li", "map-zone-empty", "가까운 곳부터 40곳을 보여 줍니다. 지도를 옮기면 목록이 바뀝니다."));
    }
    function fillRoutes(){
      const keep = route.value, routes = new Map();
      for (const area of data ? data.areas : []) if (area.route && area.lat != null) routes.set(area.route, area.routeNo || "9999");
      const all = el("option", "", "모든 노선"); all.value = ""; route.replaceChildren(all);
      for (const [name] of [...routes].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))){ const option = literal(el("option")); option.value = name; option.textContent = name; route.append(option); }
      route.value = routes.has(keep) ? keep : "";
    }
    function draw(){
      layer.clearLayers(); markers.clear();
      for (const [id, count] of counts) count.textContent = data ? " " + data.areas.filter(a => a.kind === id && a.lat != null).length : "";
      if (!shown || !data){ map.removeLayer(layer); map.removeLayer(renderer); renderList(); controls(); return; }
      for (const area of selected()){
        const marker = L.circleMarker([area.lat, area.lng], { renderer, radius:area.kind === "shelter" ? 5 : 6.5, color:"#fff", weight:1.5,
          fillColor:KINDS[area.kind].color, fillOpacity:.92, bubblingMouseEvents:false });
        marker.bindTooltip(() => card(area), { className:"map-zone-tooltip map-rest-tooltip", direction:"top", opacity:1, offset:[0, -6] });
        // 음식은 연 뒤에 채워 넣으므로 높이 제한은 CSS(.map-rest-popup) 가 맡는다 — maxHeight 는 열 때 한 번만 잰다.
        marker.bindPopup(() => card(area, true), { maxWidth:340, className:"map-rest-popup" }); marker.addTo(layer); markers.set(area.id, marker);
      }
      layer.addTo(map); renderList(); controls();
    }
    function describe(){
      if (!data) return;
      const unlocated = data.areas.filter(a => a.lat == null).length;
      status.textContent = word("자료 받은 때: ", "Fetched: ") + new Date(data.fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { timeZone:"Asia/Seoul", hour12:false }) + " KST"
        + (data.partial ? " · " + t("편의시설 정보를 받지 못해 위치만 표시합니다.") : "") + (data.stale ? " · " + t("갱신이 지연되어 이전 자료를 표시합니다.") : "")
        + (data.skipped ? word(" · 도로공사 자료 오류로 " + data.skipped + "곳 정보 빠짐", " · " + data.skipped + " skipped (source data error)") : "")
        + (unlocated ? word(" · 위치를 찾지 못한 " + unlocated + "곳 제외", " · " + unlocated + " without a location excluded") : "")
        + (gasFailed ? " · " + t("주유 가격을 받지 못했어요.") : "");
    }
    // due = 시간이 됐으니 다시 받기(런처 30분 묶음은 그대로 씀) · upstream = 자료 갱신 단추(런처 묶음도 건너뜀)
    async function loadGas(due, upstream, signal){
      if (!due && !upstream && gasAt && Date.now() - gasAt < GAS_TTL) return;
      try { const result = await fetchAll("gas", { signal, refresh:upstream }); gas = attachGas(data ? data.areas : [], result.rows); gasAt = Date.now(); gasFailed = false; }
      catch(error){ if (signal && signal.aborted) throw error; gasFailed = true; }
    }
    async function show(refreshing = false, quiet = false){
      const seq = ++generation; if (abort) abort.abort(); const controller = new AbortController(); abort = controller; controls();
      if (!quiet) status.textContent = t("휴게소 정보를 받는 중…");
      try {
        const result = quiet && data ? data : await loadList({ signal:controller.signal, refresh:refreshing, findPlace });
        if (destroyed || seq !== generation || controller.signal.aborted) return;
        data = result; await loadGas(quiet, refreshing, controller.signal);
        if (destroyed || seq !== generation || controller.signal.aborted) return;
        if (!quiet) map.closePopup();
        if (refreshing) details.clear();
        shown = true; fillRoutes(); draw(); describe();
      } catch(error){
        if (!controller.signal.aborted && seq === generation) status.textContent = t(failureText(error)) + (shown ? " " + t("앞서 받은 휴게소 표시를 유지합니다.") : "");
      } finally { if (seq === generation){ abort = null; controls(); } }
    }
    function clearAll(){ generation++; if (abort) abort.abort(); abort = null; shown = false; map.closePopup(); draw(); status.textContent = t("휴게소 표시를 지웠어요."); }
    toggle.addEventListener("click", () => { if (!panel.hidden){ clearAll(); panel.hidden = true; } else { panel.hidden = false; if (!shown) show(); } controls(); });
    close.addEventListener("click", () => { panel.hidden = true; controls(); toggle.focus(); });
    refresh.addEventListener("click", () => show(true)); clear.addEventListener("click", clearAll);
    fit.addEventListener("click", () => { const points = selected().map(a => [a.lat, a.lng]); if (points.length) map.fitBounds(points, { padding:[40, 40], maxZoom:14 }); });
    for (const check of [...checks.values(), truck]) check.addEventListener("change", () => { map.closePopup(); draw(); });
    route.addEventListener("change", () => { map.closePopup(); draw(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    const move = () => { if (shown && !listTimer) listTimer = setTimeout(renderList, 120); }, language = () => { map.closePopup(); if (data){ fillRoutes(); describe(); } draw(); };
    map.on("moveend", move); window.addEventListener("mni18nchange", language);
    // 켜 둔 동안만 주유 가격을 30분마다 조용히 새로 받는다(휴게소 목록은 그대로).
    const timer = setInterval(() => { if (shown && !abort && !destroyed) show(false, true); }, GAS_TTL);
    fetch("/can-proxy-expressway", { signal:capability.signal, cache:"no-store" }).then(r => r.ok ? r.text() : "").then(value => {
      if (!destroyed && value.trim() === "yes"){ toggle.disabled = false; toggle.title = t("고속도로 휴게소의 위치·대표 음식·편의시설·주유 가격을 지도에서 봅니다."); }
    }).catch(() => {}); controls();
    const api = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){
        if (!shown || !data) return "";
        return t("출처: 한국도로공사 고속도로 공공데이터 포털") + (data.areas.some(a => a.located === "kakao") ? " · " + t("일부 위치: 카카오") : "")
          + " · " + new Date(data.fetchedAt).toLocaleString("sv-SE", { timeZone:"Asia/Seoul" }).slice(0, 16) + " KST";
      },
      destroy(){ destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(listTimer); clearInterval(timer);
        map.off("moveend", move); window.removeEventListener("mni18nchange", language); layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); markers.clear(); details.clear(); pane.remove(); panel.remove(); toggle.remove(); }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = []; doc.cleanupFns.push(() => api.destroy()); return api;
  }
  return { mount, parse, get, fetchAll, merge, pickPlace, locateMissing, readCache, loadList, attachGas, foods, failureText, core, direction, stem,
    KINDS, KAKAO_FIXES, SOURCE, CACHE_KEY };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNRestAreas;
