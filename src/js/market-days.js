"use strict";
/* 지도 '장날' 층(MNMarketDays). 전국전통시장표준데이터(소상공인시장진흥공단, 공공데이터포털)를 런처 /market-days 로 받는다.
   장날은 '시장개설주기' 글로 온다. 2026-10-04 실측 1,393곳 중 장이 서는 곳은 411곳이고, 값은 "매일" 또는
   "2일+7일"·"5일+10일"·"2일+4일+7일+9일" 처럼 날짜 끝자리를 + 로 이은 꼴뿐이었다(10일 = 끝자리 0).
   그래서 장날은 '날짜 끝자리'로 가린다 — 2·7일장은 2·7·12·17·22·27일. 31일은 끝자리 1이라 1·6일장에 넣는다
   (시장마다 다르게 할 수 있어 안내 글에 적는다). 위도·경도가 빈 곳 중 좌표를 모르는 곳은 지도에 못 찍고 개수만 알린다.
   표준데이터에 없는 김포의 네 5일장과 일산시장의 빠진 장날은 지자체 공식 안내로 보완한다. 위치가 빈 16곳은 내장 좌표로 채운다.
   목록은 갱신이 한 해 단위라 브라우저에 이레 동안 담아 두고 다시 쓴다. .map 문서에는 아무것도 쓰지 않는다. */
const MNMarketDays = (() => {
  const CACHE_KEY = "mn.marketDays.v1";
  const CACHE_DAYS = 7;
  const text = value => value == null ? "" : String(value).trim();

  // "4일+9일" → [4, 9], "5일+10일" → [5, 0](끝자리). "매일"·빈 값 → [](장날 없음 = 상설).
  function cycleDigits(cycle){
    const digits = new Set();
    for (const match of text(cycle).matchAll(/(\d{1,2})\s*일/g)){
      const day = Number(match[1]);
      if (day >= 1 && day <= 31) digits.add(day % 10);
    }
    return [...digits].sort((a, b) => (a || 10) - (b || 10));
  }
  const isMarketDay = (digits, day) => digits.includes(day % 10);
  // [2, 7] → "2·7일", [5, 0] → "5·10일". 영어는 짧게 "Days 2·7"(이름표·말풍선·목록 공용).
  const cycleLabel = (digits, english = false) => {
    const days = digits.map(d => d || 10).join("·");
    return english ? "Days " + days : days + "일";
  };

  // 표준데이터 봉투는 response 껍질 없이 {header, body} 로 온다. 다른 API 처럼 껍질이 있어도 읽는다.
  function rows(body){
    const root = body && typeof body === "object" ? (body.response && typeof body.response === "object" ? body.response : body) : null;
    const code = root && root.header ? text(root.header.resultCode) : "";
    if (code === "03") return { items:[], total:0 };
    if (code !== "00" || !root.body || typeof root.body !== "object") throw new Error("market-invalid-data");
    const items = root.body.items;
    const item = items && typeof items === "object" ? (Array.isArray(items) ? items : items.item) : null;
    const list = Array.isArray(item) ? item : item && typeof item === "object" ? [item] : [];
    return { items:list.filter(r => r && typeof r === "object"), total:Number(root.body.totalCount) || 0 };
  }
  // 받은 줄 → 화면이 쓰는 작은 꼴. 브라우저에 담을 것이라 필요한 칸만 남긴다.
  function market(row){
    const lat = Number(row.latitude), lng = Number(row.longitude);
    const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat >= 32.5 && lat <= 39 && lng >= 124 && lng <= 132.5;
    const site = text(row.homepageUrl);
    return {
      name:text(row.mrktNm), type:text(row.mrktType), cycle:text(row.mrktEstblCycle), digits:cycleDigits(row.mrktEstblCycle),
      address:text(row.rdnmadr) || text(row.lnmadr), lat:ok ? lat : null, lng:ok ? lng : null,
      stores:Number(row.storNumber) || 0, goods:text(row.trtmntPrdlst).split("+").map(text).filter(Boolean).join(", "),
      phone:text(row.phoneNumber), site, since:text(row.estblYear), toilet:text(row.pblicToiletYn) === "Y", parking:text(row.prkplceYn) === "Y",
      at:text(row.referenceDate)
    };
  }
  function parse(bodies){
    const list = [];
    for (const body of bodies) for (const row of rows(body).items) { const m = market(row); if (m.name) list.push(m); }
    return list;
  }
  // 2026-10-07 전체 1,393줄에 김포의 네 5일장이 없다. 공식 안내의 길찾기
  // 좌표를 사용하며 인근 상설시장(통진·양곡)과는 별도 시장으로 둔다.
  const GIMPO_SOURCE = "https://www.gimpo.go.kr/culture/selectTourCntntsWebView.do?key=6874&tourNo=428";
  const ILSAN_SOURCE = "https://www.goyang.go.kr/agr/agr04/agr04_3.jsp";
  const EXTRA_MARKETS = [
    { name:"김포5일장(북변시장)", cycle:"2일+7일", address:"경기도 김포시 북변동 274 (북변공영주차장)",
      lat:37.628578, lng:126.7114383, sourceUrl:GIMPO_SOURCE,
      aliases:["김포5일장", "김포오일장", "김포5일장(북변)", "김포5일장(북변시장)", "북변시장", "북변5일장", "북변오일장"] },
    { name:"양곡5일장", cycle:"1일+6일", address:"경기도 김포시 양촌읍 양곡리 421-4",
      lat:37.6558786, lng:126.623666, sourceUrl:"https://www.gimpo.go.kr/culture/selectTourCntntsWebView.do?key=6874&tourNo=776",
      aliases:["양곡5일장", "양곡오일장"] },
    { name:"마송5일장", cycle:"3일+8일", address:"경기도 김포시 통진읍 서암리 748-4 (통진공영주차장)",
      lat:37.6938725, lng:126.6010875, sourceUrl:"https://www.gimpo.go.kr/culture/selectTourCntntsWebView.do?key=6874&tourNo=777",
      aliases:["마송5일장", "마송오일장", "통진5일장"] },
    { name:"하성5일장", cycle:"4일+9일", address:"경기도 김포시 하성면 마곡리 635-9",
      lat:37.7191439, lng:126.6318435, sourceUrl:"https://www.gimpo.go.kr/culture/selectTourCntntsWebView.do?key=6874&tourNo=778",
      aliases:["하성5일장", "하성오일장"] }
  ];
  // 위도·경도가 빈 16곳(2026-10-08 실측). 진해 경화시장(3·8일장)도 여기 들어 장날에 지도에서 빠졌다.
  // 카카오 장소 검색으로 찾은 시장 자리. 이름과 주소의 시·군·구가 함께 맞을 때만 쓰고, API에 좌표가 생기면 그쪽을 따른다.
  const LOCATION_FIXES = [
    ["안덕시장", "청송군", 36.2882415, 128.9585990], ["영양시장", "영양군", 36.6645934, 129.1158255],
    ["함창시장", "상주시", 36.5672512, 128.1795108], ["해평공설시장", "구미시", 36.1950420, 128.3916060],
    ["부림시장", "창원시", 35.2057707, 128.5734505], ["경화시장", "진해구", 35.1567608, 128.6904062],
    ["옥종공설시장", "하동군", 35.1821043, 127.8802165], ["가음대상가", "성산구", 35.2080528, 128.6969942],
    ["이방정기시장", "창녕군", 35.6014007, 128.3828807], ["창녕상설시장", "창녕군", 35.5403157, 128.4973324],
    ["수정전통시장", "부산광역시 동구", 35.1299911, 129.0468113], ["대전도매시장", "대전광역시 동구", 36.3298316, 127.4327932],
    ["신영주번개시장", "영주시", 36.8122982, 128.6228365], ["함열시장", "익산시", 36.0808342, 126.9583620],
    ["영월종합상가시장", "영월군", 37.1825598, 128.4671808], ["의정부청과야채시장", "의정부시", 37.7381039, 127.0525459]
  ];
  function locate(m){
    if (m.lat != null && m.lng != null) return m;
    const name = text(m.name).replace(/\s/g, "");
    const fix = LOCATION_FIXES.find(([n, area]) => n === name && text(m.address).includes(area));
    return fix ? { ...m, lat:fix[2], lng:fix[3] } : m;
  }
  // 진해 경화시장의 3·8일장은 흔히 '진해5일장'으로 불린다. 김포5일장(북변시장)처럼 두 이름을 함께 보인다.
  const KNOWN_AS = [["경화시장", "진해구", "경화시장(진해5일장)"]];
  function knownAs(m){
    const name = text(m.name).replace(/\s/g, "");
    const alias = KNOWN_AS.find(([n, area]) => n === name && text(m.address).includes(area));
    return alias ? { ...m, name:alias[2] } : m;
  }
  function supplement(markets){
    let list = markets.map(locate).map(knownAs).map(m => {
      // 일산시장은 상설과 3·8일장을 함께 운영하나 API에는 '매일'만 있다.
      if (!["일산시장", "일산전통시장"].includes(text(m.name).replace(/\s/g, "")) || !text(m.address).includes("고양")) return m;
      return { ...m, type:"상설장+5일장", cycle:"3일+8일", digits:[3, 8], daily:true,
        sourceUrl:ILSAN_SOURCE, sourceName:"고양시 일산5일장 안내", sourceNameEn:"Goyang City Ilsan Market" };
    });
    for (const extra of EXTRA_MARKETS){
      const official = {
        ...market({ mrktNm:extra.name, mrktType:"5일장", mrktEstblCycle:extra.cycle,
          lnmadr:extra.address, latitude:extra.lat, longitude:extra.lng, phoneNumber:"031-980-5265" }),
        sourceUrl:extra.sourceUrl, sourceName:"김포시 문화관광", sourceNameEn:"Gimpo City Tourism"
      };
      const matches = m => extra.aliases.includes(text(m.name).replace(/\s/g, ""))
        && (text(m.address).includes("김포") || (m.lat != null && m.lng != null
          && Math.abs(m.lat - official.lat) < .003 && Math.abs(m.lng - official.lng) < .003));
      const existing = list.find(matches);
      // API가 나중에 같은 장터를 제공해도 한 점만 남기고 품목·점포 수 등은 유지한다.
      list = [...list.filter(m => !matches(m)), { ...official, ...existing,
        name:official.name, type:official.type, cycle:official.cycle, digits:official.digits,
        address:official.address, lat:official.lat, lng:official.lng, phone:official.phone,
        sourceUrl:official.sourceUrl, sourceName:official.sourceName, sourceNameEn:official.sourceNameEn }];
    }
    return list;
  }
  // 홈페이지 칸에는 "www.…"처럼 http 가 빠진 값도 있다. http(s) 로만 연다.
  function siteUrl(site){
    const value = text(site);
    if (!value) return "";
    const url = /^https?:\/\//i.test(value) ? value : "http://" + value;
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.href : ""; } catch(_){ return ""; }
  }
  // 한국 시각 오늘 "YYYY-MM-DD"
  const koreaToday = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const dayOf = ymd => Number(ymd.slice(8, 10));
  function addDays(ymd, n){
    const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)) + n));
    return d.toISOString().slice(0, 10);
  }
  // 그날부터 앞으로 열흘 안의 첫 장날(그날 포함). 상설이면 "".
  function nextMarketDay(digits, ymd){
    if (!digits.length) return "";
    for (let i = 0; i <= 10; i++){ const d = addDays(ymd, i); if (isMarketDay(digits, dayOf(d))) return d; }
    return "";
  }

  async function get(page, signal){
    const response = await fetch("/market-days?page=" + page, { signal, cache:"no-store" });
    if (!response.ok){
      let reason = "";
      if (response.status === 428 || response.status === 429){ try { reason = text(await response.text()); } catch(_){} }
      throw new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "market-fetch-failed");
    }
    return response.json();
  }
  // 1000줄씩 받아 모자라면 다음 쪽(전국 1,400곳 남짓이라 두 쪽). 쪽 수는 런처가 9까지만 받는다.
  async function loadAll({ signal } = {}){
    const bodies = [];
    let got = 0;
    for (let page = 1; page <= 9; page++){
      const body = await get(page, signal);
      const { items, total } = rows(body);
      bodies.push(body); got += items.length;
      if (!items.length || got >= total || items.length < 1000) break;
    }
    return parse(bodies);
  }
  function readCache(now = Date.now()){
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (saved && Array.isArray(saved.markets) && saved.markets.length && now - saved.fetchedAt < CACHE_DAYS * 86400000) return saved;
    } catch(_){}
    return null;
  }
  function writeCache(markets, fetchedAt){
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, markets })); } catch(_){}
  }
  async function load({ signal, refresh = false } = {}){
    const saved = refresh ? null : readCache();
    if (saved) return { ...saved, markets:supplement(saved.markets) };
    const markets = supplement(await loadAll({ signal }));
    const fetchedAt = Date.now();
    writeCache(markets, fetchedAt);
    return { fetchedAt, markets };
  }
  function failureText(error){
    const reason = error && error.message;
    if (reason === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (reason === "bus-key-invalid") return "인증키가 전통시장 조회에 쓰일 수 없어요. 공공데이터포털에서 '전국전통시장표준데이터' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 1~2시간 걸릴 수 있어요.";
    if (reason === "bus-quota") return "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    return "전통시장 목록을 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  /* ── 지도 ── */
  const ON = "#e8590c", PERMANENT = "#6b7f86";
  function mount({ map, stage, toolRow, doc, t = value => value, movePanel = null }){
    const english = () => !!(window.MNI18N && window.MNI18N.lang === "en");
    const word = (ko, en) => english() ? en : ko;
    const el = (tag, cls, label) => { const node = document.createElement(tag); if (cls) node.className = cls; if (label) node.textContent = t(label); return node; };
    const button = (label, cls = "") => { const node = el("button", "map-btn " + cls, label); node.type = "button"; return node; };

    const toggle = button("장날", "map-toolvis-market");
    if (typeof mapSetToolIcon === "function") mapSetToolIcon(toggle, "market");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-pressed", "false");
    toggle.disabled = true; toggle.title = t("ClassDock EXE에서 인터넷 연결 후 사용할 수 있어요."); toolRow.appendChild(toggle);

    const panel = el("section", "map-weather-panel map-market-panel"); panel.hidden = true; panel.setAttribute("aria-label", t("장날"));
    const heading = el("div", "map-weather-heading"), close = button("닫기");
    heading.append(el("strong", "", "장날"), close);
    const tools = el("div", "map-weather-tools map-market-tools");
    /* 브라우저 날짜 칸은 쓰지 않고 감춰 둔다 — 한국어 Chrome 은 칸 안에 요일 자리를 "()" 로 비워 그린다(2026-10-04 사용자 보고).
       보이는 것은 우리가 쓴 날짜 글자 단추이고, 누르면 감춘 칸의 달력을 연다. */
    const dateBox = el("span", "map-market-date-box");
    const date = document.createElement("input"); date.type = "date"; date.className = "map-market-date"; date.tabIndex = -1;
    date.setAttribute("aria-hidden", "true");
    const dateButton = button("", "map-market-date-btn"); dateButton.setAttribute("aria-label", t("날짜"));
    dateBox.append(dateButton, date);
    const prev = button("‹", "map-market-prev"), next = button("›", "map-market-next");
    prev.title = t("하루 전"); next.title = t("하루 뒤");
    prev.setAttribute("aria-label", t("하루 전")); next.setAttribute("aria-label", t("하루 뒤"));
    const todayButton = button("오늘", "map-market-today");
    tools.append(prev, dateBox, next, todayButton);
    const options = el("div", "map-weather-tools map-market-options");
    const permanentLabel = el("label", "map-market-check"), permanent = document.createElement("input");
    permanent.type = "checkbox"; permanent.className = "map-market-permanent";
    permanentLabel.append(permanent, el("span", "", "상설시장도 보기"));
    const clearButton = button("지도에서 지우기");
    options.append(permanentLabel, clearButton);
    const summary = el("p", "map-weather-place map-market-summary");
    const list = el("ol", "map-market-list");
    const status = el("p", "map-weather-status map-market-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const note = el("p", "map-weather-note", "장날은 날짜 끝자리로 셉니다(2·7일장 = 2, 7, 12, 17, 22, 27일). 31일 장과 명절 휴장은 시장마다 다를 수 있어요.");
    const foot = el("p", "map-weather-note map-market-foot");
    const source = el("a", "", "출처: 전국전통시장표준데이터(공공데이터포털)");
    source.href = "https://www.data.go.kr/data/15012894/standard.do"; source.target = "_blank"; source.rel = "noopener noreferrer";
    const refresh = button("새로 받기", "map-market-refresh");
    const extraSource = el("a", "", "보완: 김포시 문화관광");
    extraSource.href = GIMPO_SOURCE; extraSource.target = "_blank"; extraSource.rel = "noopener noreferrer";
    const ilsanSource = el("a", "", "고양시 일산5일장 안내");
    ilsanSource.href = ILSAN_SOURCE; ilsanSource.target = "_blank"; ilsanSource.rel = "noopener noreferrer";
    foot.append(source, document.createTextNode(" · "), extraSource, document.createTextNode(" · "), ilsanSource, document.createTextNode(" · "), refresh);
    panel.append(heading, tools, options, summary, list, status, note, foot);
    stage.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    if (typeof movePanel === "function") movePanel(panel, heading);

    const pane = map.createPane("mapMarketPane"); pane.style.zIndex = "615";
    // 점은 SVG 로 그린다. 캔버스는 지도 전체를 덮는 한 장이 마우스를 다 받아 아래 층(주변 교통·표시)을 가렸고,
    // 층을 꺼도 렌더러가 남아 계속 막았다. SVG 는 빈 바탕이 마우스를 통과시키고 점(path)만 받는다.
    const renderer = L.svg({ pane:"mapMarketPane", padding:0.3 });
    const layer = L.layerGroup();
    const capability = new AbortController();
    let destroyed = false, shown = false, markets = [], fetchedAt = 0, abort = null, generation = 0, listTimer = 0;
    const setStatus = value => { if (status.textContent !== value) status.textContent = value; };

    const WEEK = ["일", "월", "화", "수", "목", "금", "토"], WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekday = ymd => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, dayOf(ymd))).getUTCDay();
    const dateText = ymd => english()
      ? WEEK_EN[weekday(ymd)] + ", " + new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", { day:"numeric", month:"short", timeZone:"UTC" })
      : Number(ymd.slice(5, 7)) + "월 " + dayOf(ymd) + "일(" + WEEK[weekday(ymd)] + ")";
    const selected = () => /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : koreaToday();
    const opensOn = (m, ymd) => m.digits.length > 0 && isMarketDay(m.digits, dayOf(ymd));
    const visible = (m, ymd) => m.lat != null && (opensOn(m, ymd) || (permanent.checked && (!m.digits.length || m.daily)));

    function popupOf(m, ymd){
      const box = el("div", "map-market-popup");
      const name = el("strong", "map-market-popup-name"); name.textContent = m.name;
      box.append(name);
      const line = (label, value) => {
        if (!value) return;
        const row = el("div", "map-market-popup-row");
        const key = el("span", "map-market-popup-key"); key.textContent = label;
        const val = el("span"); val.textContent = value;
        row.append(key, val); box.append(row);
      };
      if (m.digits.length){
        const nextDay = nextMarketDay(m.digits, ymd);
        // 줄 머리가 이미 'Market days' 라 영어 값은 "Days" 없이 "4·9" 만 쓴다.
        line(word("장날", "Market days"), (english() ? m.digits.map(d => d || 10).join("·") : cycleLabel(m.digits)) + (m.type.includes("상설") ? word(" (상설시장 함께)", " (also open daily)") : ""));
        if (nextDay && nextDay !== ymd) line(word("다음 장", "Next"), dateText(nextDay));
      } else line(word("열리는 날", "Open"), word("매일(상설)", "Daily"));
      line(word("주소", "Address"), m.address);
      if (m.stores) line(word("점포", "Stores"), m.stores + word("곳", ""));
      line(word("품목", "Goods"), m.goods);
      line(word("전화", "Phone"), m.phone);
      line(word("편의", "Facilities"), [m.parking ? word("주차장", "Parking") : "", m.toilet ? word("화장실", "Toilets") : ""].filter(Boolean).join(" · "));
      const url = siteUrl(m.site);
      if (url){
        const link = el("a", "map-market-popup-link"); link.textContent = word("홈페이지", "Website");
        link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; box.append(link);
      }
      if (m.sourceUrl){
        const link = el("a", "map-market-popup-link"); link.textContent = word("출처: " + m.sourceName, "Source: " + m.sourceNameEn);
        link.href = m.sourceUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; box.append(link);
      }
      return box;
    }
    // 마우스를 올리면 뜨는 간판형 이름표: 시장 그림 · 이름 · 장날 주기(상설은 '매일').
    function tipOf(m){
      const box = el("span", "map-market-tip-body");
      const icon = el("span", "map-market-tip-ico");
      if (typeof mapToolIconUrl === "function"){ const url = mapToolIconUrl("market"); if (url) icon.style.setProperty("--map-icon", url); }
      const name = el("span", "map-market-tip-name"); name.textContent = m.name;
      const cycle = el("span", "map-market-tip-cycle");
      cycle.textContent = m.digits.length ? cycleLabel(m.digits, english()) + word("장", "") : word("매일", "Daily");
      box.append(icon, name, cycle);
      return box;
    }
    const markerOf = new Map();
    function draw(){
      layer.clearLayers(); markerOf.clear();
      if (!shown){ map.removeLayer(layer); map.removeLayer(renderer); return; }
      const ymd = selected();
      // 상설시장을 먼저(아래에) 깔고 장 서는 곳을 위에 얹는다.
      const order = markets.filter(m => visible(m, ymd)).sort((a, b) => opensOn(a, ymd) - opensOn(b, ymd));
      for (const m of order){
        const on = opensOn(m, ymd);
        const marker = L.circleMarker([m.lat, m.lng], { renderer, radius:on ? 7 : 4, color:"#fff", weight:on ? 2 : 1,
          fillColor:on ? ON : PERMANENT, fillOpacity:on ? .95 : .7, bubblingMouseEvents:false });
        marker.bindTooltip(() => tipOf(m), { direction:"top", offset:[0, -10], className:"map-market-tip" + (on ? "" : " is-permanent") });
        // 가리킨 점을 키워 어느 점의 이름표인지 바로 보이게 한다.
        marker.on("mouseover", () => marker.setStyle({ radius:on ? 10 : 6, weight:3 }));
        marker.on("mouseout", () => marker.setStyle({ radius:on ? 7 : 4, weight:on ? 2 : 1 }));
        marker.bindPopup(() => popupOf(m, selected()), { maxWidth:280, className:"map-market-popup-wrap" });
        marker.addTo(layer); markerOf.set(m, marker);
      }
      layer.addTo(map);
    }
    function renderList(){
      clearTimeout(listTimer); listTimer = 0;
      list.replaceChildren();
      if (!shown || !markets.length){ summary.textContent = ""; return; }
      const ymd = selected(), open = markets.filter(m => opensOn(m, ymd));
      const bounds = map.getBounds(), center = map.getCenter();
      const inView = open.filter(m => m.lat != null && bounds.contains([m.lat, m.lng]))
        .map(m => ({ m, d:center.distanceTo([m.lat, m.lng]) })).sort((a, b) => a.d - b.d);
      const missing = open.filter(m => m.lat == null).length;
      summary.textContent = dateText(ymd) + " · " + word("장 서는 곳 전국 " + open.length + "곳, 지금 화면 " + inView.length + "곳",
        open.length + " markets open nationwide, " + inView.length + " in view")
        + (missing ? word(" · 위치 없는 " + missing + "곳은 지도에 없어요", " · " + missing + " without a location are not mapped") : "");
      for (const { m, d } of inView.slice(0, 40)){
        const item = el("li", "map-market-item"), go = button("", "map-market-go");
        const name = el("span", "map-market-go-name"); name.textContent = m.name;
        const meta = el("span", "map-market-go-meta");
        meta.textContent = [cycleLabel(m.digits, english()), d >= 1000 ? (d / 1000).toFixed(d < 10000 ? 1 : 0) + " km" : Math.round(d) + " m",
          m.address.split(" ").slice(0, 2).join(" ")].join(" · ");
        go.append(name, meta);
        go.addEventListener("click", () => {
          map.setView([m.lat, m.lng], Math.max(map.getZoom(), 13));
          const marker = markerOf.get(m); if (marker) marker.openPopup();
        });
        item.append(go); list.append(item);
      }
      if (inView.length > 40) list.append(el("li", "map-market-more", word("가까운 40곳만 보여 줘요. 지도를 옮기거나 확대해 보세요.", "Showing the nearest 40. Move or zoom the map to see others.")));
      else if (!inView.length && open.length) list.append(el("li", "map-market-more", word("지금 화면에는 장 서는 곳이 없어요. 지도를 넓혀 보세요.", "No markets open in this view. Try zooming out.")));
    }
    const renderListSoon = () => { if (shown && !listTimer) listTimer = setTimeout(renderList, 150); };
    const showDate = () => { dateButton.textContent = dateText(selected()); };
    function render(){
      showDate(); draw(); renderList();
      toggle.classList.toggle("is-on", shown); toggle.setAttribute("aria-pressed", String(shown));
      clearButton.disabled = !shown;
    }

    async function show(refreshing = false){
      generation++; if (abort) abort.abort();
      const seq = generation, controller = new AbortController(); abort = controller;
      if (!date.value) date.value = koreaToday();
      showDate();
      setStatus(t("전통시장 목록을 받는 중…"));
      refresh.disabled = true;
      try {
        const result = await load({ signal:controller.signal, refresh:refreshing });
        if (destroyed || seq !== generation) return;
        markets = result.markets; fetchedAt = result.fetchedAt; shown = true;
        render();
        setStatus(word("목록 받은 때", "List fetched") + " " + new Date(fetchedAt).toLocaleString(word("ko-KR", "en-GB"), { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false })
          + word(" · 전국 " + markets.length + "곳", " · " + markets.length + " markets"));
      } catch(error){
        if (controller.signal.aborted || seq !== generation) return;
        setStatus(t(failureText(error)));
      } finally {
        if (seq === generation){ abort = null; refresh.disabled = false; }
      }
    }
    function clearAll(){
      generation++; if (abort) abort.abort(); abort = null; refresh.disabled = false;
      shown = false; render(); setStatus(t("장날 표시를 지웠어요."));
    }
    const setDate = ymd => { date.value = ymd; showDate(); if (shown){ map.closePopup(); render(); } };
    dateButton.addEventListener("click", () => {
      try { date.showPicker(); } catch(_){ date.focus(); date.click(); }
    });

    prev.addEventListener("click", () => setDate(addDays(selected(), -1)));
    next.addEventListener("click", () => setDate(addDays(selected(), 1)));
    todayButton.addEventListener("click", () => setDate(koreaToday()));
    date.addEventListener("change", () => setDate(selected()));
    permanent.addEventListener("change", () => { if (shown) draw(); });
    clearButton.addEventListener("click", clearAll);
    refresh.addEventListener("click", () => show(true));
    // 켜진 채로 도구 단추를 누르면 지우고 닫는다(날씨·버스 단추와 같은 규칙). 처음 누르면 바로 오늘 장날을 띄운다.
    toggle.addEventListener("click", () => {
      if (shown){ clearAll(); panel.hidden = true; }
      else { panel.hidden = false; show(); }
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    close.addEventListener("click", () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape"){ event.stopPropagation(); close.click(); } });
    map.on("moveend", renderListSoon);
    const onLang = () => { showDate(); if (shown){ map.closePopup(); renderList(); } };
    window.addEventListener("mni18nchange", onLang);

    fetch("/can-proxy-weather", { cache:"no-store", signal:capability.signal }).then(r => r.ok ? r.text() : "").then(value => {
      if (destroyed || value.trim() !== "yes") return;
      toggle.disabled = false; toggle.title = t("오늘 장이 서는 전통시장(5일장)을 지도에 표시합니다.");
    }).catch(() => {});

    const controller = {
      isAvailable(){ return !toggle.disabled; },
      captureNote(){
        if (!shown) return "";
        return [t("장날"), dateText(selected()), word("전국전통시장표준데이터 · 김포시 문화관광 · 고양시", "Korea traditional market data · Gimpo City Tourism · Goyang City")].join(" · ");
      },
      destroy(){
        destroyed = true; generation++; if (abort) abort.abort(); capability.abort(); clearTimeout(listTimer);
        window.removeEventListener("mni18nchange", onLang); map.off("moveend", renderListSoon);
        layer.clearLayers(); map.removeLayer(layer); map.removeLayer(renderer); panel.remove(); toggle.remove(); pane.remove();
      }
    };
    if (!Array.isArray(doc.cleanupFns)) doc.cleanupFns = [];
    doc.cleanupFns.push(() => controller.destroy());
    return controller;
  }

  return { mount, cycleDigits, isMarketDay, cycleLabel, rows, market, parse, supplement, siteUrl, koreaToday, addDays, nextMarketDay, loadAll, load, failureText, CACHE_KEY };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNMarketDays;
