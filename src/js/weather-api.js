"use strict";
/* 기상청 날씨·한국천문연구원 특일(공휴일·24절기) 응답 해석과 런처 조회(MNWeatherApi).
   버스·항공과 같은 공공데이터포털 키를 쓰고, 활용신청은 서비스마다 따로다
   (기상청_단기예보 조회서비스 · 기상청_지상(종관, ASOS) 일자료 조회서비스 · 한국천문연구원_특일 정보).
   2026-09-19 실측:
   - 단기예보 계열은 위경도가 아니라 기상청 격자(nx,ny)로 묻는다 → toGrid 로 바꾼다(람베르트 정각원추 도법).
   - 실황(getUltraSrtNcst)에는 하늘 상태(SKY)가 없다 → 초단기예보의 가장 가까운 시각 SKY·낙뢰를 함께 쓴다.
   - 지난 날 관측(ASOS 일자료)은 어제까지만 있다. 강수량이 없으면 빈 문자열("")이 온다(Number("")=0 함정).
     일기현상(iscs)은 "{비}0940-1105. {박무}…" 꼴의 글이다.
   - 특일은 locdate 가 숫자(20261003)로, 24절기의 kst 는 "1529      " 처럼 공백이 붙어 온다.
   - 결과가 한 건이면 item 이 배열이 아니라 객체로 올 수 있다(TAGO 와 같은 봉투). */
const MNWeatherApi = (() => {
  const text = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 200);
  // 빈 문자열·"-"·강수없음 같은 글은 값 없음. Number("")=0 이 되지 않게 먼저 거른다.
  const num = v => { const s = text(v); if (!s || !/^-?[0-9]+(\.[0-9]+)?$/.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

  /* ── 종관기상관측(ASOS) 지점 ── 2026-09-18 일자료가 온 지점 97곳(90~300번을 모두 물어 봄).
     좌표는 지점이 있는 고장의 대략 자리(소수 둘째 자리). 가장 가까운 지점을 고르는 데만 쓴다. */
  const STATIONS = [
    [90,"속초",38.25,128.56],[93,"북춘천",37.95,127.75],[95,"철원",38.15,127.30],[98,"동두천",37.90,127.06],[99,"파주",37.89,126.77],
    [100,"대관령",37.68,128.72],[101,"춘천",37.90,127.74],[102,"백령도",37.97,124.71],[104,"북강릉",37.80,128.86],[105,"강릉",37.75,128.89],
    [106,"동해",37.51,129.12],[108,"서울",37.57,126.97],[112,"인천",37.48,126.62],[114,"원주",37.34,127.95],[115,"울릉도",37.48,130.90],
    [119,"수원",37.27,126.99],[121,"영월",37.18,128.46],[127,"충주",36.97,127.95],[129,"서산",36.78,126.49],[130,"울진",36.99,129.41],
    [131,"청주",36.64,127.44],[133,"대전",36.37,127.37],[135,"추풍령",36.22,127.99],[136,"안동",36.57,128.71],[137,"상주",36.41,128.16],
    [138,"포항",36.03,129.38],[140,"군산",36.01,126.76],[143,"대구",35.88,128.65],[146,"전주",35.84,127.12],[152,"울산",35.58,129.33],
    [155,"창원",35.17,128.57],[156,"광주",35.17,126.89],[159,"부산",35.10,129.03],[162,"통영",34.85,128.44],[165,"목포",34.82,126.38],
    [168,"여수",34.74,127.74],[169,"흑산도",34.69,125.45],[170,"완도",34.40,126.70],[172,"고창",35.35,126.60],[174,"순천",35.02,127.37],
    [177,"홍성",36.66,126.69],[181,"서청주",36.65,127.40],[184,"제주",33.51,126.53],[185,"고산",33.29,126.16],[188,"성산",33.39,126.88],
    [189,"서귀포",33.25,126.57],[192,"진주",35.16,128.04],[201,"강화",37.71,126.45],[202,"양평",37.49,127.49],[203,"이천",37.26,127.48],
    [211,"인제",38.06,128.17],[212,"홍천",37.68,127.88],[216,"태백",37.17,128.99],[217,"정선군",37.38,128.65],[221,"제천",37.16,128.19],
    [226,"보은",36.49,127.73],[232,"천안",36.76,127.29],[235,"보령",36.33,126.56],[236,"부여",36.27,126.92],[238,"금산",36.11,127.48],
    [239,"세종",36.49,127.24],[243,"부안",35.73,126.72],[244,"임실",35.61,127.29],[245,"정읍",35.56,126.87],[247,"남원",35.41,127.33],
    [248,"장수",35.66,127.52],[251,"고창군",35.43,126.70],[252,"영광군",35.28,126.48],[253,"김해시",35.23,128.89],[254,"순창군",35.37,127.13],
    [255,"북창원",35.23,128.67],[257,"양산시",35.31,129.02],[258,"보성군",34.76,127.21],[259,"강진군",34.63,126.77],[260,"장흥",34.69,126.92],
    [261,"해남",34.55,126.57],[262,"고흥",34.62,127.28],[263,"의령군",35.32,128.29],[264,"함양군",35.51,127.75],[266,"광양시",34.94,127.69],
    [268,"진도군",34.47,126.26],[271,"봉화",36.94,128.91],[272,"영주",36.87,128.52],[273,"문경",36.63,128.15],[276,"청송군",36.44,129.04],
    [277,"영덕",36.53,129.41],[278,"의성",36.36,128.69],[279,"구미",36.13,128.32],[281,"영천",35.98,128.95],[283,"경주시",35.83,129.20],
    [284,"거창",35.67,127.91],[285,"합천",35.57,128.17],[288,"밀양",35.49,128.74],[289,"산청",35.41,127.88],[294,"거제",34.89,128.60],
    [295,"남해",34.82,127.93],[296,"북부산",35.23,128.99]
  ].map(([id, name, lat, lng]) => ({ id, name, lat, lng }));
  const DEFAULT_STATION = 108;
  const station = id => STATIONS.find(s => s.id === Number(id)) || null;
  function metres(a, b){
    const rad = Math.PI / 180, dy = (b[0] - a[0]) * rad, dx = (b[1] - a[1]) * rad;
    const h = Math.sin(dy / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dx / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function nearestStation(lat, lng){
    let best = null, bestD = Infinity;
    for (const s of STATIONS){ const d = metres([lat, lng], [s.lat, s.lng]); if (d < bestD){ best = s; bestD = d; } }
    return best;
  }
  // 고른 지역(지점)은 이 브라우저에 남긴다(문서가 아니라 사용자 편의).
  const PLACE_KEY = "mn.weatherStation";
  function savedStation(){
    try { const s = station(localStorage.getItem(PLACE_KEY)); if (s) return s; } catch(_){}
    return station(DEFAULT_STATION);
  }
  function saveStation(id){ if (station(id)) try { localStorage.setItem(PLACE_KEY, String(Number(id))); } catch(_){} }

  /* ── 위경도 → 기상청 격자 ── 기상청 '동네예보 격자' 안내서의 식 그대로(격자 5km, 기준점 38N·126E = (43,136)). */
  function toGrid(lat, lng){
    const RE = 6371.00877 / 5.0, DEG = Math.PI / 180;
    const slat1 = 30 * DEG, slat2 = 60 * DEG, olon = 126 * DEG, olat = 38 * DEG;
    let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
    let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
    let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
    ro = RE * sf / Math.pow(ro, sn);
    let ra = Math.tan(Math.PI * 0.25 + lat * DEG * 0.5);
    ra = RE * sf / Math.pow(ra, sn);
    let theta = lng * DEG - olon;
    if (theta > Math.PI) theta -= 2 * Math.PI;
    if (theta < -Math.PI) theta += 2 * Math.PI;
    theta *= sn;
    return { nx:Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny:Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
  }
  const gridOk = g => g && g.nx >= 1 && g.nx <= 149 && g.ny >= 1 && g.ny <= 253;

  /* ── 봉투 ── */
  function rows(body){
    const response = body && typeof body === "object" ? body.response : null;
    const code = response && response.header ? text(response.header.resultCode) : "";
    if (code === "03") return [];
    if (code !== "00" || !response.body || typeof response.body !== "object") throw new Error("weather-invalid-data");
    const items = response.body.items;
    if (items == null || items === "") return [];
    if (typeof items !== "object") throw new Error("weather-invalid-data");
    const item = items.item;
    if (item == null) return [];
    if (Array.isArray(item)) return item.filter(r => r && typeof r === "object");
    if (typeof item === "object") return [item];
    throw new Error("weather-invalid-data");
  }

  /* ── 뜻 ── 하늘 상태(SKY) 1 맑음 · 3 구름많음 · 4 흐림. 강수 형태(PTY) 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 4 소나기
     (초단기는 5 빗방울 · 6 빗방울눈날림 · 7 눈날림). */
  // 짧은 이름은 i18n 사전에 넣지 않고 여기 영어를 둔다(사전은 같은 글 조각을 화면 어디서나 바꾼다 — '비'·'눈').
  const SKY_NAMES = { 1:["맑음", "Clear"], 3:["구름많음", "Mostly cloudy"], 4:["흐림", "Overcast"] };
  const PTY_NAMES = { 1:["비", "Rain"], 2:["비/눈", "Rain/snow"], 3:["눈", "Snow"], 4:["소나기", "Showers"],
    5:["빗방울", "Drizzle"], 6:["빗방울눈날림", "Drizzle/flurries"], 7:["눈날림", "Flurries"] };
  const skyName = (v, en = false) => (SKY_NAMES[v] || ["", ""])[en ? 1 : 0];
  const ptyName = (v, en = false) => (PTY_NAMES[v] || ["", ""])[en ? 1 : 0];
  // 일기장 날씨 칸의 값(sunny·partly·cloudy·rainy·storm·snowy·windy·foggy).
  function diaryWeatherOf({ sky = null, pty = null, lightning = false, wind = null } = {}){
    if (lightning) return "storm";
    if (pty === 3 || pty === 7) return "snowy";
    if (pty === 1 || pty === 2 || pty === 4 || pty === 5 || pty === 6) return "rainy";
    if (wind != null && wind >= 9) return "windy";
    if (sky === 1) return "sunny";
    if (sky === 3) return "partly";
    if (sky === 4) return "cloudy";
    return "";
  }

  // 실황 + 초단기예보 → 지금 날씨.
  function parseNow(ncstBody, ultraBody){
    const now = {};
    let base = "";
    for (const r of rows(ncstBody)){
      now[text(r.category)] = num(r.obsrValue);
      if (!base) base = text(r.baseDate) + text(r.baseTime);
    }
    // 초단기예보는 여섯 시간치가 온다. 가장 이른 예보 시각의 값이 '지금'에 가깝다.
    let first = "", sky = null, lightning = null, ptyFcst = null;
    const fc = ultraBody ? rows(ultraBody) : [];
    for (const r of fc){ const at = text(r.fcstDate) + text(r.fcstTime); if (!first || at < first) first = at; }
    for (const r of fc){
      if (text(r.fcstDate) + text(r.fcstTime) !== first) continue;
      const c = text(r.category), v = num(r.fcstValue);
      if (c === "SKY") sky = v; else if (c === "LGT") lightning = v; else if (c === "PTY") ptyFcst = v;
    }
    if (!base && !first) return null;
    const pty = now.PTY != null ? now.PTY : ptyFcst;
    const out = {
      at:base || first, temp:now.T1H ?? null, humidity:now.REH ?? null, wind:now.WSD ?? null, windDir:now.VEC ?? null,
      rain1h:now.RN1 ?? null, pty:pty ?? null, sky, lightning:lightning != null && lightning > 0
    };
    out.diary = diaryWeatherOf(out);
    return out;
  }

  // 단기예보 → 시간별·날짜별.
  function parseForecast(body){
    const hours = new Map(), days = new Map();
    for (const r of rows(body)){
      const date = text(r.fcstDate), time = text(r.fcstTime), c = text(r.category), raw = text(r.fcstValue);
      if (!/^[0-9]{8}$/.test(date) || !/^[0-9]{4}$/.test(time)) continue;
      if (!days.has(date)) days.set(date, { date, min:null, max:null, popMax:null, skies:[], ptys:[] });
      const day = days.get(date);
      if (c === "TMN"){ day.min = num(raw); continue; }
      if (c === "TMX"){ day.max = num(raw); continue; }
      const key = date + time;
      if (!hours.has(key)) hours.set(key, { date, time, temp:null, sky:null, pty:null, pop:null, pcp:"", sno:"", humidity:null, wind:null });
      const h = hours.get(key);
      if (c === "TMP") h.temp = num(raw);
      else if (c === "SKY") h.sky = num(raw);
      else if (c === "PTY") h.pty = num(raw);
      else if (c === "POP") h.pop = num(raw);
      else if (c === "PCP") h.pcp = raw === "강수없음" ? "" : raw;
      else if (c === "SNO") h.sno = raw === "적설없음" ? "" : raw;
      else if (c === "REH") h.humidity = num(raw);
      else if (c === "WSD") h.wind = num(raw);
    }
    const list = [...hours.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (const h of list){
      const day = days.get(h.date);
      if (h.pop != null) day.popMax = Math.max(day.popMax ?? 0, h.pop);
      if (h.sky != null) day.skies.push(h.sky);
      if (h.pty) day.ptys.push(h.pty);
      h.diary = diaryWeatherOf(h);
    }
    const dayList = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
      // 낮 동안 가장 흔한 하늘, 비·눈이 한 번이라도 오면 그 형태(눈이 섞이면 눈).
      const count = new Map();
      for (const s of day.skies) count.set(s, (count.get(s) || 0) + 1);
      const sky = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(e => e[0])[0] ?? null;
      const pty = day.ptys.includes(3) || day.ptys.includes(7) ? 3 : day.ptys.length ? day.ptys[0] : 0;
      // 한 번 오고 마는 소나기(강수확률 낮음)는 비 오는 날로 치지 않는다.
      const rainy = pty && (day.popMax ?? 0) >= 60;
      const out = { date:day.date, min:day.min, max:day.max, popMax:day.popMax, sky, pty:rainy ? pty : 0 };
      out.diary = diaryWeatherOf(out);
      return out;
    });
    return { hours:list, days:dayList };
  }

  // 지난 날 관측(ASOS 일자료) → 하루 날씨.
  function phenomena(iscs){
    const found = new Set();
    for (const m of text(iscs).matchAll(/\{([^}]{1,12})\}/g)) found.add(m[1]);
    return [...found];
  }
  function parseDay(body){
    const r = rows(body)[0];
    if (!r) return null;
    const signs = phenomena(r.iscs);
    const has = names => names.some(n => signs.includes(n));
    const rain = num(r.sumRn), cloud = num(r.avgTca), maxWind = num(r.maxWs), snow = num(r.ddMes) ?? num(r.sumDpthFhsc);
    let diary = "";
    if (has(["뇌전", "우박"])) diary = "storm";
    else if (has(["눈", "소낙눈", "눈보라", "진눈깨비", "싸락눈"]) || (snow != null && snow > 0)) diary = "snowy";
    else if (has(["비", "소나기", "이슬비", "가랑비", "소낙비"]) || (rain != null && rain >= 0.5)) diary = "rainy";
    else if (has(["안개"])) diary = "foggy";
    else if (maxWind != null && maxWind >= 10) diary = "windy";
    // 하루 평균 전운량(0~10): 0~5 맑음 · 6~8 구름많음 · 9~10 흐림(기상청 하늘 상태 구간).
    else if (cloud != null) diary = cloud <= 5 ? "sunny" : cloud <= 8 ? "partly" : "cloudy";
    return {
      station:text(r.stnNm), stationId:num(r.stnId), date:text(r.tm), diary, signs,
      avg:num(r.avgTa), min:num(r.minTa), max:num(r.maxTa), rain, cloud, humidity:num(r.avgRhm), wind:num(r.avgWs), maxWind,
      sunshine:num(r.sumSsHr), snow
    };
  }

  // 특일 → [{date:"YYYY-MM-DD", name, holiday}]
  function parseSpecialDays(body){
    const seen = new Set();
    return rows(body).flatMap(r => {
      const d = text(r.locdate), name = text(r.dateName);
      if (!/^[0-9]{8}$/.test(d) || !name) return [];
      const date = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
      if (seen.has(date + name)) return [];
      seen.add(date + name);
      return [{ date, name, holiday:text(r.isHoliday) === "Y" }];
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ── 런처 조회 ── 오류 까닭은 버스와 같은 이름(bus-key-required · bus-key-invalid · bus-quota). */
  async function get(url, signal){
    const response = await fetch(url, { signal, cache:"no-store" });
    if (!response.ok){
      let reason = "";
      if (response.status === 428 || response.status === 429){ try { reason = text(await response.text()); } catch(_){} }
      const error = new Error(/^bus-[a-z-]+$/.test(reason) ? reason : "weather-fetch-failed");
      error.retryAfterMs = Math.max(0, Number(response.headers.get("Retry-After")) || 0) * 1000;
      throw error;
    }
    const at = Date.parse(response.headers.get("X-ClassDock-Bus-Fetched-At") || "");
    return { body:await response.json(), fetchedAt:Number.isFinite(at) ? at : Date.now() };
  }
  let capabilityTask = null;
  function available(){
    if (!capabilityTask) capabilityTask = fetch("/can-proxy-weather", { cache:"no-store" })
      .then(r => r.ok ? r.text() : "").then(v => v.trim() === "yes").catch(() => false);
    return capabilityTask;
  }
  function gridOf(lat, lng){
    const g = toGrid(Number(lat), Number(lng));
    if (!gridOk(g)) throw new Error("weather-out-of-range");
    return g;
  }
  async function loadNow(lat, lng, { signal } = {}){
    const g = gridOf(lat, lng), q = "?nx=" + g.nx + "&ny=" + g.ny;
    const ncst = await get("/weather-now" + q, signal);
    // 하늘 상태는 덤이다 — 초단기예보가 안 와도 기온·강수는 보인다.
    let ultra = null;
    try { ultra = (await get("/weather-ultra" + q, signal)).body; } catch(error){ if (signal && signal.aborted) throw error; }
    const now = parseNow(ncst.body, ultra);
    if (!now) throw new Error("weather-no-data");
    return { ...now, grid:g, fetchedAt:ncst.fetchedAt };
  }
  async function loadForecast(lat, lng, { signal } = {}){
    const g = gridOf(lat, lng);
    const result = await get("/weather-forecast?nx=" + g.nx + "&ny=" + g.ny, signal);
    return { ...parseForecast(result.body), grid:g, fetchedAt:result.fetchedAt };
  }
  // dateKey = "YYYY-MM-DD"(어제까지).
  async function loadDay(stationId, dateKey, { signal } = {}){
    const s = station(stationId);
    if (!s || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey)) throw new Error("weather-bad-request");
    const result = await get("/weather-day?stn=" + s.id + "&date=" + dateKey.replace(/-/g, ""), signal);
    const day = parseDay(result.body);
    if (!day) throw new Error("weather-no-data");
    return day;
  }

  // 특일은 달마다 한 번 묻고 이 브라우저에 일주일 둔다(임시공휴일이 새로 생길 수 있어 영구 보관은 안 한다).
  const SPECIAL_KEY = "mn.specialDays.v1", SPECIAL_TTL = 7 * 86400000;
  const specialMemory = new Map(), specialTasks = new Map();
  function readSpecialCache(){ try { return JSON.parse(localStorage.getItem(SPECIAL_KEY) || "{}") || {}; } catch(_){ return {}; } }
  function writeSpecialCache(ym, items){
    try {
      const all = readSpecialCache();
      all[ym] = { at:Date.now(), items };
      // 오래된 달부터 치워 60달까지만.
      const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
      for (const k of keys.slice(60)) delete all[k];
      localStorage.setItem(SPECIAL_KEY, JSON.stringify(all));
    } catch(_){}
  }
  function cachedSpecialDays(year, month){
    const ym = year + String(month).padStart(2, "0");
    if (specialMemory.has(ym)) return specialMemory.get(ym);
    const hit = readSpecialCache()[ym];
    if (hit && Array.isArray(hit.items) && Date.now() - (hit.at || 0) < SPECIAL_TTL){ specialMemory.set(ym, hit.items); return hit.items; }
    return null;
  }
  // month 는 1~12. 공휴일이 안 되면 실패, 24절기는 안 돼도 공휴일만 돌려준다.
  function loadSpecialDays(year, month){
    const ym = year + String(month).padStart(2, "0");
    const cached = cachedSpecialDays(year, month);
    if (cached) return Promise.resolve(cached);
    if (specialTasks.has(ym)) return specialTasks.get(ym);
    const q = "?year=" + year + "&month=" + String(month).padStart(2, "0");
    const task = (async () => {
      const holidays = parseSpecialDays((await get("/weather-holidays" + q)).body);
      let terms = [];
      try { terms = parseSpecialDays((await get("/weather-terms" + q)).body).map(t => ({ ...t, term:true, holiday:false })); } catch(_){}
      const items = [...holidays, ...terms].sort((a, b) => a.date.localeCompare(b.date));
      specialMemory.set(ym, items);
      writeSpecialCache(ym, items);
      return items;
    })().finally(() => specialTasks.delete(ym));
    specialTasks.set(ym, task);
    return task;
  }

  // 오류 → 안내 글(한국어 원문 그대로 — 화면이 번역기에 넘긴다). service 는 신청할 서비스 갈래.
  const KEY_INVALID = {
    forecast:"인증키가 날씨 조회에 쓰일 수 없어요. 공공데이터포털에서 '기상청_단기예보 조회서비스' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 1~2시간 걸릴 수 있어요.",
    day:"인증키가 지난 날씨 조회에 쓰일 수 없어요. 공공데이터포털에서 '기상청_지상(종관, ASOS) 일자료 조회서비스' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 1~2시간 걸릴 수 있어요.",
    special:"인증키가 공휴일 조회에 쓰일 수 없어요. 공공데이터포털에서 '한국천문연구원_특일 정보' 활용신청을 확인해 주세요. 승인 직후라면 반영까지 1~2시간 걸릴 수 있어요."
  };
  function failureText(error, service){
    const reason = error && error.message;
    if (reason === "bus-key-required") return "설정 → 연결의 '공공데이터포털'에 인증키를 넣어 주세요.";
    if (reason === "bus-key-invalid") return KEY_INVALID[service] || KEY_INVALID.forecast;
    if (reason === "bus-quota") return "오늘 조회 한도를 다 썼어요. 내일 다시 이용해 주세요.";
    if (reason === "weather-out-of-range") return "기상청 예보 범위(대한민국) 밖이에요.";
    if (reason === "weather-no-data") return "그날 관측 자료가 없어요.";
    return "날씨를 받지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  return { STATIONS, DEFAULT_STATION, station, nearestStation, savedStation, saveStation, toGrid, gridOk, rows,
    skyName, ptyName, diaryWeatherOf, parseNow, parseForecast, phenomena, parseDay, parseSpecialDays,
    available, loadNow, loadForecast, loadDay, loadSpecialDays, cachedSpecialDays, failureText, KEY_INVALID, metres };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNWeatherApi;
