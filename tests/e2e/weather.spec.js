const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 기상청 날씨·천문연 특일 — 지도 '날씨' 패널과 일기장(날씨 채우기·공휴일 달력).
 * 응답 뜻풀이는 tests/weather-api.test.js 가 지킨다. 여기서는 런처 응답을 흉내 내고 화면 계약만 본다. */

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const addDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const envelope = (items) => JSON.stringify({ response:{ header:{ resultCode:"00", resultMsg:"NORMAL_SERVICE" },
  body:{ dataType:"JSON", items:items.length ? { item:items } : "", pageNo:1, numOfRows:1000, totalCount:items.length } } });

function forecastItems(){
  // 오늘부터 사흘치 한 시간 간격: 오늘·내일 맑음, 모레 비(강수확률 80).
  const items = [];
  for (let day = 0; day < 3; day++){
    const date = ymd(addDays(day));
    for (let h = 0; h < 24; h++){
      const time = pad(h) + "00";
      const rain = day === 2;
      items.push({ category:"TMP", fcstDate:date, fcstTime:time, fcstValue:String(18 + (h > 12 ? 24 - h : h) / 2) });
      items.push({ category:"SKY", fcstDate:date, fcstTime:time, fcstValue:rain ? "4" : "1" });
      items.push({ category:"PTY", fcstDate:date, fcstTime:time, fcstValue:rain ? "1" : "0" });
      items.push({ category:"POP", fcstDate:date, fcstTime:time, fcstValue:rain ? "80" : "10" });
    }
    items.push({ category:"TMN", fcstDate:date, fcstTime:"0600", fcstValue:"17.0" });
    items.push({ category:"TMX", fcstDate:date, fcstTime:"1500", fcstValue:"27.0" });
  }
  return items;
}

async function stubLauncher(page, options = {}){
  const asked = [];
  await page.route("**/can-proxy-weather", (route) => options.weather === false
    ? route.fulfill({ status:404, contentType:"text/plain", body:"Not found" })
    : route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  // 'weather-*' 글롭은 src/js/weather-api.js 까지 가로챈다 → 런처 길(/weather-…)만 고른다.
  await page.route((url) => /^\/weather-/.test(url.pathname), (route) => {
    const url = new URL(route.request().url());
    asked.push(url.pathname + url.search);
    if (options.keyInvalid) return route.fulfill({ status:428, contentType:"text/plain", body:"bus-key-invalid" });
    const json = (items) => route.fulfill({ status:200, contentType:"application/json", body:envelope(items) });
    switch (url.pathname){
      case "/weather-now": return json([["PTY", "0"], ["REH", "42"], ["RN1", "0"], ["T1H", "28.6"], ["WSD", "2.1"]]
        .map(([category, obsrValue]) => ({ baseDate:ymd(new Date()), baseTime:"1300", category, obsrValue })));
      case "/weather-ultra": return json([{ category:"SKY", fcstDate:ymd(new Date()), fcstTime:"2300", fcstValue:"3" }]);
      case "/weather-forecast": return json(forecastItems());
      case "/weather-day": return json([{ stnId:url.searchParams.get("stn"), stnNm:"수원", tm:"2026-01-01", avgTa:"1.2", minTa:"-3.4", maxTa:"5.6",
        sumRn:"", avgTca:"8.0", iscs:"{눈}0100-0300.", maxWs:"3.0", ddMes:"", sumDpthFhsc:"" }]);
      case "/weather-holidays": {
        const ym = url.searchParams.get("year") + url.searchParams.get("month");
        return json([{ dateKind:"01", dateName:"시험공휴일", isHoliday:"Y", locdate:Number(ym + "15"), seq:1 }]);
      }
      case "/weather-terms": return json([]);
      default: return route.fulfill({ status:400, contentType:"text/plain", body:"bus-bad-request" });
    }
  });
  await page.route("**/tile-proxy**", (route) => route.abort());
  return asked;
}
async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko");
      localStorage.removeItem("mn.weatherStation"); localStorage.removeItem("mn.specialDays.v1"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
}

test("런처가 아니면 지도 날씨 단추는 눌리지 않고 일기장에도 기상청 칸이 없다", async ({ page }) => {
  await stubLauncher(page, { weather:false });
  await boot(page);
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-toolvis-weather")).toBeDisabled();
  await page.evaluate(() => window.newDiaryScratch());
  await page.locator(".diary-pick[data-pick=weather]").click();
  await expect(page.locator(".diary-pick-pop")).toBeVisible();
  await expect(page.locator(".diary-wx-auto")).toHaveCount(0);
});

test("지도 가운데 날씨: 지금·시간별·날짜별을 보이고 문서는 바꾸지 않는다, 전국 도시 딱지", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked = await stubLauncher(page);
  await boot(page);
  await page.evaluate(() => newMapScratch());
  const model = () => page.evaluate(() => { const d = docs.find(x => x.kind === "map"); const { center, zoom, ...rest } = JSON.parse(JSON.stringify(d.mapDoc)); return JSON.stringify(rest); });
  const before = await model();

  const toggle = page.locator(".map-toolvis-weather");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await page.locator(".map-weather-here").click();
  await expect(page.locator(".map-weather-now-temp")).toHaveText("28.6°");
  await expect(page.locator(".map-weather-now-desc")).toHaveText("구름많음");   // 하늘은 초단기예보 값(3)
  await expect(page.locator(".map-weather-day")).toHaveCount(3);
  await expect(page.locator(".map-weather-day").nth(2)).toContainText("모레");
  await expect(page.locator(".map-weather-day").nth(2)).toContainText("80%");
  expect(await page.locator(".map-weather-hour").count()).toBeGreaterThan(0);
  await expect(page.locator(".map-weather-place")).toContainText("격자");
  await expect(page.locator(".map-weather-tag.is-here")).toHaveCount(1);
  // 격자로 물었다(위경도가 아니라).
  expect(asked.some(q => /^\/weather-now\?nx=\d+&ny=\d+$/.test(q))).toBe(true);
  await page.screenshot({ path:"test-results/weather-map-here.png" });

  await page.locator(".map-weather-cities").click();
  await expect(page.locator(".map-weather-tag")).toHaveCount(19);
  await expect(page.locator(".map-weather-status")).toContainText("수신");
  await page.screenshot({ path:"test-results/weather-map-cities.png" });

  expect(await model()).toBe(before);
  // 켜진 단추를 다시 누르면 지우고 닫는다.
  await toggle.click();
  await expect(page.locator(".map-weather-tag")).toHaveCount(0);
  await expect(page.locator(".map-weather-panel")).toBeHidden();
  expect(errors).toEqual([]);
});

test("키 문제면 어느 서비스를 신청할지 알려 준다", async ({ page }) => {
  await stubLauncher(page, { keyInvalid:true });
  await boot(page);
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-toolvis-weather").click();
  await page.locator(".map-weather-here").click();
  await expect(page.locator(".map-weather-status")).toContainText("기상청_단기예보 조회서비스");
});

test("일기장: 공휴일은 달력에 빨갛게, 날씨는 오늘=실황·지난 날=관측·앞날=예보로 채운다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked = await stubLauncher(page);
  await boot(page);
  await page.evaluate(() => window.newDiaryScratch());
  const today = new Date();
  const holiday = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-15";
  const cell = page.locator(`.diary-cal-day[data-date="${holiday}"]`);
  await expect(cell).toHaveClass(/is-holiday/);
  await expect(cell).toHaveAttribute("title", "시험공휴일");

  // 오늘 — 실황(하늘은 초단기예보: 구름많음 → 구름 조금)
  const pick = page.locator(".diary-pick[data-pick=weather]");
  await pick.click();
  await expect(page.locator(".diary-wx-place")).toHaveValue("108");
  await page.locator(".diary-wx-fill").click();
  await expect(page.locator(".diary-wx-note")).toContainText("서울 지금");
  await expect(pick).toHaveAttribute("title", /구름 조금/);
  await page.screenshot({ path:"test-results/weather-diary-today.png" });

  // 모레 — 예보(비). 지역을 바꾸면 기억한다.
  await page.keyboard.press("Escape");
  await page.locator(".diary-day-nav").last().click();
  await page.locator(".diary-day-nav").last().click();
  await pick.click();
  await page.locator(".diary-wx-place").selectOption("119");
  await page.locator(".diary-wx-fill").click();
  await expect(page.locator(".diary-wx-note")).toContainText("수원 예보");
  await expect(page.locator(".diary-wx-note")).toContainText("강수확률 80%");
  await expect(pick).toHaveAttribute("title", /비/);
  expect(await page.evaluate(() => localStorage.getItem("mn.weatherStation"))).toBe("119");

  // 지난 날 — 관측(눈), 지점 번호로 묻는다.
  await page.keyboard.press("Escape");
  const past = dayKey(addDays(-3));
  await page.evaluate((key) => { const b = document.querySelector(`.diary-cal-day[data-date="${key}"]`); if (b) b.click(); }, past);
  if (!(await page.locator(`.diary-cal-day[data-date="${past}"]`).count())){
    await page.locator(".diary-cal-nav").first().click();
    await page.locator(`.diary-cal-day[data-date="${past}"]`).click();
  }
  await pick.click();
  await page.locator(".diary-wx-fill").click();
  await expect(page.locator(".diary-wx-note")).toContainText("수원 관측");
  await expect(pick).toHaveAttribute("title", /눈/);
  expect(asked.some(q => q === "/weather-day?stn=119&date=" + past.replace(/-/g, ""))).toBe(true);
  expect(errors).toEqual([]);
});
