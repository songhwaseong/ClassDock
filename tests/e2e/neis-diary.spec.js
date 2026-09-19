const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");

/* 일기장 '우리 학교'(NEIS). 뜻풀이는 tests/neis-api.test.js 가 지킨다. 여기서는 런처(/neis)를 흉내 내고
   학교 고르기 → 달력 학사일정 → 날짜 줄(급식·일정·시간표) → 급식을 일기에 넣기 흐름을 본다. */

const pad = (n) => String(n).padStart(2, "0");
const today = new Date();
const ym = today.getFullYear() + pad(today.getMonth() + 1);
const todayYmd = ym + pad(today.getDate());
const MNNeisSchoolYear = String(today.getMonth() < 2 ? today.getFullYear() - 1 : today.getFullYear());
const wrap = (service, row) => JSON.stringify({ [service]:[{ head:[{ list_total_count:row.length }, { RESULT:{ CODE:"INFO-000" } }] }, { row }] });

async function stubLauncher(page, options = {}){
  const asked = [];
  await page.route("**/can-proxy-neis", (route) => options.neis === false
    ? route.fulfill({ status:404, body:"Not found" }) : route.fulfill({ status:200, contentType:"text/plain", body:"yes" }));
  await page.route((url) => url.pathname === "/neis", (route) => {
    const q = new URL(route.request().url()).searchParams;
    asked.push(Object.fromEntries(q));
    const reply = (body) => route.fulfill({ status:200, contentType:"application/json", body,
      headers:{ "X-ClassDock-Neis-Sample":options.sample ? "1" : "0" } });
    switch (q.get("svc")){
      case "schoolInfo": return reply(wrap("schoolInfo", [
        { ATPT_OFCDC_SC_CODE:"B10", SD_SCHUL_CODE:"7010057", SCHUL_NM:"가락고등학교", SCHUL_KND_SC_NM:"고등학교", ORG_RDNMA:"서울특별시 송파구 송이로 42",
          ORG_RDNDA:"(송파동,가락고등학교)", ORG_RDNZC:"05678 ", FOND_SC_NM:"공립", COEDU_SC_NM:"남여공학", HS_SC_NM:"일반고", ORG_TELNO:"02-416-4658",
          HMPG_ADRES:"http://garak.sen.hs.kr", JU_ORG_NM:"서울특별시교육청", FOND_YMD:"19881223", FOAS_MEMRD:"19890428" },
        { ATPT_OFCDC_SC_CODE:"B10", SD_SCHUL_CODE:"7130165", SCHUL_NM:"가락중학교", SCHUL_KND_SC_NM:"중학교", ORG_RDNMA:"서울특별시 송파구 송이로 45" }
      ]));
      case "mealServiceDietInfo": return reply(wrap("mealServiceDietInfo", [
        { MMEAL_SC_CODE:"2", MMEAL_SC_NM:"중식", MLSV_YMD:todayYmd, DDISH_NM:"발아현미밥 <br/>우렁된장찌개 (5.6)<br/>배추김치 (9)", CAL_INFO:"721.4 Kcal" }
      ]));
      case "SchoolSchedule": return reply(wrap("SchoolSchedule", [
        { AA_YMD:ym + "10", EVENT_NM:"체육대회", SBTR_DD_SC_NM:"해당없음" },
        { AA_YMD:ym + "12", EVENT_NM:"토요휴업일", SBTR_DD_SC_NM:"휴업일" },
        { AA_YMD:ym + "20", EVENT_NM:"재량휴업일", SBTR_DD_SC_NM:"휴업일" }
      ]));
      case "classInfo":
        if (options.noClasses) return route.fulfill({ status:503, contentType:"text/plain", body:"neis-fetch-failed" });
        return reply(wrap("classInfo", [["1", "1"], ["1", "2"], ["1", "3"], ["1", "10"], ["2", "1"], ["2", "2"], ["3", "1"]]
          .map(([GRADE, CLASS_NM]) => ({ GRADE, CLASS_NM, AY:q.get("AY") }))));
      case "hisTimetable": return reply(wrap("hisTimetable", [
        { PERIO:"2", ITRT_CNTNT:"통합사회2" }, { PERIO:"1", ITRT_CNTNT:"공통영어2" }
      ]));
      default: return route.fulfill({ status:400, contentType:"text/plain", body:"neis-bad-request" });
    }
  });
  // 날씨·특일은 이 시험과 무관 — 런처가 없는 것처럼.
  await page.route("**/can-proxy-weather", (route) => route.fulfill({ status:404, body:"Not found" }));
  return asked;
}
async function boot(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); localStorage.removeItem("mn.neisSchool"); } catch(_){}
  });
  await collapseSidebar(page);
  await page.goto("/");
  await expect(page.locator("#commandPaletteOpen")).toBeVisible();
  await page.evaluate(() => window.newDiaryScratch());
  await expect(page.locator(".diary-paper")).toBeVisible();
}

test("런처가 아니면 학교 단추도 날짜 줄도 없다", async ({ page }) => {
  await stubLauncher(page, { neis:false });
  await boot(page);
  await expect(page.locator(".diary-school-btn")).toBeHidden();
  await expect(page.locator(".diary-school")).toBeHidden();
});

test("학교를 고르면 달력에 학사일정, 날짜 줄에 급식·시간표가 나오고 급식을 일기에 넣는다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked = await stubLauncher(page);
  await boot(page);
  const btn = page.locator(".diary-school-btn");
  await expect(btn).toBeVisible();
  await btn.click();
  const panel = page.locator(".diary-school-panel");
  await expect(panel).toBeVisible();
  await panel.locator(".diary-school-q").fill("가락");
  await panel.locator(".diary-school-q").press("Enter");
  await expect(panel.locator(".diary-school-result")).toHaveCount(2);
  await panel.locator(".diary-school-result").first().click();
  await expect(panel.locator(".diary-school-current")).toContainText("가락고등학교");
  // 학교 정보 카드: 구분·주소·전화·홈페이지(새 창 링크)·관할·개교기념일·설립일.
  const card = panel.locator(".diary-school-card");
  await expect(card.locator(".diary-school-card-label")).toHaveText(["구분", "주소", "전화", "홈페이지", "관할", "개교기념일", "설립일"]);
  await expect(card).toContainText("고등학교 · 공립 · 남여공학 · 일반고");
  await expect(card).toContainText("(05678) 서울특별시 송파구 송이로 42");
  await expect(card).toContainText("4월 28일");
  await expect(card).toContainText("1988년 12월 23일");
  const link = card.locator("a.diary-school-card-value");
  await expect(link).toHaveText("garak.sen.hs.kr");
  await expect(link).toHaveAttribute("href", "http://garak.sen.hs.kr/");
  await expect(link).toHaveAttribute("target", "_blank");
  expect(asked.filter(q => q.svc === "schoolInfo").pop()).toMatchObject({ SCHUL_NM:"가락고등학교", ATPT_OFCDC_SC_CODE:"B10" });
  await page.screenshot({ path:"test-results/neis-school-card.png" });

  // 달력: 체육대회(행사)·재량휴업일(쉬는 날), 토요휴업일은 빼고.
  const day10 = page.locator(`.diary-cal-day[data-date="${today.getFullYear()}-${pad(today.getMonth() + 1)}-10"]`);
  await expect(day10).toHaveClass(/has-school-event/);
  await expect(day10).toHaveAttribute("title", /체육대회/);
  await expect(page.locator(`.diary-cal-day[data-date="${today.getFullYear()}-${pad(today.getMonth() + 1)}-20"]`)).toHaveClass(/is-school-off/);
  await expect(page.locator(`.diary-cal-day[data-date="${today.getFullYear()}-${pad(today.getMonth() + 1)}-12"]`)).not.toHaveClass(/has-school-event/);

  // 날짜 줄: 오늘 급식(알레르기 번호 없이), 학년·반을 고르면 시간표.
  const strip = page.locator(".diary-school");
  await expect(strip).toBeVisible();
  await expect(strip.locator(".is-meal .diary-school-text")).toHaveText("발아현미밥, 우렁된장찌개, 배추김치");
  await expect(strip.locator(".is-timetable .diary-school-text")).toContainText("학년·반을 고르면");
  // 학년·반은 NEIS 학급정보 목록에서 고른다(반은 숫자 순서: 1, 2, 3, 10).
  const clsPick = panel.locator(".diary-school-cls-pick");
  await expect(clsPick).toBeVisible();
  await expect(panel.locator(".diary-school-cls")).toBeHidden();
  await expect(panel.locator(".diary-school-grade option")).toHaveText(["학년", "1학년", "2학년", "3학년"]);
  await expect(clsPick).toBeDisabled();
  await panel.locator(".diary-school-grade").selectOption("1");
  await expect(clsPick.locator("option")).toHaveText(["반", "1반", "2반", "3반", "10반"]);
  await clsPick.selectOption("3");
  await expect(strip.locator(".is-timetable .diary-school-text")).toHaveText("1교시 공통영어2 · 2교시 통합사회2");
  expect(asked.find(q => q.svc === "classInfo")).toMatchObject({ ATPT_OFCDC_SC_CODE:"B10", SD_SCHUL_CODE:"7010057", AY:MNNeisSchoolYear });
  expect(asked.find(q => q.svc === "hisTimetable")).toMatchObject({ ATPT_OFCDC_SC_CODE:"B10", SD_SCHUL_CODE:"7010057", GRADE:"1", CLASS_NM:"3", TI_FROM_YMD:todayYmd });
  // 마우스로 고르면 포커스가 반 목록에 남는다 — 거기서 Esc 로 닫는다.
  await clsPick.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.screenshot({ path:"test-results/neis-diary.png" });

  // 급식을 일기에 넣기 — 본문 끝에 한 줄, 저장 안 됨 표시.
  await page.locator(".diary-text").fill("오늘은 체육 시간이 즐거웠다.");
  await strip.locator(".diary-school-insert").click();
  await expect(page.locator(".diary-text")).toHaveValue("오늘은 체육 시간이 즐거웠다.\n중식: 발아현미밥, 우렁된장찌개, 배추김치");
  await expect(page.locator(".diary-status")).toContainText("저장 안 됨");
  // 고른 학교는 이 브라우저에 남는다(일기장 파일에는 없다).
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mn.neisSchool")))).toMatchObject({ code:"7010057", grade:"1", cls:"3" });
  const model = await page.evaluate(() => JSON.stringify(docs.find(d => d.kind === "diary").diary));
  expect(model).not.toContain("7010057");
  expect(errors).toEqual([]);
});

test("학년을 바꾸면 그 학년의 반 목록으로 바뀌고, 없는 반은 비운다", async ({ page }) => {
  await stubLauncher(page);
  await page.addInitScript(() => { try { localStorage.setItem("mn.neisSchool", JSON.stringify({ office:"B10", code:"7010057", name:"가락고등학교", kind:"고등학교", grade:"1", cls:"10" })); } catch(_){} });
  await collapseSidebar(page);
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){} });
  await page.goto("/");
  await page.evaluate(() => window.newDiaryScratch());
  await page.locator(".diary-school-btn").click();
  const panel = page.locator(".diary-school-panel");
  await expect(panel.locator(".diary-school-cls-pick")).toHaveValue("10");
  await panel.locator(".diary-school-grade").selectOption("2");
  await expect(panel.locator(".diary-school-cls-pick option")).toHaveText(["반", "1반", "2반"]);
  await expect(panel.locator(".diary-school-cls-pick")).toHaveValue("");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mn.neisSchool")))).toMatchObject({ grade:"2", cls:"" });
  await expect(page.locator(".diary-school .is-timetable .diary-school-text")).toContainText("학년·반을 고르면");
});

test("반 목록을 못 받으면 반을 직접 쳐서 고른다", async ({ page }) => {
  const asked = await stubLauncher(page, { noClasses:true });
  await page.addInitScript(() => { try { localStorage.setItem("mn.neisSchool", JSON.stringify({ office:"B10", code:"7010057", name:"가락고등학교", kind:"고등학교" })); } catch(_){} });
  await collapseSidebar(page);
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){} });
  await page.goto("/");
  await page.evaluate(() => window.newDiaryScratch());
  await page.locator(".diary-school-btn").click();
  const panel = page.locator(".diary-school-panel");
  await expect.poll(() => asked.some(q => q.svc === "classInfo")).toBe(true);
  await expect(panel.locator(".diary-school-cls")).toBeVisible();
  await expect(panel.locator(".diary-school-cls-pick")).toBeHidden();
  await panel.locator(".diary-school-grade").selectOption("1");
  await panel.locator(".diary-school-cls").fill("3");
  await panel.locator(".diary-school-cls").press("Tab");
  await expect(page.locator(".diary-school .is-timetable .diary-school-text")).toHaveText("1교시 공통영어2 · 2교시 통합사회2");
});

test("키 없이 받은 샘플이면 일부만 보인다고 알린다", async ({ page }) => {
  await stubLauncher(page, { sample:true });
  await page.addInitScript(() => { try { localStorage.setItem("mn.neisSchool", JSON.stringify({ office:"B10", code:"7010057", name:"가락고등학교", kind:"고등학교" })); } catch(_){} });
  await page.route((url) => url.pathname === "/neis" && url.searchParams.get("svc") === "SchoolSchedule", (route) => route.fulfill({
    status:200, contentType:"application/json", headers:{ "X-ClassDock-Neis-Sample":"1" },
    body:JSON.stringify({ SchoolSchedule:[{ head:[{ list_total_count:14 }, { RESULT:{ CODE:"INFO-000" } }] },
      { row:[{ AA_YMD:ym + "10", EVENT_NM:"체육대회", SBTR_DD_SC_NM:"해당없음" }] }] })
  }));
  await collapseSidebar(page);
  await page.addInitScript(() => { try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){} });
  await page.goto("/");
  await page.evaluate(() => window.newDiaryScratch());
  await expect(page.locator(".diary-school .diary-school-note")).toContainText("NEIS 인증키가 없어 일부");
});
