"use strict";
/* KOSIS 국가통계포털 공유서비스 — 자주 쓰는 통계 목록, 응답 해석, 런처 조회(MNKosisApi).
   색칠 지도(map-viewer.js 의 openMapChoropleth)가 '지역 이름 ↔ 값' 표를 받아 칠하므로, 여기서는
   KOSIS 자료를 "시도 시군구\t값" 줄로 바꾸는 데까지만 한다. 이름 맞추기는 색칠 지도가 한다.
   2026-09-19 실측:
   - 'e-지방지표' 표(DT_1YL…·INH_…)는 시도·시군구가 한 분류에 함께 온다. 시군구 이름은 '중구'처럼 짧게 온다
     → 코드 끝 숫자로 시도(앞머리가 같은 코드)를 찾아 "서울특별시 중구"로 붙인다.
   - 코드 모양이 표마다 다르다: 11010 · 11110(행안부) · 11101HJG11010 · 1236010(통합특별시 아래 옛 시도) · 15315SGG0101.
     끝 숫자만 떼면 모두 '앞머리 = 상위 지역'이다.
   - 일반구는 상위가 시가 아니라 도로 온다(31011 장안구 up=31) → 같은 자리의 끝이 0 인 시(31010 수원시)를 찾아 끼운다.
   - 통계표 정보(메타)는 2026-07 개편 지역(전남광주통합특별시·제물포구)으로 바뀌었지만 2025년 자료는 옛 이름이다
     → 이름은 받은 자료 줄에서만 쓴다.
   - 항목 이름에 '＜br＞' 가 섞여 오고, 단위가 어긋난 표가 있다(성비 '명', 합계출산율 긴 설명) → 목록에서 단위를 정해 둔다.
   - 자료가 없으면 {"err":"30"} → 런처가 [] 로 바꿔 준다. 값 "-"·"" 는 0 이 아니라 '없음'이다. */
const MNKosisApi = (() => {
  const text = v => String(v == null ? "" : v).replace(/＜br＞|<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();

  /* ── 자주 쓰는 통계 ──
     objs 는 분류 순서(objL1, objL2…)대로, 지역 분류 자리는 "ALL". levels 는 칠할 수 있는 단계.
     items 가 둘 이상이면 화면에서 고른다(첫 값이 기본). unit 은 KOSIS 단위를 덮어쓴다. */
  const G = { people:"인구·가구", school:"학교·교육", life:"생활·안전", env:"환경·기후", economy:"경제·재정" };
  const both = ["sido", "sgg"], sidoOnly = ["sido"];
  const PRESETS = [
    { id:"pop", group:G.people, title:"주민등록인구", org:"101", tbl:"DT_1YL20651E", objs:["ALL"], levels:both, unit:"명",
      items:[["T20", "전체"], ["T21", "남자"], ["T22", "여자"]] },
    { id:"popGrowth", group:G.people, title:"인구증가율", org:"101", tbl:"DT_1YL20621", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },
    { id:"aged", group:G.people, title:"고령인구비율(65세 이상)", org:"101", tbl:"DT_1YL20631", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },
    { id:"youth", group:G.people, title:"청년인구비율(19~39세)", org:"101", tbl:"DT_1YL20643", objs:["ALL", "11"], levels:both, unit:"%", items:[["T001", ""]] },
    { id:"avgAge", group:G.people, title:"평균 나이", org:"101", tbl:"INH_1IN1503_02", objs:["ALL", "126"], levels:both, unit:"세",
      items:[["T00", "전체"], ["T01", "남자"], ["T02", "여자"]] },
    { id:"sexRatio", group:G.people, title:"성비(여자 100명당 남자)", org:"101", tbl:"DT_1YL20701", objs:["ALL"], levels:both, unit:"", items:[["T10", ""]] },
    { id:"onePerson", group:G.people, title:"1인 가구 비율", org:"101", tbl:"DT_1YL21161", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },
    { id:"aloneElder", group:G.people, title:"혼자 사는 노인 가구 비율", org:"101", tbl:"DT_1YL12701", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },
    { id:"births", group:G.people, title:"출생아 수", org:"101", tbl:"INH_1B81A01", objs:["ALL"], levels:both, unit:"명", items:[["T1", ""]] },
    { id:"tfr", group:G.people, title:"합계출산율", org:"101", tbl:"INH_1B81A17", objs:["ALL"], levels:both, unit:"명", items:[["T1", ""]] },
    { id:"netMove", group:G.people, title:"순이동 인구(들어온 사람 − 나간 사람)", org:"101", tbl:"INH_1B26001_A021", objs:["ALL", "0"], levels:both, unit:"명",
      items:[["T25", ""]], skipZero:true, note:"음수는 나간 사람이 더 많다는 뜻이에요. 색은 '빨강-파랑(가운데 0)'이 잘 맞아요." },
    { id:"foreign", group:G.people, title:"외국인 주민 수", org:"110", tbl:"TX_11025_A001_A", objs:["ALL", "15110AA000", "C001"], levels:both, unit:"명",
      items:[["16110AAA0", ""]] },
    { id:"multicultural", group:G.people, title:"다문화 가구 수", org:"101", tbl:"DT_1JD1501", objs:["ALL"], levels:both, unit:"가구", items:[["T10", ""]] },
    { id:"density", group:G.people, title:"인구밀도", org:"101", tbl:"DT_1B08024", objs:["ALL"], levels:sidoOnly, unit:"명/㎢", items:[["T7", ""]],
      note:"인구주택총조사 기준이라 5년마다 크게 바뀌어요." },

    { id:"elemSchools", group:G.school, title:"초등학교 수", org:"101", tbl:"DT_1YL21231", objs:["ALL"], levels:both, unit:"개", items:[["T10", ""]] },
    { id:"elemStudents", group:G.school, title:"초등학생 수", org:"101", tbl:"DT_1YL21241", objs:["ALL"], levels:both, unit:"명", items:[["T10", ""]] },
    { id:"kinder", group:G.school, title:"유치원 수", org:"101", tbl:"DT_1YL21201", objs:["ALL"], levels:both, unit:"개", items:[["T10", ""]] },
    { id:"kinderKids", group:G.school, title:"유치원 원아 수", org:"101", tbl:"DT_1YL21211", objs:["ALL"], levels:both, unit:"명", items:[["T10", ""]] },
    { id:"classSize", group:G.school, title:"학급당 학생 수", org:"101", tbl:"DT_1YL15001", objs:["ALL"], levels:both, unit:"명",
      items:[["T001", "전체"], ["T002", "유치원"], ["T003", "초등학교"], ["T004", "중학교"], ["T005", "고등학교"]] },
    { id:"teacherRatio", group:G.school, title:"교원 1인당 학생 수", org:"101", tbl:"DT_1YL21171", objs:["ALL"], levels:both, unit:"명", items:[["T10", ""]] },
    { id:"univ", group:G.school, title:"대학생 수", org:"101", tbl:"DT_1YL8801", objs:["ALL"], levels:both, unit:"명",
      items:[["T10", "전체"], ["T001", "일반대"], ["T002", "전문대"]], note:"대학이 있는 곳만 값이 있어요." },
    { id:"privateEdu", group:G.school, title:"학생 1인당 월평균 사교육비", org:"101", tbl:"DT_1PE105", objs:["ALL"], levels:sidoOnly, unit:"만원",
      items:[["T00", "전체 평균"], ["T01", "초등학교"], ["T02", "중학교"], ["T03", "고등학교"]] },

    { id:"childAccidents", group:G.life, title:"어린이 교통사고", org:"101", tbl:"DT_1YL202107", objs:["ALL"], levels:both, unit:"건",
      items:[["T10", "사고 건수"], ["T20", "사망자 수"], ["T30", "부상자 수"]], units:{ T20:"명", T30:"명" } },
    { id:"fires", group:G.life, title:"주민 1만 명당 화재 발생 건수", org:"101", tbl:"DT_1YL21081", objs:["ALL"], levels:both, unit:"건", items:[["T10", ""]] },
    { id:"cars", group:G.life, title:"1인당 자동차 등록 대수", org:"101", tbl:"DT_1YL20731", objs:["ALL"], levels:both, unit:"대", items:[["T10", ""]] },
    { id:"doctors", group:G.life, title:"인구 1천 명당 의사 수", org:"101", tbl:"DT_1YL20981", objs:["ALL"], levels:both, unit:"명", items:[["T10", ""]] },
    { id:"culture", group:G.life, title:"인구 10만 명당 문화시설 수(도서관·박물관 등)", org:"101", tbl:"DT_1YL20931", objs:["ALL"], levels:both, unit:"개", items:[["T10", ""]] },
    { id:"emptyHouse", group:G.life, title:"빈집 비율", org:"101", tbl:"DT_1YL202005", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },

    { id:"waste", group:G.env, title:"주민 1인당 생활 쓰레기 배출량", org:"101", tbl:"DT_1YL21321", objs:["ALL"], levels:both, unit:"kg/일", items:[["T10", ""]] },
    { id:"recycle", group:G.env, title:"생활 쓰레기 재활용률", org:"101", tbl:"DT_1YL21311", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },
    { id:"water", group:G.env, title:"상수도 보급률", org:"101", tbl:"DT_1YL20741", objs:["ALL"], levels:both, unit:"%", items:[["T10", ""]] },
    { id:"temperature", group:G.env, title:"연평균 기온", org:"101", tbl:"DT_1YL9801", objs:["ALL"], levels:sidoOnly, unit:"℃", items:[["T10", ""]] },
    { id:"park", group:G.env, title:"인구 1천 명당 도시공원 면적", org:"101", tbl:"DT_1YL21281", objs:["ALL"], levels:sidoOnly, unit:"천㎡", items:[["T10", ""]] },

    { id:"selfReliance", group:G.economy, title:"재정자립도", org:"101", tbl:"DT_1YL20921", objs:["ALL"], levels:both, unit:"%", items:[["T20", ""]] },
    { id:"grdp", group:G.economy, title:"1인당 지역내총생산(GRDP)", org:"101", tbl:"INH_1C96_02", objs:["ALL"], levels:sidoOnly, unit:"천원", items:[["T1", ""]] },
    { id:"business", group:G.economy, title:"사업체 수", org:"101", tbl:"DT_1YL20832", objs:["ALL"], levels:both, unit:"개", items:[["T10", ""]] }
  ];
  const preset = id => PRESETS.find(p => p.id === id) || null;
  const GROUPS = Object.values(G);
  // 목록의 짧은 이름은 i18n 사전에 넣지 않고 여기 영어를 둔다(사전은 '남자'·'유치원' 같은 글 조각을 화면 어디서나 바꾼다).
  const EN = {
    "인구·가구":"Population & households",
    "학교·교육":"Schools & education",
    "생활·안전":"Daily life & safety",
    "환경·기후":"Environment & climate",
    "경제·재정":"Economy & finance",
    "주민등록인구":"Registered population",
    "전체":"Total",
    "남자":"Male",
    "여자":"Female",
    "인구증가율":"Population growth rate",
    "고령인구비율(65세 이상)":"Share of people 65+",
    "청년인구비율(19~39세)":"Share of people aged 19–39",
    "평균 나이":"Average age",
    "성비(여자 100명당 남자)":"Sex ratio (males per 100 females)",
    "1인 가구 비율":"Share of one-person households",
    "혼자 사는 노인 가구 비율":"Share of seniors living alone",
    "출생아 수":"Births",
    "합계출산율":"Total fertility rate",
    "순이동 인구(들어온 사람 − 나간 사람)":"Net migration (in − out)",
    "외국인 주민 수":"Foreign residents",
    "다문화 가구 수":"Multicultural households",
    "인구밀도":"Population density",
    "초등학교 수":"Elementary schools",
    "초등학생 수":"Elementary students",
    "유치원 수":"Kindergartens",
    "유치원 원아 수":"Kindergarten children",
    "학급당 학생 수":"Students per class",
    "유치원":"Kindergarten",
    "초등학교":"Elementary school",
    "중학교":"Middle school",
    "고등학교":"High school",
    "교원 1인당 학생 수":"Students per teacher",
    "대학생 수":"University students",
    "일반대":"Universities",
    "전문대":"Junior colleges",
    "학생 1인당 월평균 사교육비":"Monthly private tutoring cost per student",
    "전체 평균":"Overall average",
    "어린이 교통사고":"Traffic accidents involving children",
    "사고 건수":"Accidents",
    "사망자 수":"Deaths",
    "부상자 수":"Injuries",
    "주민 1만 명당 화재 발생 건수":"Fires per 10,000 residents",
    "1인당 자동차 등록 대수":"Registered cars per person",
    "인구 1천 명당 의사 수":"Doctors per 1,000 people",
    "인구 10만 명당 문화시설 수(도서관·박물관 등)":"Cultural facilities per 100,000 people (libraries, museums…)",
    "빈집 비율":"Vacant house rate",
    "주민 1인당 생활 쓰레기 배출량":"Household waste per resident",
    "생활 쓰레기 재활용률":"Household waste recycling rate",
    "상수도 보급률":"Water supply coverage",
    "연평균 기온":"Annual mean temperature",
    "인구 1천 명당 도시공원 면적":"Urban park area per 1,000 people",
    "재정자립도":"Fiscal self-reliance",
    "1인당 지역내총생산(GRDP)":"GRDP per person",
    "사업체 수":"Businesses",
    "음수는 나간 사람이 더 많다는 뜻이에요. 색은 '빨강-파랑(가운데 0)'이 잘 맞아요.":"Negative means more people left than arrived. A red–blue (centered on 0) color scheme works well.",
    "인구주택총조사 기준이라 5년마다 크게 바뀌어요.":"Based on the census, so it changes mainly every five years.",
    "대학이 있는 곳만 값이 있어요.":"Only places with a university have a value."
  };
  const english = () => typeof window !== "undefined" && !!(window.MNI18N && window.MNI18N.lang === "en");
  const label = ko => (english() && EN[ko]) || ko;

  /* ── 지역 줄 → 이름 붙이기 ── */
  const SIDO_RE = /(특별시|광역시|특별자치시|특별자치도|도)$/;
  // 합계 줄: 전국·계·동부/읍부/면부·'○○시부', 그리고 통합청주시·통합창원시(옛 시·군을 합친 줄 — 청주시·창원시가 따로 온다).
  const SKIP_RE = /^(전국|합계|계|총계|소계|동부|읍부|면부)(\(.*\))?$|(시부|군부)$|^통합/;
  const codeDigits = code => { const m = text(code).match(/(\d+)$/); return m ? m[1] : ""; };
  // 받은 자료 줄([{C1, C1_NM, DT, …}]) → [{name(시도 붙인 이름), short, code, value, level:"sido"|"sgg"}]
  // skipZero: 없어진 지역(옛 군)을 값 0 으로 계속 주는 표(순이동 인구)에서 0 인 줄을 버린다.
  function regionRows(rows, { regionColumn = "C1", skipZero = false } = {}){
    const list = (Array.isArray(rows) ? rows : []).map(r => ({
      code:codeDigits(r[regionColumn]), short:text(r[regionColumn + "_NM"]), raw:text(r.DT)
    })).filter(r => r.code && r.short);
    const sidos = list.filter(r => SIDO_RE.test(r.short) && !SKIP_RE.test(r.short));
    // 가장 긴 앞머리가 같은 시도(통합특별시 아래 옛 시도 1236 이 12 보다 먼저).
    const sidoOf = r => sidos.filter(s => r.code.length > s.code.length && r.code.startsWith(s.code))
      .sort((a, b) => b.code.length - a.code.length)[0] || null;
    const byCode = new Map(list.map(r => [r.code, r]));
    const out = [], seen = new Set();
    for (const r of list){
      if (SKIP_RE.test(r.short)) continue;
      const value = /^-?[0-9]+(\.[0-9]+)?$/.test(r.raw.replace(/,/g, "")) ? Number(r.raw.replace(/,/g, "")) : null;
      if (value === null || !Number.isFinite(value) || (skipZero && value === 0)) continue;
      let name, level;
      // 시도 꼴 이름은 늘 시도다 — 통합특별시(12) 아래 옛 시도(1236 전라남도)도 2025년 경계로는 시도라서 그대로 둔다.
      // 시군구 이름은 '시·군·구'로 끝나 이 꼴에 걸리지 않는다.
      if (SIDO_RE.test(r.short)){
        name = r.short; level = "sido";
      } else {
        const parent = sidoOf(r);
        if (!parent) continue;
        // 일반구의 시: 같은 자리의 끝이 0 인 시(31011 장안구 → 31010 수원시) 또는 코드 앞머리가 시(3101011 → 31010).
        let city = null;
        if (/구$/.test(r.short)){
          const same = !/0$/.test(r.code) ? byCode.get(r.code.slice(0, -1) + "0") : null;
          const prefix = list.filter(c => c !== r && c !== parent && c.code.length > parent.code.length && c.code.length < r.code.length
            && r.code.startsWith(c.code) && /시$/.test(c.short)).sort((a, b) => b.code.length - a.code.length)[0];
          city = [same, prefix].find(c => c && c !== parent && /시$/.test(c.short) && !SIDO_RE.test(c.short)) || null;
        }
        // 이름 앞에 시도 약칭이 붙어 오는 줄('제주 제주시')은 떼고, 이름 속 빈칸('남 구')은 붙인다.
        let short = r.short;
        const words = short.split(" ");
        if (words.length > 1 && parent.short.startsWith(words[0])) short = words.slice(1).join("");
        short = short.replace(/\s+/g, "");
        name = parent.short + " " + (city ? city.short + " " : "") + short;
        level = "sgg";
      }
      if (seen.has(level + "|" + name)) continue;
      seen.add(level + "|" + name);
      out.push({ name, short:r.short, code:r.code, value, level });
    }
    return out;
  }
  // 색칠 지도 붙여넣기 칸에 넣을 글(탭으로 나눈 두 열). 값은 KOSIS 가 준 자릿수 그대로.
  function pasteText(regions, level, valueLabel){
    const rows = regions.filter(r => r.level === level);
    return [["지역", valueLabel || "값"].join("\t")].concat(rows.map(r => r.name + "\t" + r.value)).join("\n");
  }

  /* ── 메타(검색한 통계표) ── */
  function metaObjects(meta){
    const objects = new Map();
    for (const m of Array.isArray(meta) ? meta : []){
      const id = text(m.OBJ_ID);
      if (!id) continue;
      if (!objects.has(id)) objects.set(id, { id, name:text(m.OBJ_NM), order:Number(m.OBJ_ID_SN) || 0, values:[] });
      objects.get(id).values.push({ id:text(m.ITM_ID), name:text(m.ITM_NM), unit:text(m.UNIT_NM), up:text(m.UP_ITM_ID) });
    }
    const items = objects.get("ITEM") ? objects.get("ITEM").values : [];
    objects.delete("ITEM");
    const classes = [...objects.values()].sort((a, b) => a.order - b.order);
    // 지역 분류: 값에 '서울특별시'나 '전국'이 있는 분류.
    const region = classes.find(c => c.values.some(v => /^서울(특별시)?$|^전국/.test(v.name))) || null;
    return { items, classes, region };
  }
  const PRD_CODES = { "년":"Y", "월":"M", "분기":"Q", "반기":"H", "일":"D", "부정기":"IR" };
  function periods(prdMeta){
    return (Array.isArray(prdMeta) ? prdMeta : []).map(p => ({ se:PRD_CODES[text(p.PRD_SE)] || "", name:text(p.PRD_SE),
      start:text(p.STRT_PRD_DE), end:text(p.END_PRD_DE) })).filter(p => p.se);
  }
  // 연 단위 표의 고를 수 있는 해(새것부터 최대 15개).
  function yearsOf(prdList){
    const y = prdList.find(p => p.se === "Y");
    if (!y) return [];
    const start = Number(y.start.slice(0, 4)), end = Number(y.end.slice(0, 4));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const out = [];
    for (let year = end; year >= start && out.length < 15; year--) out.push(String(year));
    return out;
  }
  function searchResults(list){
    const seen = new Set();
    return (Array.isArray(list) ? list : []).flatMap(t => {
      const org = text(t.ORG_ID), tbl = text(t.TBL_ID);
      if (!/^[0-9]+$/.test(org) || !/^[A-Za-z0-9_]+$/.test(tbl) || seen.has(org + tbl)) return [];
      seen.add(org + tbl);
      return [{ org, tbl, title:text(t.TBL_NM), source:text(t.ORG_NM), start:text(t.STRT_PRD_DE), end:text(t.END_PRD_DE),
        regional:/시도|시군구|시\/군\/구|시·도|행정구역|지역별/.test(text(t.TBL_NM) + " " + text(t.CONTENTS).slice(0, 80)) }];
    });
  }

  /* ── 런처 조회 ── */
  async function get(params, signal){
    const response = await fetch("/kosis?" + new URLSearchParams(params).toString(), { signal, cache:"no-store" });
    if (!response.ok){
      let reason = "";
      try { reason = text(await response.text()); } catch(_){}
      throw new Error(/^kosis-[a-z-]+$/.test(reason) ? reason : "kosis-fetch-failed");
    }
    return response.json();
  }
  let capabilityTask = null;
  function available(){
    if (!capabilityTask) capabilityTask = fetch("/can-proxy-kosis", { cache:"no-store" })
      .then(r => r.ok ? r.text() : "").then(v => v.trim() === "yes").catch(() => false);
    return capabilityTask;
  }
  const search = (q, { signal } = {}) => get({ op:"search", q }, signal).then(searchResults);
  const meta = (org, tbl, type, { signal } = {}) => get({ op:"meta", orgId:org, tblId:tbl, type }, signal);
  // objs 는 분류 순서대로의 값 목록. year 가 비면 최신 한 기간.
  async function data({ org, tbl, item, objs, prdSe = "Y", year = "" }, { signal } = {}){
    const params = { op:"data", orgId:org, tblId:tbl, itmId:item, prdSe };
    objs.forEach((v, i) => { params["objL" + (i + 1)] = v; });
    if (year){ params.startPrdDe = year; params.endPrdDe = year; } else params.newEstPrdCnt = "1";
    const rows = await get(params, signal);
    return Array.isArray(rows) ? rows : [];
  }
  // 자주 쓰는 통계 한 개 → { regions, period, unit, title }
  async function loadPreset(id, { item = "", year = "", signal } = {}){
    const p = preset(id);
    if (!p) throw new Error("kosis-bad-request");
    const itemId = item && p.items.some(i => i[0] === item) ? item : p.items[0][0];
    const rows = await data({ org:p.org, tbl:p.tbl, item:itemId, objs:p.objs, year }, { signal });
    const itemName = (p.items.find(i => i[0] === itemId) || [])[1] || "";
    return { regions:regionRows(rows, { skipZero:!!p.skipZero }), period:rows[0] ? text(rows[0].PRD_DE) : "",
      unit:(p.units && p.units[itemId]) ?? p.unit, title:p.title + (itemName ? " — " + itemName : ""), source:text(rows[0] && rows[0].TBL_NM) };
  }

  const FAILURES = {
    "kosis-key-required":"설정 → 연결의 'KOSIS 국가통계'에 인증키를 넣어 주세요.",
    "kosis-key-invalid":"KOSIS가 인증키를 받지 않았어요. 설정 → 연결에서 키를 끝의 '=' 까지 통째로 다시 넣어 주세요.",
    "kosis-quota":"KOSIS 조회 한도를 넘었어요. 잠시 후 다시 시도해 주세요.",
    "kosis-too-many":"자료가 너무 많아요(KOSIS 한 번에 4만 칸). 분류를 좁혀 주세요.",
    "kosis-bad-request":"KOSIS에 물을 수 없는 조합이에요. 다른 항목이나 해를 골라 주세요."
  };
  const failureText = error => FAILURES[error && error.message] || "KOSIS에서 자료를 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";

  return { PRESETS, GROUPS, EN, label, preset, regionRows, pasteText, metaObjects, periods, yearsOf, searchResults,
    available, search, meta, data, loadPreset, failureText, FAILURES, text };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNKosisApi;
