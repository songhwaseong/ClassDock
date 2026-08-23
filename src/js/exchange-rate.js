"use strict";

/* 환율 공용 모듈(MNExchangeRate)
 *
 * 런처의 /exchange-rate 가 돌려준 **원본 JSON 그대로**를 화면이 쓰는 한 모양으로 바꾼다.
 * 정규화를 런처가 아니라 여기서 하는 까닭: 런처가 둘(launcher.cs·main.go)이라 파싱을 양쪽에
 * 두면 같은 규칙을 C# 과 Go 로 두 번 적고 두 번 틀린다. 지도의 /geocode 도 같은 이유로
 * "런처는 받아만 오고 뜻풀이는 JS 가" 로 나눠 두었다(map-viewer.js mapKakaoPlaces).
 *
 * DOM·fetch 를 쓰지 않는 순수 모듈이라 node --test 로 그대로 검증한다. 창·버튼은 exchange-rate-ui.js.
 *
 * 두 출처의 성질이 다르다 — 표에 무엇을 보여 줄지가 갈리므로 화면이 아니라 여기서 구분한다.
 *   koreaexim : 한국수출입은행 고시환율. 매매기준율 + 송금 보낼 때(tts)·받을 때(ttb) 까지 있고,
 *               영업일에만, 그것도 11시 무렵 이후에 그날 값이 뜬다. 없는 날은 빈 배열이 온다.
 *   ecb       : 유럽중앙은행 참고환율(Frankfurter). 키가 없어도 되고 휴일이면 직전 영업일 값을
 *               알아서 돌려주지만 송금 값이 없다. 국내 은행 고시환율과는 다른 수치다.
 */
const MNExchangeRate = (function(){

  const SOURCES = {
    koreaexim: {
      id:"koreaexim",
      label:"수출입은행 고시환율",
      note:"한국수출입은행이 영업일마다 고시하는 매매기준율입니다. 오전 11시 무렵에 그날 값이 올라옵니다.",
      needsKey:true,
      hasTransfer:true,         // 송금 보낼 때·받을 때 칸이 있는가
      // 표 머리글·안내에 쓰는 말. ECB 값을 "매매기준율" 이라 부르면 은행 고시환율로 오해한다.
      baseLabel:"매매기준율",
      missingNote:"고시가 없어 가장 가까운 고시일을 보여드려요"
    },
    ecb: {
      id:"ecb",
      label:"ECB 참고환율",
      note:"유럽중앙은행이 매 영업일 오후에 내는 참고환율입니다. 키가 없어도 쓸 수 있지만 은행 고시환율과는 다릅니다.",
      needsKey:false,
      hasTransfer:false,
      baseLabel:"참고환율",
      missingNote:"자료가 없어 가장 가까운 영업일을 보여드려요"
    }
  };

  /* ECB 쪽은 통화 이름을 주지 않아 여기서 붙인다(수출입은행은 cur_nm 을 함께 준다).
     Frankfurter 가 내주는 통화 전부 + 기준통화인 EUR. */
  const CURRENCY_NAMES = {
    AUD:"호주 달러", BGN:"불가리아 레프", BRL:"브라질 헤알", CAD:"캐나다 달러", CHF:"스위스 프랑",
    CNY:"중국 위안", CZK:"체코 코루나", DKK:"덴마크 크로네", EUR:"유로", GBP:"영국 파운드",
    HKD:"홍콩 달러", HUF:"헝가리 포린트", IDR:"인도네시아 루피아", ILS:"이스라엘 셰켈",
    INR:"인도 루피", ISK:"아이슬란드 크로나", JPY:"일본 엔", KRW:"대한민국 원", MXN:"멕시코 페소",
    MYR:"말레이시아 링깃", NOK:"노르웨이 크로네", NZD:"뉴질랜드 달러", PHP:"필리핀 페소",
    PLN:"폴란드 즈워티", RON:"루마니아 레우", SEK:"스웨덴 크로나", SGD:"싱가포르 달러",
    THB:"태국 바트", TRY:"튀르키예 리라", USD:"미국 달러", ZAR:"남아프리카 랜드"
  };

  /* 수업에서 먼저 찾는 통화를 표 맨 위로 올린다. 나머지는 코드 순서. */
  const PINNED = ["USD", "JPY", "EUR", "CNY", "GBP"];

  /* 100단위로 고시하는 통화. 수출입은행이 JPY(100)·IDR(100) 로 주는 것과 같은 단위를 ECB 쪽에도
     맞춰 준다 — 출처를 바꿨을 뿐인데 "일본 엔 872원" 과 "일본 엔 8.72원" 이 번갈아 나오면
     같은 줄이 다른 뜻으로 읽힌다. */
  const UNIT_100 = ["JPY", "IDR"];

  /* 런처가 돌려주는 오류 코드 → 화면에 그대로 띄울 우리말.
     런처(launcher.cs·main.go)와 문자열이 같아야 한다. */
  const ERROR_TEXT = {
    "rate-key-required":"수출입은행 인증키가 없어요 — 설정 → 환율에서 키를 등록해 주세요.",
    "rate-key-invalid":"수출입은행 인증키가 올바르지 않아요. 발급받은 인증키인지 확인해 주세요.",
    "rate-limit-reached":"수출입은행 API 의 하루 조회 한도(1,000회)를 다 썼어요. 내일 다시 시도해 주세요.",
    "rate-bad-date":"그 날짜로는 조회할 수 없어요.",
    "rate-bad-request":"조회 조건이 올바르지 않아요.",
    "rate-no-data":"그날은 고시환율이 없어요 — 주말·공휴일이거나 아직 오전 고시 전입니다.",
    "rate-too-large":"받아 온 환율 자료가 너무 커요.",
    "rate-failed":"환율을 받아오지 못했어요 — 인터넷 연결을 확인해 주세요.",
    "rate-unavailable":"환율 조회는 ClassDock 런처(ClassDock.exe)로 열었을 때만 쓸 수 있어요."
  };
  const errorText = (code) => ERROR_TEXT[String(code || "")] || ERROR_TEXT["rate-failed"];

  /* ── 날짜 ──
     수출입은행 고시는 한국 시간 기준이고 이 앱은 그 교실 PC 에서 돈다 — UTC 로 바꾸면 자정 무렵
     하루가 어긋나므로 어디서나 그 PC 의 달력 날짜를 쓴다. */
  function dateKey(date){
    const d = date instanceof Date ? date : new Date();
    const pad = (n) => (n < 10 ? "0" : "") + n;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function shiftDate(key, days){
    const parts = String(key || "").split("-");
    if (parts.length !== 3) return "";
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isFinite(d.getTime())) return "";
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }
  const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  const compactDate = (key) => String(key || "").replace(/-/g, "");   // 수출입은행은 YYYYMMDD

  /* ── 숫자 ──
     API 가 주는 값은 "1,384.2" 처럼 천 단위 쉼표가 붙은 문자열이다. 빈 칸·null 을 Number() 에
     그냥 넘기면 0 이 되어 "환율 0원" 이 표로 나가므로, 적혀 있는지부터 보고 아니면 null 로 둔다. */
  function parseNumber(value){
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/,/g, "").trim();
    if (text === "") return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  /* 수출입은행의 cur_unit 은 "USD" 이거나 "JPY(100)" 처럼 고시 단위를 괄호로 달고 온다.
     100엔당 값을 1엔당으로 바꿔 버리면 사람들이 아는 "100엔 = ○○원" 표기와 어긋나므로,
     고시된 그대로(base) 보여 주고 계산에는 1단위값(perOne)을 따로 둔다. */
  function parseUnit(curUnit){
    const raw = String(curUnit || "").trim().toUpperCase();
    const matched = /^([A-Z]{3,4})\s*(?:\((\d+)\))?$/.exec(raw);
    if (!matched) return null;
    const unit = matched[2] ? Number(matched[2]) : 1;
    return { code:matched[1], unit:unit > 0 ? unit : 1 };
  }
  // cur_nm 도 "일본 옌(100)" 처럼 단위를 달고 온다 — 단위는 따로 들고 있으니 이름에서는 뗀다.
  const cleanName = (value) => String(value || "").replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();

  function makeRate(code, name, unit, base, send, recv){
    const perOne = (base !== null && unit > 0) ? base / unit : null;
    return {
      code, name: name || CURRENCY_NAMES[code] || code,
      unit, base, perOne,
      send: send === undefined ? null : send,
      recv: recv === undefined ? null : recv
    };
  }
  function sortRates(rates){
    const rank = (code) => { const at = PINNED.indexOf(code); return at < 0 ? PINNED.length : at; };
    return rates.slice().sort((a, b) => (rank(a.code) - rank(b.code)) || a.code.localeCompare(b.code));
  }

  /* ── 수출입은행 ──
     HTTP 는 늘 200 이고 잘못은 본문의 result 로만 온다(1 성공 · 2 DATA 코드 오류 ·
     3 인증코드 오류 · 4 일일제한횟수 마감). 없는 날은 빈 배열이다. */
  const KOREAEXIM_RESULT_ERROR = { 2:"rate-bad-date", 3:"rate-key-invalid", 4:"rate-limit-reached" };

  function normalizeKoreaexim(raw, requested){
    if (!Array.isArray(raw)) return { ok:false, code:"rate-failed" };
    if (!raw.length) return { ok:false, code:"rate-no-data" };
    const first = raw[0] || {};
    const result = Number(first.result);
    if (KOREAEXIM_RESULT_ERROR[result]) return { ok:false, code:KOREAEXIM_RESULT_ERROR[result] };
    const rates = [];
    for (const item of raw){
      if (!item || Number(item.result) !== 1) continue;
      const unit = parseUnit(item.cur_unit);
      if (!unit) continue;
      const base = parseNumber(item.deal_bas_r);
      if (base === null) continue;                       // 매매기준율이 없는 줄은 표에 쓸 데가 없다
      rates.push(makeRate(unit.code, cleanName(item.cur_nm), unit.unit,
        base, parseNumber(item.tts), parseNumber(item.ttb)));
    }
    if (!rates.length) return { ok:false, code:"rate-no-data" };
    /* 이 API 는 응답에 날짜를 담지 않는다 — 조회한 날짜가 곧 고시일이다. */
    return { ok:true, source:"koreaexim", date:requested, requested, rates:sortRates(rates) };
  }

  /* ── ECB(Frankfurter) ──
     기준통화는 유로다. KRW 를 기준으로 부르면 소수 다섯 자리로 잘려(USD 0.00072) 되돌릴 때
     원 단위가 흔들리므로, 유로 기준으로 받아 KRW ÷ 해당통화 로 교차환율을 낸다. */
  function normalizeEcb(raw, requested){
    const rates = raw && typeof raw === "object" ? raw.rates : null;
    if (!rates || typeof rates !== "object") return { ok:false, code:"rate-failed" };
    const krwPerEur = parseNumber(rates.KRW);
    if (krwPerEur === null) return { ok:false, code:"rate-no-data" };
    const out = [];
    const unitOf = (code) => (UNIT_100.indexOf(code) >= 0 ? 100 : 1);
    for (const code of Object.keys(rates)){
      if (code === "KRW") continue;
      const perEur = parseNumber(rates[code]);
      if (perEur === null || perEur === 0) continue;
      const unit = unitOf(code);
      out.push(makeRate(code, CURRENCY_NAMES[code], unit, (krwPerEur / perEur) * unit));
    }
    // 기준통화인 유로는 rates 에 들어 있지 않다 — 1유로 = KRW 값을 직접 넣어 준다.
    const base = String((raw && raw.base) || "EUR").toUpperCase();
    if (base === "EUR") out.push(makeRate("EUR", CURRENCY_NAMES.EUR, 1, krwPerEur));
    if (!out.length) return { ok:false, code:"rate-no-data" };
    const date = isDateKey(raw.date) ? raw.date : requested;
    return { ok:true, source:"ecb", date, requested, rates:sortRates(out) };
  }

  /* 기간 조회(Frankfurter 의 start..end)는 한 번에 여러 날이 온다.
     차트로 갈 값이라 통화 하나만 뽑아 날짜 순으로 편다. */
  function normalizeEcbSeries(raw, code){
    const days = raw && typeof raw === "object" ? raw.rates : null;
    if (!days || typeof days !== "object") return { ok:false, code:"rate-failed" };
    const want = String(code || "").toUpperCase();
    const points = [];
    for (const date of Object.keys(days).sort()){
      const row = days[date] || {};
      const krwPerEur = parseNumber(row.KRW);
      const perEur = want === "EUR" ? 1 : parseNumber(row[want]);
      if (krwPerEur === null || perEur === null || perEur === 0) continue;
      points.push({ date, value:krwPerEur / perEur });
    }
    if (!points.length) return { ok:false, code:"rate-no-data" };
    return { ok:true, source:"ecb", code:want, points };
  }

  /* ── 계산 ──
     외화 → 원은 곱하기, 원 → 외화는 나누기. 1단위값(perOne)으로만 계산해 고시 단위(100엔 등)에
     휘둘리지 않게 한다. */
  const findRate = (result, code) =>
    (result && Array.isArray(result.rates) ? result.rates : [])
      .find(r => r.code === String(code || "").toUpperCase()) || null;

  function convert(amount, rate, toKrw){
    const value = parseNumber(amount);
    if (value === null || !rate || rate.perOne === null || rate.perOne === 0) return null;
    return toKrw ? value * rate.perOne : value / rate.perOne;
  }

  /* 화폐 표시 — 원은 소수점이 필요 없고, 외화는 작을수록 자릿수를 늘려야 0 으로 보이지 않는다. */
  function formatMoney(value, digits){
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
    const number = Number(value);
    let places = digits;
    if (places === undefined){
      const size = Math.abs(number);
      places = size === 0 ? 2 : size >= 100 ? 2 : size >= 1 ? 3 : size >= 0.01 ? 4 : 6;
    }
    return number.toLocaleString("ko-KR", { minimumFractionDigits:places, maximumFractionDigits:places });
  }

  /* ── 내보내기 ──
     표 편집기·CSV·복사가 같은 줄을 쓰도록 여기서 한 번만 만든다(머리글 포함). */
  function toRows(result){
    if (!result || !Array.isArray(result.rates)) return [];
    const source = SOURCES[result.source] || SOURCES.ecb;
    const transfer = !!source.hasTransfer;
    const head = ["통화", "코드", "단위", source.baseLabel + "(원)"];
    if (transfer) head.push("송금 보낼 때(원)", "송금 받을 때(원)");
    const rows = [head];
    for (const rate of result.rates){
      const row = [rate.name, rate.code, String(rate.unit), formatMoney(rate.base, 2)];
      if (transfer) row.push(formatMoney(rate.send, 2), formatMoney(rate.recv, 2));
      rows.push(row);
    }
    return rows;
  }
  function seriesToRows(series){
    const rows = [["날짜", "1 " + String((series && series.code) || "") + " (원)"]];
    for (const point of ((series && series.points) || [])) rows.push([point.date, formatMoney(point.value, 2)]);
    return rows;
  }

  return {
    SOURCES, CURRENCY_NAMES, PINNED, ERROR_TEXT,
    errorText, dateKey, shiftDate, isDateKey, compactDate,
    parseNumber, parseUnit, cleanName,
    normalizeKoreaexim, normalizeEcb, normalizeEcbSeries,
    findRate, convert, formatMoney, toRows, seriesToRows
  };
})();

if (typeof module !== "undefined" && module.exports){
  module.exports = MNExchangeRate;
}
