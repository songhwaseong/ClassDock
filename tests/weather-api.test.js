"use strict";
/* 기상청 날씨·천문연 특일 응답 해석. 표본은 2026-09-19 실제 응답을 줄여 옮긴 것이다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../src/js/weather-api.js");

const envelope = (items, code = "00") => ({ response:{ header:{ resultCode:code, resultMsg:"NORMAL_SERVICE" },
  body:{ dataType:"JSON", items:{ item:items }, pageNo:1, numOfRows:20, totalCount:Array.isArray(items) ? items.length : 1 } } });

test("위경도를 기상청 격자로 바꾼다(기상청 안내서의 대표 지점)", () => {
  assert.deepEqual(api.toGrid(37.5714, 126.9658), { nx:60, ny:127 });   // 서울
  assert.deepEqual(api.toGrid(35.1047, 129.032), { nx:97, ny:74 });     // 부산
  assert.deepEqual(api.toGrid(33.5141, 126.5297), { nx:53, ny:38 });    // 제주
  assert.ok(api.gridOk(api.toGrid(37.48, 130.90)));                     // 울릉도도 격자 안
  assert.ok(!api.gridOk(api.toGrid(35.68, 139.69)));                    // 도쿄는 밖
});

test("가장 가까운 관측 지점을 고르고, 저장된 값이 없으면 서울", () => {
  assert.equal(api.nearestStation(37.27, 127.0).name, "수원");
  assert.equal(api.nearestStation(33.3, 126.2).name, "고산");
  assert.equal(api.station(999), null);
  assert.equal(api.STATIONS.length, 97);
  assert.equal(new Set(api.STATIONS.map(s => s.id)).size, 97);
  for (const s of api.STATIONS) assert.ok(s.lat > 33 && s.lat < 38.7 && s.lng > 124.5 && s.lng < 131.5, s.name);
  assert.equal(api.savedStation().id, api.DEFAULT_STATION);   // node 에는 localStorage 가 없다
});

test("실황 + 초단기예보 → 지금 날씨(하늘은 초단기예보의 가장 이른 시각에서)", () => {
  const ncst = envelope(["PTY:0", "REH:42", "RN1:0", "T1H:28.6", "VEC:13", "WSD:2.1"].map(pair => {
    const [category, obsrValue] = pair.split(":");
    return { baseDate:"20260919", baseTime:"1300", category, nx:60, ny:127, obsrValue };
  }));
  const ultra = envelope([
    { category:"SKY", fcstDate:"20260919", fcstTime:"1400", fcstValue:"4" },
    { category:"SKY", fcstDate:"20260919", fcstTime:"1300", fcstValue:"1" },
    { category:"LGT", fcstDate:"20260919", fcstTime:"1300", fcstValue:"0" }
  ]);
  const now = api.parseNow(ncst, ultra);
  assert.equal(now.temp, 28.6);
  assert.equal(now.humidity, 42);
  assert.equal(now.sky, 1);
  assert.equal(now.lightning, false);
  assert.equal(now.diary, "sunny");
  assert.equal(now.at, "202609191300");
  // 초단기예보가 없어도 기온은 보이고, 비가 오면 비.
  const wet = api.parseNow(envelope([{ baseDate:"20260919", baseTime:"1300", category:"PTY", obsrValue:"1" }, { baseDate:"20260919", baseTime:"1300", category:"T1H", obsrValue:"20" }]), null);
  assert.equal(wet.diary, "rainy");
  assert.equal(api.parseNow(envelope([], "03"), null), null);
});

test("단기예보 → 시간별·날짜별(TMN/TMX 는 날짜 쪽으로, 강수없음은 빈 글)", () => {
  const item = (date, time, category, value) => ({ baseDate:"20260919", baseTime:"0500", category, fcstDate:date, fcstTime:time, fcstValue:value, nx:60, ny:127 });
  const body = envelope([
    item("20260919", "0600", "TMP", "19"), item("20260919", "0600", "SKY", "3"), item("20260919", "0600", "PTY", "0"),
    item("20260919", "0600", "POP", "20"), item("20260919", "0600", "PCP", "강수없음"), item("20260919", "0600", "TMN", "18.0"),
    item("20260919", "1500", "TMP", "28"), item("20260919", "1500", "SKY", "1"), item("20260919", "1500", "PTY", "0"),
    item("20260919", "1500", "POP", "0"), item("20260919", "1500", "TMX", "28.0"),
    item("20260920", "0900", "TMP", "21"), item("20260920", "0900", "SKY", "4"), item("20260920", "0900", "PTY", "1"),
    item("20260920", "0900", "POP", "80"), item("20260920", "0900", "PCP", "1.0mm")
  ]);
  const f = api.parseForecast(body);
  assert.equal(f.hours.length, 3);
  assert.deepEqual(f.hours.map(h => h.time), ["0600", "1500", "0900"]);
  assert.equal(f.hours[0].pcp, "");
  assert.equal(f.hours[2].pcp, "1.0mm");
  assert.equal(f.hours[2].diary, "rainy");
  assert.equal(f.days[0].min, 18);
  assert.equal(f.days[0].max, 28);
  assert.equal(f.days[0].popMax, 20);
  assert.equal(f.days[1].diary, "rainy");
  // 강수확률이 낮은 한 번의 소나기는 비 오는 날로 치지 않는다.
  const shower = api.parseForecast(envelope([item("20260921", "1200", "SKY", "3"), item("20260921", "1200", "PTY", "4"), item("20260921", "1200", "POP", "30")]));
  assert.equal(shower.days[0].diary, "partly");
});

test("지난 날 관측 → 일기장 날씨(일기현상 글이 먼저, 빈 강수량은 0 이 아님)", () => {
  const day = (extra) => envelope([{ stnId:"108", stnNm:"서울", tm:"2026-09-15", avgTa:"20.4", minTa:"14.6", maxTa:"26.7",
    sumRn:"", avgTca:"0.0", iscs:"", maxWs:"4.0", ddMes:"", sumDpthFhsc:"", ...extra }]);
  const clear = api.parseDay(day({}));
  assert.equal(clear.diary, "sunny");
  assert.equal(clear.rain, null);
  assert.equal(clear.max, 26.7);
  assert.equal(clear.station, "서울");
  const rain = api.parseDay(day({ sumRn:"4.1", avgTca:"9.3", iscs:"-{비}-0055. {비}0940-1105. {비}1245-1410." }));
  assert.equal(rain.diary, "rainy");
  assert.deepEqual(rain.signs, ["비"]);
  assert.equal(api.parseDay(day({ iscs:"{소나기}1500-1520. {뇌전}1500-1530." })).diary, "storm");
  assert.equal(api.parseDay(day({ iscs:"{눈}0100-0300." })).diary, "snowy");
  assert.equal(api.parseDay(day({ iscs:"{안개}0500-0800." })).diary, "foggy");
  assert.equal(api.parseDay(day({ avgTca:"7.0" })).diary, "partly");
  assert.equal(api.parseDay(day({ avgTca:"9.5" })).diary, "cloudy");
  assert.equal(api.parseDay(day({ maxWs:"12.3" })).diary, "windy");
  assert.equal(api.parseDay({ response:{ header:{ resultCode:"03", resultMsg:"NO_DATA" } } }), null);
});

test("특일: 숫자 날짜·단건 객체·중복을 정리한다", () => {
  const holidays = api.parseSpecialDays(envelope([
    { dateKind:"01", dateName:"개천절", isHoliday:"Y", locdate:20261003, seq:1 },
    { dateKind:"01", dateName:"대체공휴일(개천절)", isHoliday:"Y", locdate:20261005, seq:1 },
    { dateKind:"01", dateName:"개천절", isHoliday:"Y", locdate:20261003, seq:1 }
  ]));
  assert.deepEqual(holidays, [
    { date:"2026-10-03", name:"개천절", holiday:true },
    { date:"2026-10-05", name:"대체공휴일(개천절)", holiday:true }
  ]);
  const term = api.parseSpecialDays(envelope({ dateKind:"03", dateName:"한로", isHoliday:"N", kst:"1529      ", locdate:20261008, seq:1 }));
  assert.deepEqual(term, [{ date:"2026-10-08", name:"한로", holiday:false }]);
  assert.deepEqual(api.parseSpecialDays({ response:{ header:{ resultCode:"00" }, body:{ items:"" } } }), []);
  assert.throws(() => api.parseSpecialDays({ response:{ header:{ resultCode:"99" } } }), /weather-invalid-data/);
});

test("오류 안내는 신청할 서비스를 짚고, 문구는 모두 영어 사전에 있다", () => {
  const i18n = fs.readFileSync(path.join(__dirname, "../src/js/i18n.js"), "utf8");
  const reasons = ["bus-key-required", "bus-key-invalid", "bus-quota", "weather-out-of-range", "weather-no-data", "weather-fetch-failed"];
  for (const service of ["forecast", "day", "special"]) for (const reason of reasons){
    const message = api.failureText(new Error(reason), service);
    assert.ok(message, reason);
    assert.ok(i18n.includes(JSON.stringify(message) + ":") || i18n.includes(JSON.stringify(message) + " :"), "번역 누락: " + message);
  }
  assert.match(api.failureText(new Error("bus-key-invalid"), "day"), /ASOS/);
  assert.match(api.failureText(new Error("bus-key-invalid"), "special"), /특일/);
});

test("지도 날씨 패널·일기장·런처가 같은 조회 길을 쓴다", () => {
  const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const launcher = read("desktop/launcher.cs"), map = read("src/js/weather-map.js"), diary = read("src/js/diary.js");
  for (const route of ["/weather-now", "/weather-ultra", "/weather-forecast", "/weather-day", "/weather-holidays", "/weather-terms", "/can-proxy-weather"])
    assert.ok(launcher.includes('"' + route), "런처에 " + route);
  // 토큰이 필요한 길로 등록되어 있다.
  assert.match(launcher, /path == "\/can-proxy-weather" \|\| path\.StartsWith\("\/weather-"/);
  assert.match(map, /map-toolvis-weather/);
  assert.match(diary, /MNWeatherApi/);
  // 지도 딱지의 날씨 그림은 icons.js 가 지우지 않게 둔다.
  assert.match(map, /map-weather-tag ui-keep-symbols/);
  for (const name of api.STATIONS.map(s => s.name).filter(n => ["서울", "부산", "제주"].includes(n))) assert.ok(read("src/js/weather-map.js").includes('"' + name + '"'));
});
