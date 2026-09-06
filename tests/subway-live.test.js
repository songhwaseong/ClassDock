const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* 지하철 실시간 위치 계산(MNSubwayLive).
 *
 * 이 모듈이 정하는 것은 두 가지다 — '다음 역이 어디인가'(방향)와 '지금 그 사이 몇 %인가'(보간).
 * 둘 다 실제 API 로 실측해 정한 규칙이라, 되돌아가지 않게 그 근거를 여기서 붙들어 둔다.
 * fixtures/subway-live-moves.json 은 2026-09-06 에 실시간 API 에서 실제로 받아 정리한
 * '열차가 A 에서 B 로 갔다' 359건이다.
 */

const live = require("../src/js/subway-live.js");
const table = require("../src/js/subway-stations.js");
live.useTable(table.SUBWAY_LINES);

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "subway-live-moves.json"), "utf8"));

test("역 이름을 실시간 API 표기에 맞춰 다듬는다", () => {
  assert.equal(live.normalize("왕십리(성동구청)"), "왕십리");
  assert.equal(live.normalize("서울역"), "서울");
  assert.equal(live.normalize(" 신촌 (지하) "), "신촌");
  assert.equal(live.normalize("동대문역사문화공원"), "동대문역사문화공원");  // '역'으로 끝나지 않는다
});

test("종착역 자리의 가상 이름은 그 갈래의 끝 역으로 읽는다", () => {
  assert.equal(live.terminalOf("성수종착"), "성수");
  assert.equal(live.terminalOf("응암순환(상선)"), "응암");
  assert.equal(live.terminalOf("성수지선"), "성수");
  assert.equal(live.terminalOf("신도림지선"), "신도림");
  // 역 이름 자리에 오면 위치를 정할 수 없어 감춰야 한다.
  assert.ok(live.isPseudo("성수지선"));
  assert.ok(!live.isPseudo("성수"));
});

/* 여기가 이 모듈의 핵심이다. 표본 359건은 실제 운행에서 관측한 이동이고,
   updnLine 만 쓰면 88.8%, 종착역 최단경로면 98.1%, 직전 역을 쓰면 99.4% 였다. */
test("직전 역을 쓰면 실측 이동의 99% 이상에서 다음 역을 맞힌다", () => {
  let ok = 0;
  const missed = [];
  for (const [line, previous, current, expected, terminal] of fixture.moves) {
    if (live.nextStation(line, current, terminal, previous) === expected) ok++;
    else missed.push(`[${line}] ${previous || "?"}→${current} 실제 ${expected}`);
  }
  const rate = ok / fixture.moves.length;
  assert.ok(rate >= 0.99, `방향 정확도 ${(rate * 100).toFixed(1)}% — 틀린 것: ${missed.slice(0, 5).join(", ")}`);
  // 남는 오차는 열차를 처음 본 순간(직전 역이 없을 때)뿐이어야 한다.
  for (const line of missed) assert.match(line, /\?→/, "직전 역이 있는데도 틀렸다: " + line);
});

/* 종착역만으로 방향을 정하면 두 군데서 틀린다 — 이 두 사례가 '직전 역이 1순위' 인 이유다.
   규칙을 되돌리면 여기서 걸린다. */
test("종착역 최단경로만으로는 순환선과 회차 직전 열차에서 틀린다", () => {
  // 2호선: 종착이 성수인데 순환선을 먼 쪽으로 도는 열차. 최단경로는 반대(구의)로 보낸다.
  assert.equal(live.firstStepToward("2호선", "강변", "성수"), "구의");
  assert.equal(live.nextStation("2호선", "강변", "성수", "잠실나루"), "구의");
  assert.equal(live.nextStation("2호선", "강변", "성수", "구의"), "잠실나루");
  // 우이신설선: 회차 직전이라 종착역이 이미 다음 운행 것으로 바뀐 열차.
  assert.equal(live.nextStation("우이신설선", "보문", "북한산우이", "성신여대입구"), "신설동");
});

test("분기역에서는 종착역으로 갈래를 고른다", () => {
  /* 1호선 구로에서 경인(인천)과 경부(신창)가 갈린다. 갈림이 실제로 생기는 것은
     북쪽 신도림에서 내려올 때다 — 구일 쪽에서 오면 이미 경인선이라 고를 것이 없다. */
  assert.ok(live.neighbours("1호선", "구로").length >= 3, "구로가 분기역이 아니다");
  assert.equal(live.nextStation("1호선", "구로", "인천", "신도림"), "구일");
  assert.equal(live.nextStation("1호선", "구로", "신창", "신도림"), "가산디지털단지");
  // 병점에서 갈리는 서동탄 지선도 같은 규칙으로 풀린다.
  assert.equal(live.nextStation("1호선", "병점", "서동탄", "세류"), "서동탄");
  assert.equal(live.nextStation("1호선", "병점", "신창", "세류"), "세마");
});

test("막다른 역에서는 왔던 쪽으로 되돌린다(회차)", () => {
  const ends = live.neighbours("1호선", "인천");
  assert.equal(ends.length, 1, "인천이 종점이 아니다");
  assert.equal(live.nextStation("1호선", "인천", "소요산", ends[0]), ends[0]);
});

test("이웃이 아닌 역은 좌표를 내주지 않는다", () => {
  assert.equal(live.station("2호선", "없는역"), null);
  assert.deepEqual(live.neighbours("2호선", "없는역"), []);
  assert.equal(live.buildEvent({ subwayNm:"2호선", statnNm:"성수지선", statnTnm:"성수",
    trainSttus:"1", recptnDt:"2026-09-06 15:00:00" }, null), null);
});

/* '출발' 은 도착 뒤 50초쯤에야 찍힌다. 최신 행만 보고 그리면 같은 구간에서 진행률이 뒤로 밀려
   열차가 튄다 — 실제 기록으로 그 일이 안 생기는지 본다. */
test("같은 구간 안에서 진행률이 뒤로 가지 않는다", () => {
  const trains = new Map();
  const events = [];
  for (const row of fixture.sample.rows) {
    live.ingest(trains, [row], fixture.sample.line);
    const train = trains.get(fixture.sample.line + "|" + fixture.sample.trainNo);
    events.push(train.events.slice());
  }
  const history = events[events.length - 1];
  assert.ok(history.length >= 3, "표본 열차의 이벤트가 너무 적다");

  const first = history[0].at, last = history[history.length - 1].at;
  let previous = null, checked = 0;
  for (let at = first; at <= last; at += 2000) {
    const place = live.positionOf(history, at);
    if (!place) { previous = null; continue; }
    assert.ok(place.progress >= 0 && place.progress <= live.MAX_PROGRESS);
    if (previous && previous.from === place.from && previous.to === place.to) {
      checked++;
      assert.ok(place.progress >= previous.progress - 1e-9,
        `${place.from}→${place.to} 에서 진행률이 뒤로 갔다 ${previous.progress} → ${place.progress}`);
    }
    previous = place;
  }
  assert.ok(checked > 20, "같은 구간을 이어 본 표본이 너무 적다");
});

test("소식이 끊긴 열차는 화면에서 감춘다", () => {
  const at = live.parseTime("2026-09-06 15:00:00");
  const events = [{ at, station:"시청", status:"1", from:"시청", to:"을지로입구", base:0, run:60, dwell:45 }];
  assert.ok(live.positionOf(events, at + 60 * 1000), "방금 받은 열차인데 감췄다");
  assert.equal(live.positionOf(events, at + (live.STALE_SECONDS + 10) * 1000), null);
});

test("좌표는 두 역 사이를 진행률만큼 나아간 자리다", () => {
  const from = live.station("2호선", "시청"), to = live.station("2호선", "을지로입구");
  const at = live.coordsOf("2호선", { from:"시청", to:"을지로입구", progress:0.5 });
  assert.ok(Math.abs(at[0] - (from[0] + to[0]) / 2) < 1e-9);
  assert.ok(Math.abs(at[1] - (from[1] + to[1]) / 2) < 1e-9);
  // 역에 서 있으면 그 역 좌표 그대로.
  assert.deepEqual(live.coordsOf("2호선", { from:"시청", to:"시청", progress:0 }), from.slice());
});

test("도착 직후에는 정차 시간만큼 역에 서 있는다", () => {
  const at = live.parseTime("2026-09-06 15:00:00");
  const event = live.buildEvent({ subwayNm:"2호선", statnNm:"시청", statnTnm:"성수",
    trainSttus:"1", recptnDt:"2026-09-06 15:00:00" }, "충정로");
  assert.equal(event.from, "시청");
  assert.equal(event.dwell, live.DWELL_SECONDS);
  assert.equal(live.progressOf(event, at + (live.DWELL_SECONDS - 5) * 1000), 0);
  assert.ok(live.progressOf(event, at + (live.DWELL_SECONDS + 30) * 1000) > 0);
});

test("보간 상수는 실측으로 맞춘 값이라 함께 움직인다", () => {
  // 도착→도착 291건으로 맞춘 값(정차 45초 + 거리÷15m/s). 바꾸려면 다시 재고 주석도 고칠 것.
  assert.equal(live.DWELL_SECONDS, 45);
  assert.equal(live.SPEED_MPS, 15);
  const source = fs.readFileSync(path.join(__dirname, "../src/js/subway-live.js"), "utf8");
  assert.match(source, /도착 → 다음 역 도착/);
  assert.match(source, /34km\/h/);
});
