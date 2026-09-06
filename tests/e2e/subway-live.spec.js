const { test, expect } = require("@playwright/test");
const { collapseSidebar } = require("./helpers");
const table = require("../../src/js/subway-stations.js");

/* 지도 문서의 실시간 열차 층.
 *
 * 방향·보간 규칙은 tests/subway-live.test.js 가 지킨다. 여기서 지키는 것은 화면 쪽 계약이다.
 *   - 런처 없이 열면 버튼 자체가 없는가(브라우저로는 못 쓰는 기능이다)
 *   - 켜면 열차가 실제로 그려지고 시간이 지나면 움직이는가
 *   - 인증키가 없을 때 이유를 밝히고 조르지 않는가
 *   - 무엇보다, 이 층이 지도 파일(.map)에 한 글자도 섞이지 않는가
 *
 * e2e 정적 서버에는 /subway-position 이 없다 — 런처가 하는 일이라, 진짜 API 가 주는 모양
 * 그대로 흉내 내어 화면만 검사한다.
 */

async function openApp(page){
  await page.addInitScript(() => {
    try { localStorage.setItem("mn_onboarded_v1", "1"); localStorage.setItem("uiLang", "ko"); } catch(_){}
  });
  await collapseSidebar(page);
}

/* 2호선 열차 두 대. 하나는 떠난 뒤(출발)라 움직이고, 하나는 막 도착해 정차 중이라 서 있다.
   recptnDt 는 화면이 경과 시간을 재는 기준이라 '지금'으로 만들어 넣는다. */
function positionBody(secondsAgo = 0){
  const stamp = (offset) => {
    const at = new Date(Date.now() - (offset * 1000));
    const pad = (v) => String(v).padStart(2, "0");
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} `
      + `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  };
  return JSON.stringify({
    errorMessage: { status:200, code:"INFO-000", message:"정상 처리되었습니다.", total:2 },
    realtimePositionList: [
      { subwayId:"1002", subwayNm:"2호선", statnId:"1002000201", statnNm:"시청", trainNo:"2001",
        recptnDt:stamp(secondsAgo), updnLine:"0", statnTid:"1002000211", statnTnm:"성수종착",
        trainSttus:"2", directAt:"0", lstcarAt:"0" },
      // 둘 다 시청 근처에 둔다 — 화면 밖에 있으면 이름표를 띄워 볼 수 없다.
      { subwayId:"1002", subwayNm:"2호선", statnId:"1002000202", statnNm:"을지로입구", trainNo:"2002",
        recptnDt:stamp(secondsAgo), updnLine:"0", statnTid:"1002000211", statnTnm:"성수종착",
        trainSttus:"1", directAt:"1", lstcarAt:"0" }
    ]
  });
}

/* 런처 흉내. subway:false 면 프록시 능력 자체가 없는(= 런처 아닌) 환경이 된다. */
async function stubLauncher(page, options = {}){
  const hasSubway = options.subway !== false;
  await page.route("**/can-proxy-subway", (route) =>
    hasSubway ? route.fulfill({ status:200, contentType:"text/plain", body:"yes" })
              : route.fulfill({ status:404, contentType:"text/plain", body:"Not found" }));
  await page.route("**/subway-position**", (route) => {
    if (options.keyMissing){
      return route.fulfill({ status:428, contentType:"text/plain", body:"subway-key-required" });
    }
    if (options.empty){
      return route.fulfill({ status:200, contentType:"application/json",
        body:JSON.stringify({ status:500, code:"INFO-200", message:"해당하는 데이터가 없습니다." }) });
    }
    return route.fulfill({ status:200, contentType:"application/json", body:positionBody(options.age || 0) });
  });
  // 배경 타일은 이 시험과 상관없다 — 네트워크를 기다리지 않게 잘라 둔다.
  await page.route("**/tile-proxy**", (route) => route.abort());
}

const mapModel = (page) => page.evaluate(() => {
  const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
  return doc ? JSON.parse(JSON.stringify(doc.mapDoc)) : null;
});
const trains = (page) => page.locator(".map-subway-train");
const stations = (page) => page.locator(".map-subway-station");
/* 역과 역을 잇는 선은 전용 pane 안의 polyline 이다(역 동그라미도 같은 pane 이라 빼고 센다).
   Leaflet 은 pane 이름의 'Pane' 을 떼고 클래스를 만든다 — mapSubwayRoutePane → leaflet-mapSubwayRoute-pane. */
const labels = (page) => page.locator(".leaflet-tooltip.map-subway-label");
const segments = (page) => page.locator(".leaflet-mapSubwayRoute-pane path:not(.map-subway-station)");

test("런처가 아니면 실시간 열차 단추를 아예 내놓지 않는다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { subway:false });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await expect(page.locator(".map-stage")).toHaveCount(1);
  // 눌러도 아무것도 못 하는 단추를 보여 주지 않는다(오프라인 지도 단추와 같은 규칙).
  await expect(page.locator(".map-subway")).toHaveCount(0);
  await expect(page.locator(".map-subway-line")).toHaveCount(0);
});

test("켜면 열차가 그려지고, 시간이 지나면 스스로 움직인다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());

  const toggle = page.locator(".map-subway");
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".map-subway-line")).toHaveValue("1호선");

  /* 새 지도는 전국이 보이는 확대 7단계로 열린다 — 그 배율에서는 열차가 몇 초 움직여도
     1픽셀이 안 된다. 좌표 입력은 네트워크 없이 바로 이동하므로 그것으로 서울 도심에 붙인다. */
  await page.locator(".map-goto").fill("37.5665, 126.9780");
  await page.locator(".map-goto").press("Enter");
  await page.waitForTimeout(300);

  await page.locator(".map-subway-line").selectOption("2호선");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(trains(page)).toHaveCount(2);
  await expect(page.locator(".map-status")).toContainText("2호선");

  /* 새 값은 15초에 한 번뿐이라, 그 사이를 이어 그리는 것이 이 기능의 핵심이다.
     같은 응답만 오는데도 자리가 바뀌어야 한다. */
  /* circleMarker 는 SVG <path> 로 그려지므로 d 가 자리를 말한다. 도착한 열차는 정차 시간 동안
     제자리에 서 있는 것이 맞으므로(그것도 계약이다) '한 대라도 움직였는가' 를 본다.
     기본 확대에서는 1초가 1픽셀이 안 되어 넉넉히 기다린다. */
  const shapes = () => trains(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("d")));
  const before = await shapes();
  expect(before.filter(Boolean)).toHaveLength(2);
  await page.waitForTimeout(3000);
  expect(await shapes()).not.toEqual(before);

  /* 이름표에는 어느 구간을 얼마나 갔는지와 종착역·급행이 담긴다 —
     화면에 점만 찍혀 있으면 "저게 어느 열차냐"를 매번 묻게 된다. */
  await trains(page).first().hover();
  const tip = page.locator(".map-subway-train-tip").first();
  await expect(tip).toContainText("2호선");
  await expect(tip).toContainText("성수 방면");
  await expect(tip).toContainText("%");                 // 구간을 얼마나 갔는지
  /* 구간을 잇는 화살표는 글자로 남지 않는다 — icons.js 가 → 를 SVG 아이콘으로 바꾼다.
     그래서 글자가 아니라 아이콘이 있는지로 본다. */
  await expect(tip.locator(".ui-icon")).toHaveCount(1);
  // 급행 열차(2002)는 그 사실도 함께 적는다.
  await trains(page).nth(1).hover();
  await expect(page.locator(".map-subway-train-tip").first()).toContainText("급행");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(trains(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* 열차 점만 띄우면 허공에 뜬 것처럼 보인다. 고른 노선의 역과 그 사이를 잇는 선을 함께 깔되,
   실시간을 끄면 함께 사라져야 한다 — 열차와 같은 수명이다. */
test("노선을 켜면 그 노선의 역과 선이 함께 깔리고 끄면 같이 사라진다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());

  await expect(stations(page)).toHaveCount(0);      // 켜기 전에는 아무것도 없다
  await page.locator(".map-subway-line").selectOption("2호선");
  await page.locator(".map-subway").click();
  await expect(stations(page)).toHaveCount(51);     // 본선 43 + 성수지선 4 + 신정지선 4
  await expect(segments(page)).toHaveCount(51);     // 순환선이라 역 수와 구간 수가 같다

  // 노선을 바꾸면 앞 노선의 역·선은 남지 않는다.
  await page.locator(".map-subway-line").selectOption("우이신설선");
  await expect(stations(page)).toHaveCount(13);
  await expect(segments(page)).toHaveCount(12);

  /* 역 이름은 점에 마우스를 올리면 나온다. 전국이 보이는 확대 7단계에서는 역들이 겹쳐
     서로를 가리므로, 첫 번째로 그려지는 역의 좌표로 옮겨 붙인 뒤에 올린다
     (역은 표에 적힌 차례대로 그려지므로 첫 항목이 곧 .first() 다). */
  const first = Object.entries(table.SUBWAY_LINES["우이신설선"].s)[0];
  await page.locator(".map-goto").fill(first[1][0] + ", " + first[1][1]);
  await page.locator(".map-goto").press("Enter");
  await page.waitForTimeout(400);
  await stations(page).first().hover();
  await expect(page.locator(".leaflet-tooltip").first()).toContainText(first[0]);
  await expect(page.locator(".leaflet-tooltip").first()).toHaveText(/\S/);

  await page.locator(".map-subway").click();
  await expect(stations(page)).toHaveCount(0);
  await expect(segments(page)).toHaveCount(0);
});

/* 역 이름은 늘 보이되, 멀리서 보면 접는다 — 51개가 한꺼번에 뜨면 글자가 겹쳐 못 읽는다. */
test("가까이 가면 역 이름이 늘 붙고 멀어지면 접힌다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-subway-line").selectOption("2호선");
  await page.locator(".map-subway").click();

  // 새 지도는 전국이 보이는 7단계 — 이때는 이름을 붙이지 않는다(점만).
  await expect(stations(page)).toHaveCount(51);
  await expect(labels(page)).toHaveCount(0);

  // 좌표로 이동하면 14단계가 되어 이름이 한꺼번에 붙는다.
  await page.locator(".map-goto").fill("37.5665, 126.9780");
  await page.locator(".map-goto").press("Enter");
  await expect(labels(page)).toHaveCount(51);
  await expect(labels(page).filter({ hasText:"시청" }).first()).toBeVisible();

  // 한 단계만 물러나도 다시 접는다.
  await page.locator(".leaflet-control-zoom-out").click();
  await expect(labels(page)).toHaveCount(0);
  await expect(stations(page)).toHaveCount(51);      // 점은 그대로 남는다

  // 다시 다가가 켜 둔 채로 끄면 이름도 함께 사라진다.
  await page.locator(".leaflet-control-zoom-in").click();
  await expect(labels(page)).toHaveCount(51);
  await page.locator(".map-subway").click();
  await expect(labels(page)).toHaveCount(0);
});

test("실시간 열차는 지도 파일에 한 글자도 남기지 않는다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page);
  await page.goto("/");
  await page.evaluate(() => newMapScratch());

  await expect(page.locator(".map-stage.leaflet-container")).toHaveCount(1);
  const before = await mapModel(page);
  await page.locator(".map-subway-line").selectOption("2호선");
  await page.locator(".map-subway").click();
  await expect(trains(page)).toHaveCount(2);

  /* 열차는 지금 이 순간의 값이라 문서에 담으면 다음에 열 때 어제 열차가 되살아난다.
     표시 목록·저장 모델 어느 쪽에도 들어가면 안 되고, '저장 안 됨(●)'도 켜지면 안 된다.
     center·zoom 은 Leaflet 이 마운트 뒤 스스로 다듬으므로 이 비교에서 뺀다. */
  const settled = (model) => { const copy = { ...model }; delete copy.center; delete copy.zoom; return copy; };
  const after = await mapModel(page);
  expect(settled(after)).toEqual(settled(before));
  expect(after.markers).toEqual([]);
  await expect(page.locator(".map-list-row")).toHaveCount(0);
  const dirty = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
    return !!(doc && doc.hasUnsavedEdits);
  });
  expect(dirty).toBe(false);

  const json = await page.evaluate(() => {
    const doc = (typeof docs !== "undefined" ? docs : []).find(d => d.kind === "map");
    return mapDocSerialize(doc.mapDoc);
  });
  expect(json).not.toContain("2001");
  expect(json).not.toContain("시청");
});

test("인증키가 없으면 이유를 밝히고 계속 조르지 않는다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { keyMissing:true });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());

  let asked = 0;
  page.on("request", (request) => { if (request.url().includes("/subway-position")) asked++; });

  await page.locator(".map-subway").click();
  await expect(page.locator(".map-status")).toContainText("인증키");
  // 키가 없으면 더 물어도 소용없다 — 스스로 꺼져야 한다(하루 조회 한도를 헛되이 쓰지 않게).
  await expect(page.locator(".map-subway")).toHaveAttribute("aria-pressed", "false");
  await expect(trains(page)).toHaveCount(0);
  const first = asked;
  await page.waitForTimeout(1200);
  expect(asked).toBe(first);
});

test("운행 중인 열차가 없으면 빈 화면 대신 그렇다고 말한다", async ({ page }) => {
  await openApp(page);
  await stubLauncher(page, { empty:true });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-subway").click();
  await expect(page.locator(".map-status")).toContainText("운행 중인 열차가 없어요");
  await expect(trains(page)).toHaveCount(0);
});

test("소식이 끊긴 열차는 화면에서 사라진다", async ({ page }) => {
  await openApp(page);
  // 5분보다 오래된 보고만 오는 상황 — 낡은 자리에 열차를 붙들어 두면 안 된다.
  await stubLauncher(page, { age:400 });
  await page.goto("/");
  await page.evaluate(() => newMapScratch());
  await page.locator(".map-subway-line").selectOption("2호선");
  await page.locator(".map-subway").click();
  await page.waitForTimeout(800);
  await expect(trains(page)).toHaveCount(0);
});
