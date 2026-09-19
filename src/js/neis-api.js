"use strict";
/* NEIS 교육정보 개방 포털 — 학교 찾기·급식·학사일정·시간표 응답 해석과 런처 조회(MNNeisApi).
   일기장의 '우리 학교'가 쓴다. 고른 학교는 이 브라우저에 남긴다(문서가 아니라 사용자 편의 — 일기장 파일에는 안 담는다).
   2026-09-19 실측(키 없이 샘플 5줄):
   - 정상 응답은 {"서비스이름":[{"head":[{list_total_count},{RESULT}]},{"row":[…]}]}. 자료 없음은 {"RESULT":{"CODE":"INFO-200"}}
     → 런처가 {} 로 바꿔 준다. 틀린 키는 ERROR-290(HTTP 200).
   - 급식 메뉴(DDISH_NM)는 "발아현미밥 <br/>우렁된장찌개 (5.6)<br/>…" — <br/> 로 나뉘고 끝에 알레르기 번호가 붙는다.
   - 학사일정 SBTR_DD_SC_NM 이 "휴업일"·"공휴일"이면 쉬는 날. '토요휴업일'은 매주 있어 달력을 덮으므로 뺀다.
   - 시간표는 학교급마다 서비스가 다르다(초 elsTimetable · 중 misTimetable · 고 hisTimetable). 반 이름은 CLASS_NM.
   - 학교 이름 찾기는 부분 일치(가락 → 가락고·가락중·서울가락초…). */
const MNNeisApi = (() => {
  const text = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  function rows(body, service){
    const list = body && Array.isArray(body[service]) ? body[service] : null;
    if (!list) return { rows:[], total:0 };
    const head = (list.find(part => part && part.head) || {}).head || [];
    const total = Number((head.find(h => h && h.list_total_count != null) || {}).list_total_count) || 0;
    const found = (list.find(part => part && Array.isArray(part.row)) || {}).row || [];
    return { rows:found.filter(r => r && typeof r === "object"), total };
  }
  const ymd = date => date.getFullYear() + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
  const dashed = s => s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);

  function schools(body){
    return rows(body, "schoolInfo").rows.flatMap(r => {
      const office = text(r.ATPT_OFCDC_SC_CODE), code = text(r.SD_SCHUL_CODE), name = text(r.SCHUL_NM);
      if (!/^[A-Z][0-9]{2}$/.test(office) || !/^[0-9]{7,10}$/.test(code) || !name) return [];
      return [{ office, code, name, kind:text(r.SCHUL_KND_SC_NM), region:text(r.LCTN_SC_NM), address:text(r.ORG_RDNMA) }];
    });
  }
  // 학교 정보 카드용 — 학교 찾기 응답에 이미 오는 칸들. 없는 값(null·"")은 빈 글로 둔다.
  // 홈페이지는 http(s) 주소만 링크로 쓴다("www.…"처럼 앞이 빠진 것은 http:// 를 붙인다).
  const homepage = raw => {
    const value = text(raw);
    if (!value) return "";
    const url = /^https?:\/\//i.test(value) ? value : /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value) ? "http://" + value : "";
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch(_){ return ""; }
  };
  // "19881223" → { y, m, d }, "0428"(개교기념일) → { m, d }
  const dateParts = raw => {
    const v = text(raw);
    if (/^\d{8}$/.test(v)) return { y:Number(v.slice(0, 4)), m:Number(v.slice(4, 6)), d:Number(v.slice(6, 8)) };
    if (/^\d{4}$/.test(v)) return { m:Number(v.slice(0, 2)), d:Number(v.slice(2, 4)) };
    return null;
  };
  function schoolDetail(body, code){
    const r = rows(body, "schoolInfo").rows.find(row => text(row.SD_SCHUL_CODE) === code);
    if (!r) return null;
    const plain = v => text(v).replace(/^null$/i, "");
    return {
      name:plain(r.SCHUL_NM), english:plain(r.ENG_SCHUL_NM), kind:plain(r.SCHUL_KND_SC_NM), found:plain(r.FOND_SC_NM),
      coed:plain(r.COEDU_SC_NM), highKind:plain(r.HS_SC_NM), dayNight:plain(r.DGHT_SC_NM),
      address:[plain(r.ORG_RDNMA), plain(r.ORG_RDNDA)].filter(Boolean).join(" "), zip:plain(r.ORG_RDNZC),
      phone:plain(r.ORG_TELNO), fax:plain(r.ORG_FAXNO), homepage:homepage(r.HMPG_ADRES), office:plain(r.JU_ORG_NM),
      founded:dateParts(r.FOND_YMD), anniversary:dateParts(r.FOAS_MEMRD)
    };
  }
  // "우렁된장찌개 (5.6)" → "우렁된장찌개". 끝의 알레르기 번호·별표 표시를 지운다.
  function dishName(raw){
    return text(String(raw).replace(/\((?:\d{1,2}\.?)+\)/g, "").replace(/[*#★]+/g, "")).replace(/\s+([,])/g, "$1");
  }
  function meals(body){
    const byDate = new Map();
    for (const r of rows(body, "mealServiceDietInfo").rows){
      const date = text(r.MLSV_YMD);
      if (!/^[0-9]{8}$/.test(date)) continue;
      const dishes = String(r.DDISH_NM || "").split(/<br\s*\/?>/i).map(dishName).filter(Boolean);
      if (!dishes.length) continue;
      const key = dashed(date);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push({ type:text(r.MMEAL_SC_NM) || "중식", order:Number(r.MMEAL_SC_CODE) || 2, dishes, calories:text(r.CAL_INFO) });
    }
    for (const list of byDate.values()) list.sort((a, b) => a.order - b.order);
    return byDate;
  }
  function schedule(body){
    const byDate = new Map();
    for (const r of rows(body, "SchoolSchedule").rows){
      const date = text(r.AA_YMD), name = text(r.EVENT_NM);
      if (!/^[0-9]{8}$/.test(date) || !name || name === "토요휴업일") continue;
      const key = dashed(date);
      if (!byDate.has(key)) byDate.set(key, []);
      const list = byDate.get(key);
      if (list.some(e => e.name === name)) continue;
      list.push({ name, off:/휴업일|공휴일/.test(text(r.SBTR_DD_SC_NM)) });
    }
    return byDate;
  }
  const TIMETABLE = { "초등학교":"elsTimetable", "중학교":"misTimetable", "고등학교":"hisTimetable" };
  const timetableService = kind => TIMETABLE[kind] || (/초등/.test(kind) ? "elsTimetable" : /중학/.test(kind) ? "misTimetable" : "hisTimetable");
  function timetable(body, service){
    const seen = new Set();
    return rows(body, service).rows.flatMap(r => {
      const period = Number(r.PERIO), subject = text(r.ITRT_CNTNT).replace(/^-/, "").trim();
      if (!Number.isFinite(period) || !subject || seen.has(period)) return [];
      seen.add(period);
      return [{ period, subject }];
    }).sort((a, b) => a.period - b.period);
  }
  // 학급정보 → { "1":["1","2",…], "2":[…] } — 학년마다 반 이름(숫자는 숫자 순서, 그 밖은 가나다).
  // 한 학교를 통째로 한 번 묻는다(가락고 2026 = 3개 학년 27반). 반 이름은 "1" 말고 "가"·"사랑" 같은 학교도 있다.
  function classes(body){
    const byGrade = {};
    for (const r of rows(body, "classInfo").rows){
      const grade = text(r.GRADE), name = text(r.CLASS_NM);
      if (!/^[1-6]$/.test(grade) || !/^[0-9A-Za-z가-힣]{1,6}$/.test(name)) continue;
      const list = byGrade[grade] || (byGrade[grade] = []);
      if (!list.includes(name)) list.push(name);
    }
    const order = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b, "ko", { numeric:true });
    for (const grade of Object.keys(byGrade)) byGrade[grade].sort(order);
    return byGrade;
  }
  // 학년도는 3월에 바뀐다(1·2월은 지난 학년도).
  const schoolYear = (date = new Date()) => String(date.getMonth() < 2 ? date.getFullYear() - 1 : date.getFullYear());
  // 일기에 넣을 한 줄: "급식: 발아현미밥, 우렁된장찌개, …"
  function mealLine(list){
    const lunch = (list || []).find(m => m.type === "중식") || (list || [])[0];
    return lunch ? lunch.type + ": " + lunch.dishes.join(", ") : "";
  }

  /* ── 고른 학교(이 브라우저) ── */
  const SCHOOL_KEY = "mn.neisSchool";
  function savedSchool(){
    try {
      const s = JSON.parse(localStorage.getItem(SCHOOL_KEY) || "null");
      if (s && /^[A-Z][0-9]{2}$/.test(s.office) && /^[0-9]{7,10}$/.test(s.code) && s.name)
        return { office:s.office, code:s.code, name:text(s.name).slice(0, 60), kind:text(s.kind).slice(0, 20),
          grade:/^[1-6]$/.test(String(s.grade || "")) ? String(s.grade) : "", cls:/^[0-9A-Za-z가-힣]{1,6}$/.test(String(s.cls || "")) ? String(s.cls) : "" };
    } catch(_){}
    return null;
  }
  function saveSchool(school){
    try {
      if (!school) localStorage.removeItem(SCHOOL_KEY);
      else localStorage.setItem(SCHOOL_KEY, JSON.stringify(school));
    } catch(_){}
  }

  /* ── 런처 조회 ── */
  async function get(service, params, signal){
    const q = new URLSearchParams({ svc:service, ...params });
    const response = await fetch("/neis?" + q.toString(), { signal, cache:"no-store" });
    if (!response.ok){
      let reason = "";
      try { reason = text(await response.text()); } catch(_){}
      throw new Error(/^neis-[a-z-]+$/.test(reason) ? reason : "neis-fetch-failed");
    }
    return { body:await response.json(), sample:response.headers.get("X-ClassDock-Neis-Sample") === "1" };
  }
  let capabilityTask = null;
  function available(){
    if (!capabilityTask) capabilityTask = fetch("/can-proxy-neis", { cache:"no-store" })
      .then(r => r.ok ? r.text() : "").then(v => v.trim() === "yes").catch(() => false);
    return capabilityTask;
  }
  async function searchSchools(name, { signal, office = "" } = {}){
    const q = text(name).slice(0, 40);
    if (!q) return { schools:[], sample:false };
    const result = await get("schoolInfo", office ? { SCHUL_NM:q, ATPT_OFCDC_SC_CODE:office } : { SCHUL_NM:q }, signal);
    return { schools:schools(result.body), sample:result.sample, total:rows(result.body, "schoolInfo").total };
  }
  const base = s => ({ ATPT_OFCDC_SC_CODE:s.office, SD_SCHUL_CODE:s.code });
  // 한 달치(from~to 는 Date). 급식·일정을 따로 받아 둘 중 하나가 안 돼도 다른 쪽은 보인다.
  async function loadMonth(school, year, month, { signal } = {}){
    const from = ymd(new Date(year, month - 1, 1)), to = ymd(new Date(year, month, 0));
    const [mealResult, scheduleResult] = await Promise.allSettled([
      get("mealServiceDietInfo", { ...base(school), MLSV_FROM_YMD:from, MLSV_TO_YMD:to }, signal),
      get("SchoolSchedule", { ...base(school), AA_FROM_YMD:from, AA_TO_YMD:to }, signal)
    ]);
    if (mealResult.status === "rejected" && scheduleResult.status === "rejected") throw mealResult.reason;
    const mealBody = mealResult.status === "fulfilled" ? mealResult.value.body : {};
    const scheduleBody = scheduleResult.status === "fulfilled" ? scheduleResult.value.body : {};
    const sample = [mealResult, scheduleResult].some(r => r.status === "fulfilled" && r.value.sample);
    const truncated = sample && (rows(mealBody, "mealServiceDietInfo").total > 5 || rows(scheduleBody, "SchoolSchedule").total > 5);
    return { meals:meals(mealBody), schedule:schedule(scheduleBody), sample, truncated,
      error:[mealResult, scheduleResult].find(r => r.status === "rejected")?.reason || null };
  }
  // 고른 학교 한 곳의 자세한 정보(이름+교육청으로 찾아 학교 코드로 고른다 — 런처가 하루 캐시한다).
  async function loadSchoolDetail(school, { signal } = {}){
    const result = await get("schoolInfo", { SCHUL_NM:school.name, ATPT_OFCDC_SC_CODE:school.office }, signal);
    return schoolDetail(result.body, school.code);
  }
  // 학년·반 목록. 키 없이 받은 샘플(5줄)이면 목록이 모자라므로 complete:false 로 알린다(화면은 직접 치게 둔다).
  async function loadClasses(school, { signal, date } = {}){
    const result = await get("classInfo", { ...base(school), AY:schoolYear(date) }, signal);
    const all = rows(result.body, "classInfo");
    return { byGrade:classes(result.body), complete:!(result.sample && all.total > all.rows.length) };
  }
  async function loadTimetable(school, dateKey, { signal } = {}){
    if (!school.grade || !school.cls) return [];
    const service = timetableService(school.kind);
    const day = dateKey.replace(/-/g, "");
    const result = await get(service, { ...base(school), TI_FROM_YMD:day, TI_TO_YMD:day, GRADE:school.grade, CLASS_NM:school.cls }, signal);
    return timetable(result.body, service);
  }

  const FAILURES = {
    "neis-key-invalid":"NEIS가 인증키를 받지 않았어요. 설정 → 연결의 'NEIS 교육정보'를 확인해 주세요.",
    "neis-quota":"NEIS 조회 한도를 넘었어요. 내일 다시 이용해 주세요.",
    "neis-bad-request":"NEIS에 물을 수 없는 조합이에요."
  };
  const failureText = error => FAILURES[error && error.message] || "NEIS에서 받지 못했어요. 인터넷 연결을 확인해 주세요.";

  return { rows, schools, schoolDetail, homepage, dishName, meals, schedule, timetable, timetableService, classes, schoolYear, mealLine, savedSchool, saveSchool,
    available, searchSchools, loadSchoolDetail, loadMonth, loadClasses, loadTimetable, failureText, FAILURES, ymd };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MNNeisApi;
