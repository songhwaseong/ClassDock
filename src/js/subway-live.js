"use strict";

/* 지하철 실시간 열차 위치 공용 모듈(MNSubwayLive)
 *
 * 실시간 API(realtimePosition)는 좌표를 주지 않는다. '어느 역에 어떤 상태로' 라는 이벤트만 오고
 * 그것도 열차가 역을 지날 때 한 번씩 찍힌다. 그대로 그리면 열차가 역에서 역으로 순간이동한다.
 * 이 모듈은 그 이벤트를 src/js/subway-stations.js 의 좌표·이웃 표에 얹어
 * '지금 이 열차는 두 역 사이 몇 % 지점' 을 계산한다. 화면·통신은 map-viewer.js 가 맡는다.
 *
 * DOM·fetch 를 쓰지 않는 순수 모듈이라 node --test 로 그대로 검증한다(tests/subway-live.test.js).
 *
 * 실측으로 정한 것 세 가지 — 바꾸기 전에 근거를 보라.
 *
 * 1) 진행 방향은 '직전에 있던 역이 아닌 쪽' 이다.
 *    updnLine(상·하행)만 보면 88.8%, 종착역까지 최단경로로 보면 98.1%, 직전 역을 쓰면 99.4% 였다.
 *    updnLine 은 지선 있는 노선에서 무너지고(1호선 50%), 종착역 최단경로는 두 군데서 틀린다 —
 *    순환선(2호선)을 먼 쪽으로 도는 열차, 그리고 회차 직전이라 종착역이 이미 다음 운행 것으로
 *    바뀐 열차(우이신설선). 갈래가 둘 이상인 분기역에서만 종착역으로 고른다.
 *
 * 2) '출발' 이벤트는 실제보다 늦게 찍힌다(도착 뒤 50초쯤).
 *    그래서 최신 행만 보고 그리면 같은 구간에서 진행률이 뒤로 밀려 열차가 튄다(실측 확인).
 *    같은 구간을 가리키는 이벤트끼리는 가장 많이 간 값을 쓴다 — positionOf 가 그 일을 한다.
 *
 * 3) 속도는 '도착 → 다음 역 도착' 간격으로 쟀다(출발 시각은 늦어서 못 쓴다).
 *    291건 중앙값 127초, 표정속도 34km/h. 정차 45초 + 거리÷15m/s 가 가장 잘 맞았고
 *    84%가 오차 25% 이내였다. 진행률을 0.97 에서 막아 다음 역을 지나치지 않게 하면
 *    위치 오차 중앙값이 39m 다(늦게 도착하느니 미리 가서 기다린다).
 */

const MNSubwayLive = (function(){
  const DWELL_SECONDS = 45;      // 역에 서 있는 시간
  const SPEED_MPS = 15;          // 역과 역 사이 주행 속도(≒54km/h)
  const MIN_RUN_SECONDS = 20;    // 아주 가까운 역 사이의 하한
  const MAX_PROGRESS = 0.97;     // 다음 역을 지나치지 않게 막는 자리
  const STALE_SECONDS = 300;     // 이보다 소식이 없으면 화면에서 감춘다
  const HISTORY_MAX = 6;         // 열차 하나가 들고 있는 이벤트 수(구간 되돌림 판정에만 쓴다)

  // 상태값 — 0 진입, 1 도착, 2 출발, 3 전역출발(관측으로 확인)
  const ENTERING = "0", ARRIVED = "1", DEPARTED = "2", LEFT_PREVIOUS = "3";

  /* 표는 subway-stations.js 가 전역으로 올린다. 테스트에서는 useTable 로 직접 건넨다. */
  let injected = null;
  function useTable(table){ injected = table || null; }
  function lines(){
    if (injected) return injected;
    return typeof SUBWAY_LINES !== "undefined" ? SUBWAY_LINES : {};
  }
  function pseudoNames(){
    if (typeof SUBWAY_PSEUDO_STATIONS !== "undefined") return SUBWAY_PSEUDO_STATIONS;
    return ["성수지선", "신정지선", "신도림지선"];
  }
  function terminalAlias(){
    if (typeof SUBWAY_TERMINAL_ALIAS !== "undefined") return SUBWAY_TERMINAL_ALIAS;
    return { "성수지선":"성수", "신도림지선":"신도림", "신정지선":"까치산", "응암순환":"응암" };
  }

  /* 실시간 API 의 statnNm 을 표의 키와 맞춘다. 표도 같은 규칙으로 만들어 두었다. */
  function normalize(name){
    let text = String(name == null ? "" : name).trim().replace(/\s+/g, "");
    text = text.replace(/종착/g, "").replace(/\(.*?\)/g, "").replace(/[·‧]/g, "");
    if (text.length > 1 && text.endsWith("역")) text = text.slice(0, -1);
    return text;
  }
  /* 종착역 자리에는 역이 아닌 이름이 온다("성수지선" · "응암순환(상선)"). 그 갈래의 끝 역으로 읽는다. */
  function terminalOf(name){
    const key = normalize(name);
    const alias = terminalAlias();
    return Object.prototype.hasOwnProperty.call(alias, key) ? alias[key] : key;
  }
  function isPseudo(name){ return pseudoNames().indexOf(normalize(name)) >= 0; }

  /* 노선의 역 전체({이름: [위도, 경도]}). 화면이 노선을 통째로 그릴 때 쓴다. */
  function stationsOf(line){ const spec = lines()[line]; return spec ? spec.s : null; }
  function station(line, name){
    const all = stationsOf(line);
    return all && Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null;
  }
  function neighbours(line, name){
    const spec = lines()[line];
    if (!spec || !Object.prototype.hasOwnProperty.call(spec.n, name)) return [];
    return spec.n[name];
  }

  function metres(a, b){
    const R = 6371000, rad = (v) => v * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* from 에서 온 길(blocked)을 막고 terminal 에 닿는가. 분기역에서 갈래를 고를 때만 쓴다. */
  function reaches(line, start, terminal, blocked){
    if (!station(line, terminal)) return false;
    const seen = { [start]:true };
    if (blocked) seen[blocked] = true;
    const queue = [start];
    while (queue.length){
      const here = queue.shift();
      if (here === terminal) return true;
      for (const next of neighbours(line, here)){
        if (!seen[next]){ seen[next] = true; queue.push(next); }
      }
    }
    return false;
  }

  /* 종착역까지 최단경로의 첫 걸음. 직전 역을 모를 때(열차를 처음 본 순간)만 쓴다. */
  function firstStepToward(line, from, terminal){
    if (!terminal || terminal === from || !station(line, terminal) || !station(line, from)) return null;
    const came = { [from]:null };
    const queue = [from];
    while (queue.length){
      const here = queue.shift();
      if (here === terminal){
        let node = here, previous = came[node];
        while (previous !== null && came[previous] !== undefined && previous !== from){ node = previous; previous = came[node]; }
        return node === from ? null : node;
      }
      for (const next of neighbours(line, here)){
        if (came[next] === undefined){ came[next] = here; queue.push(next); }
      }
    }
    return null;
  }

  /* 다음 역. 직전 역을 알면 그것을 1순위로 쓴다(맨 위 주석 1번). */
  function nextStation(line, current, terminal, previous){
    const near = neighbours(line, current);
    if (!near.length) return null;
    if (previous && near.indexOf(previous) >= 0){
      const rest = near.filter((name) => name !== previous);
      if (!rest.length) return previous;                       // 막다른 역 = 회차
      if (rest.length === 1) return rest[0];
      const toward = rest.filter((name) => reaches(line, name, terminal, current));
      return toward.length === 1 ? toward[0] : rest[0];
    }
    return firstStepToward(line, current, terminal);
  }

  /* 진행 방향 기준 바로 앞 역. 뒤가 갈라지면 null 을 주고, 그때는 열차를 역에 세운다
     — 어느 갈래에서 왔는지 모르는 채로 찍으면 엉뚱한 선 위에 놓인다. */
  function previousStation(line, current, terminal){
    const near = neighbours(line, current);
    if (near.length === 1) return near[0];
    const behind = near.filter((name) => nextStation(line, name, terminal, null) === current);
    return behind.length === 1 ? behind[0] : null;
  }

  /* "2026-09-06 15:12:40" → ms. Date 생성자에 그대로 넘기면 브라우저마다 해석이 갈려 직접 읽는다. */
  function parseTime(text){
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text || "").trim());
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  /* 실시간 한 행 → 이 열차가 지금 어느 구간의 어디쯤에서 출발했는가.
     previous 는 이 열차를 직전에 본 역(없으면 null). */
  function buildEvent(row, previous){
    const line = row && row.subwayNm;
    const current = normalize(row && row.statnNm);
    if (!line || !current || isPseudo(current) || !station(line, current)) return null;
    const terminal = terminalOf(row.statnTnm);
    const status = String(row.trainSttus);
    let from, to, base;
    if (status === ENTERING || status === LEFT_PREVIOUS){
      // 진입·전역출발 = 앞 역에서 현재 역으로 오는 중
      const behind = (previous && neighbours(line, current).indexOf(previous) >= 0)
        ? previous : previousStation(line, current, terminal);
      from = behind || current;
      to = current;
      base = behind ? (status === ENTERING ? 0.90 : 0.12) : 0;
    } else {
      // 도착·출발 = 현재 역에서 다음 역으로
      from = current;
      to = nextStation(line, current, terminal, previous) || current;
      base = from === to || status === ARRIVED ? 0 : (status === DEPARTED ? 0.06 : 0);
    }
    const a = station(line, from), b = station(line, to);
    if (!a || !b) return null;
    const run = from === to ? MIN_RUN_SECONDS : Math.max(MIN_RUN_SECONDS, metres(a, b) / SPEED_MPS);
    return {
      at: parseTime(row.recptnDt),
      station: current, status: status,
      from: from, to: to, base: base, run: run,
      dwell: status === ARRIVED ? DWELL_SECONDS : 0
    };
  }

  /* 이벤트 하나가 말하는 진행률. */
  function progressOf(event, nowMs){
    if (!event || !isFinite(event.at)) return 0;
    const moving = Math.max(0, (nowMs - event.at) / 1000 - event.dwell);
    return Math.min(MAX_PROGRESS, event.base + moving / event.run);
  }

  /* 열차 하나의 지금 위치. events 는 오래된 것부터.
     같은 구간을 가리키는 이벤트끼리 가장 많이 간 값을 쓴다 — 늦게 오는 '출발' 때문에
     최신 것만 보면 열차가 뒤로 튄다(맨 위 주석 2번). */
  function positionOf(events, nowMs){
    if (!Array.isArray(events) || !events.length) return null;
    let index = -1;
    for (let i = 0; i < events.length; i++){
      if (isFinite(events[i].at) && events[i].at <= nowMs) index = i; else break;
    }
    if (index < 0) return null;
    const latest = events[index];
    if ((nowMs - latest.at) / 1000 > STALE_SECONDS) return null;
    let progress = progressOf(latest, nowMs);
    for (let i = index - 1; i >= 0; i--){
      if (events[i].from !== latest.from || events[i].to !== latest.to) break;
      progress = Math.max(progress, progressOf(events[i], nowMs));
    }
    return { from: latest.from, to: latest.to, progress: progress, station: latest.station, status: latest.status };
  }

  /* 위치 → 좌표. from 과 to 를 직선으로 잇고 그 위를 간다(실제 선로 곡선은 쓰지 않는다 —
     역 좌표만으로도 교실에서 보기에 충분하고, 선로 형상은 오프라인으로 들고 다니기 무겁다). */
  function coordsOf(line, place){
    if (!place) return null;
    const a = station(line, place.from), b = station(line, place.to);
    if (!a || !b) return null;
    return [a[0] + (b[0] - a[0]) * place.progress, a[1] + (b[1] - a[1]) * place.progress];
  }

  /* 받아 온 목록을 열차 상태 지도에 녹여 넣는다.
     trains: Map(열차번호 → { line, no, terminal, express, lastTrain, events })
     같은 (보고시각, 역, 상태)는 여러 번 와도 한 번만 담는다. */
  function ingest(trains, rows, line){
    const alive = new Set();
    for (const row of Array.isArray(rows) ? rows : []){
      const no = row && row.trainNo;
      if (!no) continue;
      const key = line + "|" + no;
      alive.add(key);
      let train = trains.get(key);
      if (!train){ train = { line: line, no: no, events: [] }; trains.set(key, train); }
      train.terminal = terminalOf(row.statnTnm);
      train.express = row.directAt === "1";
      train.lastTrain = row.lstcarAt === "1";
      const stamp = row.recptnDt + "|" + row.statnNm + "|" + row.trainSttus;
      if (train.lastStamp === stamp) continue;
      train.lastStamp = stamp;
      const last = train.events[train.events.length - 1];
      // 직전에 '다른 역' 에서 본 자리가 곧 어디서 왔는지다 — 방향 판정의 1순위 근거.
      const previous = last && last.station !== normalize(row.statnNm) ? last.station : train.previous;
      const event = buildEvent(row, previous || null);
      if (!event) continue;
      if (last && last.station !== event.station) train.previous = last.station;
      train.events.push(event);
      if (train.events.length > HISTORY_MAX) train.events.shift();
    }
    return alive;
  }

  /* ── 역별 도착 정보(realtimeStationArrival) ──
     역 이름을 API 가 쓰는 '원래 이름' 으로 물어야 한다. 표의 키는 괄호 부역명을 뗀 이름이라
     그대로 물으면 '총신대입구' → 자료 없음, '총신대입구(이수)' → 9줄(2026-09-18 실측).
     같은 이름도 노선마다 다르다 — 신촌은 2호선이 '신촌', 경의중앙선이 '신촌(경의중앙선)'.
     아래 표는 2026-09-18 전체 역 조회(realtimeStationArrival/ALL, 2,969줄)에서 표 키와 다른 것만 뽑았다.
     역 이름이 바뀌면(부역명 추가 등) 여기에 더한다. 없는 역은 표 키 그대로 묻는다. */
  const API_NAMES = {
    "1호선": { "쌍용":"쌍용(나사렛대)" },
    "4호선": { "총신대입구":"총신대입구(이수)" },
    "5호선": { "광나루":"광나루(장신대)", "신정":"신정(은행정)", "아차산":"아차산(어린이대공원후문)",
      "오목교":"오목교(목동운동장앞)", "군자":"군자(능동)", "천호":"천호(풍납토성)",
      "올림픽공원":"올림픽공원(한국체대)", "굽은다리":"굽은다리(강동구민회관앞)" },
    "6호선": { "월곡":"월곡(동덕여대)", "월드컵경기장":"월드컵경기장(성산)", "안암":"안암(고대병원앞)",
      "화랑대":"화랑대(서울여대입구)", "증산":"증산(명지대앞)", "상월곡":"상월곡(한국과학기술연구원)",
      "새절":"새절(신사)", "대흥":"대흥(서강대앞)", "응암":"응암순환(상선)" },
    "7호선": { "공릉":"공릉(서울산업대입구)", "숭실대입구":"숭실대입구(살피재)", "어린이대공원":"어린이대공원(세종대)",
      "이수":"총신대입구(이수)", "상도":"상도(중앙대앞)", "군자":"군자(능동)" },
    "8호선": { "몽촌토성":"몽촌토성(평화의문)", "남한산성입구":"남한산성입구(성남법원,검찰청)", "천호":"천호(풍납토성)" },
    "경의중앙선": { "신촌":"신촌(경의중앙선)" },
    "우이신설선": { "4.19민주묘지":"4.19 민주묘지" }
  };
  function apiStationName(line, name){
    const map = API_NAMES[line];
    return (map && Object.prototype.hasOwnProperty.call(map, name) && map[name]) || String(name || "");
  }

  /* subwayId → 표의 노선 이름. 같은 역에 서는 다른 노선도 함께 오므로 무엇인지 가려 보인다.
     GTX-A(1032)·경강선(1081)·신림선(1094)은 표에 없어 번호로만 보인다. */
  const SUBWAY_IDS = {
    "1001":"1호선", "1002":"2호선", "1003":"3호선", "1004":"4호선", "1005":"5호선", "1006":"6호선",
    "1007":"7호선", "1008":"8호선", "1009":"9호선", "1063":"경의중앙선", "1065":"공항철도",
    "1067":"경춘선", "1075":"수인분당선", "1077":"신분당선", "1092":"우이신설선", "1093":"서해선",
    "1032":"GTX-A", "1081":"경강선", "1094":"신림선"
  };
  function lineOfSubwayId(id){ return SUBWAY_IDS[String(id == null ? "" : id).trim()] || ""; }

  /* 받아 온 도착 목록을 노선·방향으로 묶는다. line(지금 보는 노선)을 맨 앞에 둔다.
     arvlMsg2 가 사람이 읽는 말("5분 후 (종각)", "전역 도착", "[2]번째 전역 (용산)")이라 그것을 그대로 쓰고,
     barvlDt(초)는 0 으로 오는 일이 많아 값이 있을 때만 쓴다. ordkey 가 방향 안의 도착 차례다. */
  function arrivals(body, line){
    const list = body && Array.isArray(body.realtimeArrivalList) ? body.realtimeArrivalList : [];
    const text = (value) => String(value == null ? "" : value).trim();
    const seen = new Map();
    let rows = [];
    for (const r of list){
      if (!r || typeof r !== "object") continue;
      const subwayId = text(r.subwayId);
      const direction = text(r.updnLine);
      const trainNo = text(r.btrainNo);
      const message = text(r.arvlMsg2).replace(/\[(\d+)\]/g, "$1");
      const destination = terminalOf(text(r.bstatnNm)) || text(r.bstatnNm);
      if (!message && !destination) continue;
      const heading = text(r.trainLineNm);
      const seconds = Number(r.barvlDt);
      const row = {
        subwayId: subwayId, line: lineOfSubwayId(subwayId) || subwayId, direction: direction,
        towards: (/-\s*(.+?)\s*$/.exec(heading) || [])[1] || "",
        destination: destination, message: message, current: text(r.arvlMsg3), code: text(r.arvlCd),
        seconds: text(r.barvlDt) !== "" && Number.isFinite(seconds) && seconds > 0 ? seconds : null,
        kind: text(r.btrainSttus), express: !!text(r.btrainSttus) && text(r.btrainSttus) !== "일반",
        lastTrain: text(r.lstcarAt) === "1", received: parseTime(r.recptnDt), order: text(r.ordkey)
      };
      // 같은 열차가 받은 시각만 다르게 두 줄로 오는 일이 있다(2026-09-18 서울역 1호선 0099:
      // 12:39 '2번째 전역' · 12:40 '5분 후'). 가장 최근에 받은 줄만 남긴다.
      const key = subwayId + "|" + direction + "|" + trainNo;
      const earlier = trainNo && trainNo !== "0" ? seen.get(key) : null;
      if (earlier){
        if (!(row.received > earlier.received)) continue;
        rows = rows.filter((item) => item !== earlier);
      }
      seen.set(key, row);
      rows.push(row);
    }
    /* ordkey = [상하행 1자리][차례 1자리][몇 정거장 전 3자리][종착역][급행]. 차례 자리는 실제 도착 순서와
       어긋날 때가 있어(서울역 1호선 하행: 차례 1 이 26정거장 전, 차례 2 가 '5분 후') 정거장 수로 줄 세운다. */
    const away = (row) => { const n = parseInt(row.order.slice(2, 5), 10); return Number.isFinite(n) ? n : 999; };
    rows.sort((a, b) => (a.line === line ? 0 : 1) - (b.line === line ? 0 : 1)
      || a.line.localeCompare(b.line, "ko", { numeric:true })
      || a.direction.localeCompare(b.direction, "ko")
      || away(a) - away(b)
      || (a.seconds == null ? Infinity : a.seconds) - (b.seconds == null ? Infinity : b.seconds)
      || a.order.localeCompare(b.order));
    // 노선·방향 묶음. 방면은 그 방향 첫 열차의 '○○방면' 을 쓴다.
    const groups = [];
    for (const row of rows){
      const last = groups[groups.length - 1];
      if (last && last.line === row.line && last.direction === row.direction) last.rows.push(row);
      else groups.push({ line: row.line, direction: row.direction, towards: row.towards, rows: [row] });
    }
    return groups;
  }

  return {
    DWELL_SECONDS, SPEED_MPS, MIN_RUN_SECONDS, MAX_PROGRESS, STALE_SECONDS,
    useTable, normalize, terminalOf, isPseudo, station, stationsOf, neighbours, metres,
    nextStation, previousStation, firstStepToward, parseTime,
    buildEvent, progressOf, positionOf, coordsOf, ingest,
    API_NAMES, apiStationName, lineOfSubwayId, arrivals
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = MNSubwayLive;
}
